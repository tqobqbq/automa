# Automa Site Segment State Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add site-level recovery isolation and element-first state routing so a multi-site recorded check-in workflow can keep later sites running when one site enters an unknown recoverable state.

**Architecture:** Add a `state-router` block that evaluates ordered state branches using element/text/url/title conditions in the active tab. Add lightweight site segment metadata and extend recovery handling so recoverable failures inside a segment pause that segment, keep its tab open, and continue at the next segment entry. Change recovery append-recording so new recordings become router branches near the failed point instead of plain linear appends.

**Tech Stack:** Vue 3, Pinia-style workflow store, WebExtension APIs through `webextension-polyfill`, Automa workflow engine block handlers, existing drawflow node/edge graph.

---

## File Structure

- Create `src/utils/stateRouter.js`: shared constants and pure helpers for router branch matching results, ambiguity warning payloads, and router drawflow output ids.
- Create `src/content/blocksHandler/handlerStateRouter.js`: page-context condition evaluator for element/text/url/title conditions.
- Create `src/workflowEngine/blocksHandler/handlerStateRouter.js`: workflow-engine block handler that calls the content evaluator, logs ambiguity warnings, and selects the next branch output.
- Modify `src/utils/shared.js`: register the `state-router` block definition.
- Modify `src/utils/workflowRecovery.js`: add segment-aware recovery fields and helpers.
- Modify `src/workflowEngine/WorkflowEngine.js`: track segment recovery records and expose partial-success destroy metadata.
- Modify `src/workflowEngine/WorkflowWorker.js`: on recoverable segment failure, pause the failed segment and continue with the next segment entry when available.
- Modify `src/newtab/utils/RecordWorkflowUtils.js`: infer recording segments from tab task boundaries and keep segment metadata in recording state.
- Modify `src/newtab/pages/Recording.vue`: persist segment metadata and insert/update state-router branches during recovery append-recording.
- Modify `src/newtab/pages/workflows/[id].vue`: pass segment-aware recovery data to append-recording and surface failed segment diagnostics.
- Modify `src/components/newtab/workflow/editor/EditorDebugging.vue`: show segment recovery and ambiguity warning details.

---

### Task 1: Shared State Router Helpers

**Files:**
- Create: `src/utils/stateRouter.js`
- Verify: `node --check src/utils/stateRouter.js`

- [ ] **Step 1: Create shared constants and result helpers**

Create `src/utils/stateRouter.js`:

```js
export const STATE_ROUTER_LABEL = 'state-router';
export const STATE_ROUTER_FALLBACK_OUTPUT = 'fallback';
export const AMBIGUOUS_STATE_MATCH = 'ambiguous-state-match';

export function getBranchOutput(branch) {
  return branch?.output || branch?.id;
}

export function getRouterOutputHandle(blockId, outputId) {
  return `${blockId}-output-${outputId}`;
}

export function normalizeRouterBranches(branches = []) {
  return branches
    .filter((branch) => branch && branch.id)
    .map((branch, index) => ({
      ...branch,
      output: getBranchOutput(branch),
      priority: Number.isFinite(branch.priority) ? branch.priority : index,
      conditions: Array.isArray(branch.conditions) ? branch.conditions : [],
    }))
    .sort((a, b) => a.priority - b.priority);
}

export function selectStateBranch(branches, matchedBranchIds = []) {
  const normalized = normalizeRouterBranches(branches);
  const matched = normalized.filter((branch) =>
    matchedBranchIds.includes(branch.id)
  );

  return {
    selectedBranch: matched[0] || null,
    matchedBranches: matched,
    ambiguous: matched.length > 1,
  };
}

export function createAmbiguousStateWarning({
  workflowId,
  stateId,
  stateRouterBlockId,
  selectedBranchId,
  matchedBranchIds,
  url,
  tabId,
  timestamp = Date.now(),
}) {
  return {
    type: AMBIGUOUS_STATE_MATCH,
    workflowId,
    stateId,
    stateRouterBlockId,
    selectedBranchId,
    matchedBranchIds,
    url,
    tabId,
    timestamp,
  };
}
```

- [ ] **Step 2: Verify syntax**

Run:

```bash
node --check src/utils/stateRouter.js
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/utils/stateRouter.js
git commit -m "feat: add state router helpers"
```

---

### Task 2: State Router Block Execution

**Files:**
- Create: `src/content/blocksHandler/handlerStateRouter.js`
- Create: `src/workflowEngine/blocksHandler/handlerStateRouter.js`
- Modify: `src/utils/shared.js`
- Verify: `node --check src/content/blocksHandler/handlerStateRouter.js src/workflowEngine/blocksHandler/handlerStateRouter.js`

- [ ] **Step 1: Add the content-side condition evaluator**

Create `src/content/blocksHandler/handlerStateRouter.js`:

```js
import handleSelector from '../handleSelector';

function elementIsVisible(element) {
  if (!element) return false;
  const { visibility, display } = getComputedStyle(element);
  return visibility !== 'hidden' && display !== 'none';
}

function elementIsEnabled(element) {
  if (!element) return false;
  return !element.disabled && element.getAttribute('aria-disabled') !== 'true';
}

function textMatches(actual, condition) {
  const expected = condition.value || condition.contains || '';
  if (condition.match === 'equals') return actual === expected;
  return actual.includes(expected);
}

async function evaluateCondition(block, condition) {
  if (condition.kind === 'url') {
    const value = condition.value || condition.contains || '';
    if (condition.match === 'equals') return window.location.href === value;
    return window.location.href.includes(value);
  }

  if (condition.kind === 'title') {
    const value = condition.value || condition.contains || '';
    if (condition.match === 'equals') return document.title === value;
    return document.title.includes(value);
  }

  const selector = condition.selector;
  if (!selector) return false;

  const element = await handleSelector({
    ...block,
    data: {
      ...block.data,
      findBy: condition.findBy || block.data.findBy || 'cssSelector',
      selector,
    },
  });

  if (condition.kind === 'text') {
    if (!element) return false;
    return textMatches(element.innerText || element.textContent || '', condition);
  }

  if (!element) return false;
  if (condition.visible === true && !elementIsVisible(element)) return false;
  if (condition.enabled === true && !elementIsEnabled(element)) return false;
  return true;
}

async function branchMatches(block, branch) {
  const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
  if (conditions.length === 0) return false;

  for (const condition of conditions) {
    const isMatch = await evaluateCondition(block, condition);
    if (!isMatch) return false;
  }

  return true;
}

export default async function stateRouter(block) {
  const branches = Array.isArray(block.data.branches) ? block.data.branches : [];
  const matchedBranchIds = [];

  for (const branch of branches) {
    if (await branchMatches(block, branch)) {
      matchedBranchIds.push(branch.id);
    }
  }

  return {
    matchedBranchIds,
    url: window.location.href,
    title: document.title,
  };
}
```

- [ ] **Step 2: Add the engine-side handler**

Create `src/workflowEngine/blocksHandler/handlerStateRouter.js`:

```js
import {
  STATE_ROUTER_FALLBACK_OUTPUT,
  createAmbiguousStateWarning,
  selectStateBranch,
} from '@/utils/stateRouter';

async function stateRouter(block) {
  const result = await this._sendMessageToTab(block);
  const { selectedBranch, matchedBranches, ambiguous } = selectStateBranch(
    block.data.branches,
    result.matchedBranchIds
  );

  if (ambiguous) {
    this.engine.addLogHistory({
      type: 'warning',
      name: block.label,
      blockId: block.id,
      activeTabUrl: result.url || this.activeTab?.url,
      ctxData: createAmbiguousStateWarning({
        workflowId: this.engine.workflow.id,
        stateId: this.engine.id,
        stateRouterBlockId: block.id,
        selectedBranchId: selectedBranch.id,
        matchedBranchIds: matchedBranches.map((branch) => branch.id),
        url: result.url || this.activeTab?.url,
        tabId: this.activeTab?.id,
      }),
    });
  }

  const outputId = selectedBranch?.output || STATE_ROUTER_FALLBACK_OUTPUT;

  return {
    data: {
      matchedBranchIds: result.matchedBranchIds,
      selectedBranchId: selectedBranch?.id || null,
    },
    nextBlockId: this.getBlockConnections(block.id, outputId),
  };
}

export default stateRouter;
```

- [ ] **Step 3: Register the block definition**

In `src/utils/shared.js`, add this entry near the other condition blocks:

```js
  'state-router': {
    name: 'State router',
    description: 'Route by current page state',
    icon: 'riRouteLine',
    component: 'BlockConditions',
    category: 'conditions',
    inputs: 1,
    outputs: 0,
    allowedInputs: true,
    maxConnection: 1,
    data: {
      description: '',
      disableBlock: false,
      findBy: 'cssSelector',
      branches: [],
      fallback: {
        type: 'segment-recovery',
      },
    },
  },
```

Do not add a custom edit component in this task. The first implementation can create and maintain router data through recovery append-recording.

- [ ] **Step 4: Verify syntax and build**

Run:

```bash
node --check src/content/blocksHandler/handlerStateRouter.js
node --check src/workflowEngine/blocksHandler/handlerStateRouter.js
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/content/blocksHandler/handlerStateRouter.js src/workflowEngine/blocksHandler/handlerStateRouter.js src/utils/shared.js
git commit -m "feat: add state router block"
```

---

### Task 3: Segment Metadata During Recording

**Files:**
- Modify: `src/newtab/utils/RecordWorkflowUtils.js`
- Modify: `src/newtab/pages/Recording.vue`
- Verify: `node --check src/newtab/utils/RecordWorkflowUtils.js`

- [ ] **Step 1: Add recording segment initialization helpers**

In `src/newtab/utils/RecordWorkflowUtils.js`, add below the `isMV2` constant:

```js
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return '';
  }
}

function ensureSegments(recording) {
  if (!Array.isArray(recording.segments)) recording.segments = [];
  return recording.segments;
}

function startSegment(recording, { tabId, url, flowIndex }) {
  const hostname = getHostname(url);
  if (!hostname) return null;

  const segments = ensureSegments(recording);
  const lastSegment = segments.at(-1);
  if (lastSegment && !lastSegment.exitFlowIndex && lastSegment.tabId === tabId) {
    return lastSegment;
  }

  const segment = {
    id: `segment-${Date.now()}-${segments.length + 1}`,
    name: hostname,
    tabId,
    url,
    entryFlowIndex: flowIndex,
    exitFlowIndex: null,
    origin: 'recorded-tab',
  };
  segments.push(segment);
  return segment;
}
```

- [ ] **Step 2: Mark segment starts when new site tasks are recorded**

In `onTabCreated`, after pushing a `new-tab` flow, call:

```js
const flowIndex = recording.flows.length - 1;
startSegment(recording, {
  tabId: tab.id,
  url: validUrl,
  flowIndex,
});
```

In `onTabsActivated`, after pushing a `switch-tab` flow, call:

```js
const flowIndex = recording.flows.length - 1;
startSegment(recording, {
  tabId: id,
  url,
  flowIndex,
});
```

In `onWebNavigationCommited`, when a valid `new-tab` flow is pushed or updated, call `startSegment` with the active `tabId`, `url`, and the resulting flow index.

- [ ] **Step 3: Persist segments in new workflow settings**

In `src/newtab/pages/Recording.vue`, when inserting a new workflow, change the payload to include metadata:

```js
await workflowStore.insert({
  drawflow,
  name: state.name,
  description: state.description ?? '',
  settings: {
    assistedRecovery: true,
    segments: state.segments || [],
  },
});
```

When updating an existing workflow after append-recording, preserve the current settings and update `segments` only if `state.segments` exists:

```js
const settings = {
  ...(workflow.settings || {}),
  ...(state.segments ? { segments: state.segments } : {}),
};

await workflowStore.update({
  id: state.workflowId,
  data: { drawflow, settings },
});
```

- [ ] **Step 4: Verify syntax and build**

Run:

```bash
node --check src/newtab/utils/RecordWorkflowUtils.js
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/newtab/utils/RecordWorkflowUtils.js src/newtab/pages/Recording.vue
git commit -m "feat: infer recorded site segments"
```

---

### Task 4: Segment-Aware Recovery Context

**Files:**
- Modify: `src/utils/workflowRecovery.js`
- Modify: `src/workflowEngine/WorkflowEngine.js`
- Verify: `node --check src/utils/workflowRecovery.js src/workflowEngine/WorkflowEngine.js`

- [ ] **Step 1: Add segment lookup helpers**

In `src/utils/workflowRecovery.js`, add:

```js
export function findSegmentForBlock(workflow, blockId) {
  const segments = workflow?.settings?.segments || [];
  return segments.find((segment) => {
    if (segment.entryBlockId && segment.exitBlockIds) {
      return segment.entryBlockId === blockId || segment.blockIds?.includes(blockId);
    }
    return segment.blockIds?.includes(blockId);
  });
}

export function findNextSegmentEntry(workflow, segmentId) {
  const segments = workflow?.settings?.segments || [];
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) return null;

  return segments.slice(index + 1).find((segment) => segment.entryBlockId)
    ?.entryBlockId;
}
```

- [ ] **Step 2: Include segment data in recovery context**

Update `buildRecoveryContext` signature to accept `workflow` and `segment`, and add this field to the returned object:

```js
    segment: segment
      ? {
          id: segment.id,
          name: segment.name,
          entryBlockId: segment.entryBlockId,
        }
      : null,
```

In `src/workflowEngine/WorkflowEngine.js`, before `buildRecoveryContext`, compute:

```js
const segment = findSegmentForBlock(this.workflow, blockDetail?.block?.id);
```

Pass `workflow: this.workflow` and `segment` into `buildRecoveryContext`.

- [ ] **Step 3: Track segment recovery records on the engine**

In the `WorkflowEngine` constructor, initialize:

```js
this.segmentRecoveries = [];
```

After a successful pause state is stored in `pauseForRecovery`, append:

```js
if (recovery.segment?.id) {
  this.segmentRecoveries.push(recovery);
}
```

- [ ] **Step 4: Verify syntax and build**

Run:

```bash
node --check src/utils/workflowRecovery.js
node --check src/workflowEngine/WorkflowEngine.js
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/utils/workflowRecovery.js src/workflowEngine/WorkflowEngine.js
git commit -m "feat: add segment recovery context"
```

---

### Task 5: Continue To Next Segment After Recoverable Segment Failure

**Files:**
- Modify: `src/workflowEngine/WorkflowWorker.js`
- Modify: `src/utils/workflowRecovery.js`
- Verify: `node --check src/workflowEngine/WorkflowWorker.js src/utils/workflowRecovery.js`

- [ ] **Step 1: Add next-segment helper**

In `src/utils/workflowRecovery.js`, add:

```js
export function canContinueAfterSegmentFailure(workflow, blockId) {
  const segment = findSegmentForBlock(workflow, blockId);
  if (!segment) return { canContinue: false, segment: null, nextBlockId: null };

  const nextBlockId = findNextSegmentEntry(workflow, segment.id);
  return {
    canContinue: Boolean(nextBlockId),
    segment,
    nextBlockId,
  };
}
```

- [ ] **Step 2: Import and use the helper in worker error handling**

In `src/workflowEngine/WorkflowWorker.js`, import `canContinueAfterSegmentFailure`.

In both recoverable error branches where `pauseForRecovery` currently returns and stops the engine, replace:

```js
if (recoveryPaused) return;
```

with:

```js
if (recoveryPaused) {
  const continuation = canContinueAfterSegmentFailure(
    this.engine.workflow,
    block.id
  );

  if (continuation.canContinue) {
    const nextSegmentBlock = this.engine.blocks[continuation.nextBlockId];
    if (nextSegmentBlock) {
      await this.executeBlock(nextSegmentBlock, {
        ...execParam,
        prevBlockData,
        segmentRecoveryContinue: true,
      });
    }
  }

  return;
}
```

This keeps the failed tab open because no close-tab block from the failed segment is executed after the pause.

- [ ] **Step 3: Preserve whole-run status as partial success**

In `WorkflowEngine.destroy`, when the status is `success` and `this.segmentRecoveries.length > 0`, include a final state/log status of `partial-success` instead of plain success. If the existing destroy method does not accept metadata, add a small branch before final state update:

```js
const finalStatus =
  status === 'success' && this.segmentRecoveries.length > 0
    ? 'partial-success'
    : status;
```

Use `finalStatus` for the stored workflow state and final log status while keeping existing method behavior unchanged for workflows with no segment recoveries.

- [ ] **Step 4: Verify build**

Run:

```bash
node --check src/workflowEngine/WorkflowWorker.js
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/workflowEngine/WorkflowWorker.js src/workflowEngine/WorkflowEngine.js src/utils/workflowRecovery.js
git commit -m "feat: continue after segment recovery pauses"
```

---

### Task 6: Append Recording As State Branch

**Files:**
- Create: `src/newtab/utils/recoveryBranchBuilder.js`
- Modify: `src/newtab/pages/Recording.vue`
- Verify: `node --check src/newtab/utils/recoveryBranchBuilder.js`

- [ ] **Step 1: Add branch-building utility**

Create `src/newtab/utils/recoveryBranchBuilder.js`:

```js
import { nanoid } from 'nanoid';
import { STATE_ROUTER_LABEL } from '@/utils/stateRouter';
import { tasks } from '@/utils/shared';

export function inferConditionFromFirstFlow(flow) {
  const selector = flow?.data?.selector;
  if (selector) {
    return {
      kind: 'element',
      selector,
      visible: true,
      enabled: ['event-click', 'forms'].includes(flow.id),
    };
  }

  const url = flow?.data?.url || flow?.data?.matchPattern;
  if (url) {
    return {
      kind: 'url',
      contains: url,
    };
  }

  return {
    kind: 'url',
    contains: '',
  };
}

export function createRecoveryBranch({ name, firstFlow }) {
  const id = `branch-${nanoid()}`;
  return {
    id,
    name: name || 'Recovered state',
    output: id,
    priority: 0,
    conditions: [inferConditionFromFirstFlow(firstFlow)],
  };
}

export function createStateRouterNode({ sourceBlock, normalOutput }) {
  const id = nanoid();
  return {
    id,
    label: STATE_ROUTER_LABEL,
    type: tasks[STATE_ROUTER_LABEL].component,
    data: {
      ...tasks[STATE_ROUTER_LABEL].data,
      branches: [
        {
          id: 'branch-normal',
          name: 'Normal state',
          output: 'branch-normal',
          priority: 10,
          conditions: [],
          originalOutput: normalOutput || '1',
        },
      ],
    },
    position: {
      x: (sourceBlock?.position?.x || 50) + 280,
      y: sourceBlock?.position?.y || 300,
    },
  };
}
```

- [ ] **Step 2: Route recovery append through a router**

In `src/newtab/pages/Recording.vue`, import:

```js
import {
  createRecoveryBranch,
  createStateRouterNode,
} from '@/newtab/utils/recoveryBranchBuilder';
```

When `state.recovery` exists inside `stopRecording`, replace the direct `generateDrawflow(state.connectFrom, startBlock)` path with:

```js
const recoveryBranch = createRecoveryBranch({
  name: state.recovery.reason,
  firstFlow: state.flows[0],
});

const routerNode =
  startBlock.label === 'state-router'
    ? startBlock
    : createStateRouterNode({
        sourceBlock: startBlock,
        normalOutput: state.connectFrom.output,
      });

routerNode.data.branches = [
  ...(routerNode.data.branches || []),
  recoveryBranch,
];

const updatedDrawflow = generateDrawflow(
  {
    id: routerNode.id,
    output: recoveryBranch.output,
  },
  routerNode
);
```

If `startBlock` was not already a `state-router`, add `routerNode` to the workflow nodes and replace the original edge from `state.connectFrom` to the old continuation with an edge from `state.connectFrom` to `routerNode`. Preserve the original continuation by connecting `routerNode` output `branch-normal` to the old target.

- [ ] **Step 3: Keep existing non-recovery append behavior**

Ensure the old direct append path remains for `state.workflowId && !state.recovery`.

- [ ] **Step 4: Verify build**

Run:

```bash
node --check src/newtab/utils/recoveryBranchBuilder.js
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/newtab/utils/recoveryBranchBuilder.js src/newtab/pages/Recording.vue
git commit -m "feat: append recovery recordings as state branches"
```

---

### Task 7: Recovery UI Diagnostics

**Files:**
- Modify: `src/components/newtab/workflow/editor/EditorDebugging.vue`
- Modify: `src/newtab/pages/workflows/[id].vue`
- Verify: `npm run build`

- [ ] **Step 1: Show segment recovery details**

In `EditorDebugging.vue`, near the existing paused recovery controls, show:

```vue
<p v-if="recovery?.segment" class="text-sm text-gray-600 dark:text-gray-300">
  Segment: {{ recovery.segment.name }}
</p>
```

Keep the existing append-record button and stop controls.

- [ ] **Step 2: Show ambiguity warnings from logs**

Add a computed property:

```js
const ambiguityWarnings = computed(() =>
  (workflowState.value?.state?.logs || []).filter(
    (item) => item.ctxData?.type === 'ambiguous-state-match'
  )
);
```

Render a compact warning list:

```vue
<div v-if="ambiguityWarnings.length" class="mt-2 text-sm text-yellow-600">
  <p v-for="warning in ambiguityWarnings" :key="warning.ctxData.timestamp">
    Ambiguous state: selected {{ warning.ctxData.selectedBranchId }}
  </p>
</div>
```

- [ ] **Step 3: Verify build**

Run:

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/newtab/workflow/editor/EditorDebugging.vue src/newtab/pages/workflows/[id].vue
git commit -m "feat: show segment recovery diagnostics"
```

---

### Task 8: Final Verification

**Files:**
- Review all changed files from this plan.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
node --check src/utils/stateRouter.js
node --check src/content/blocksHandler/handlerStateRouter.js
node --check src/workflowEngine/blocksHandler/handlerStateRouter.js
node --check src/utils/workflowRecovery.js
node --check src/workflowEngine/WorkflowEngine.js
node --check src/workflowEngine/WorkflowWorker.js
node --check src/newtab/utils/RecordWorkflowUtils.js
node --check src/newtab/utils/recoveryBranchBuilder.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: exit code 0.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: exit code 0. Browserslist stale-data warnings are acceptable.

- [ ] **Step 4: Run lint and record known residual issues**

Run:

```bash
npm run lint
```

Expected: lint may still fail on the existing `getPassKey` unresolved imports, `src/lib/dayjs.js` semicolon, and existing console warnings. Any new lint error in files touched by this plan must be fixed before finalizing.

- [ ] **Step 5: Manual workflow verification**

Load the built extension and verify:

1. Record a workflow that opens two different websites in two tabs.
2. Force the first website to fail on a recoverable element lookup.
3. Confirm the failed first website tab remains open.
4. Confirm the second website still executes.
5. Append-record from the failed first website.
6. Confirm the workflow graph now contains a `state-router` near the failure point.
7. Run the workflow again and confirm the newly added branch is selected when the same page state appears.
8. Create two matching router branches and confirm the first branch is selected while an ambiguity warning is recorded.

- [ ] **Step 6: Commit verification cleanup if needed**

If any small verification fixes were made:

```bash
git add <changed-files>
git commit -m "fix: harden site segment state routing"
```

Do not commit build output or dependency directories.
