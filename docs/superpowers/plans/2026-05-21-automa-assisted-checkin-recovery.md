# Automa Assisted Check-In Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Automa fork so scheduled recorded workflows can pause on unknown or failed pages, let the user append-record from the current page, and then resume from the repaired workflow path.

**Architecture:** Reuse Automa's existing workflow graph, condition blocks, element-exists blocks, workflow state storage, and "Record from here" implementation. Add a recovery layer that preserves failed execution context as a paused state, exposes recovery actions in the workflow/debug UI, and starts existing recording with a computed `connectFrom` block output.

**Tech Stack:** Chrome extension, Manifest V3 offscreen/background workflow execution, Vue 3, Pinia, webextension-polyfill, Automa drawflow nodes/edges, existing npm build/lint scripts.

---

## File Structure

- Modify `src/workflowEngine/WorkflowState.js`: add a `pause` state transition that keeps execution state visible without destroying the workflow state entry.
- Modify `src/workflowEngine/WorkflowManager.js`: expose `pauseExecution` and keep failed recoverable workflow states available.
- Modify `src/workflowEngine/WorkflowEngine.js`: add `pauseForRecovery(status, message, blockDetail, workerSnapshot)` and write recoverable metadata into `workflowStates`.
- Modify `src/workflowEngine/WorkflowWorker.js`: classify target-not-found/timeouts/unknown-page-style errors as recoverable when workflow setting `assistedRecovery` is enabled, and call `pauseForRecovery`.
- Modify `src/background/BackgroundWorkflowUtils.js`: bridge pause/update/resume operations for Chrome offscreen and Firefox paths.
- Modify `src/background/index.js`: add message handlers for recovery actions.
- Modify `src/offscreen/message-listener.js`: receive `workflow:pause` in Chrome offscreen execution.
- Modify `src/newtab/utils/startRecordWorkflow.js`: accept recovery metadata and active tab override when starting append-recording from a paused run.
- Modify `src/newtab/pages/Recording.vue`: when stopping a recovery append-recording session, connect generated blocks from the failed block's fallback output if available, otherwise from the normal output.
- Modify `src/components/newtab/workflow/editor/EditorDebugging.vue`: show recovery controls when a workflow state has `status: "paused-recovery"`.
- Modify `src/newtab/pages/workflows/[id].vue`: pass the current workflow object into recovery controls and start append-recording from a paused state.
- Modify `src/stores/workflow.js`: add default setting `assistedRecovery: true`.
- Modify `src/components/newtab/workflow/settings/SettingsGeneral.vue`: add a workflow-level toggle for assisted recovery.
- Create `src/utils/workflowRecovery.js`: centralize recoverable error classification and connection selection.

---

## Task 1: Add Recovery Metadata Helpers

**Files:**
- Create: `src/utils/workflowRecovery.js`

- [ ] **Step 1: Create the recovery helper**

Use `apply_patch` to create `src/utils/workflowRecovery.js`:

```js
export const RECOVERY_STATUS = 'paused-recovery';

const RECOVERABLE_ERROR_MESSAGES = new Set([
  'element-not-found',
  'Timeout',
  'timeout',
]);

export function isRecoverableWorkflowError(error) {
  if (!error) return false;
  if (error.recoverable === true) return true;
  if (RECOVERABLE_ERROR_MESSAGES.has(error.message)) return true;

  const selector = error.data?.selector || error.selector;
  return Boolean(selector && error.message);
}

export function getRecoverySourceOutput(block, error) {
  const onError = block?.data?.onError;
  if (onError?.enable && onError.toDo === 'fallback') return 'fallback';
  if (error?.nextBlockId) return 'fallback';
  return '1';
}

export function buildRecoveryContext({
  workflowId,
  workflowName,
  stateId,
  block,
  worker,
  error,
  message,
}) {
  return {
    workflowId,
    workflowName,
    stateId,
    reason: message || error?.message || 'Paused for recovery',
    failedBlock: block
      ? {
          id: block.id,
          label: block.label,
          output: getRecoverySourceOutput(block, error),
        }
      : null,
    activeTab: worker?.activeTab
      ? {
          id: worker.activeTab.id,
          url: worker.activeTab.url,
          windowId: worker.windowId,
        }
      : null,
    createdAt: Date.now(),
  };
}
```

- [ ] **Step 2: Verify helper imports cleanly**

Run:

```bash
npm run lint -- src/utils/workflowRecovery.js
```

Expected: either lint passes, or the repo's lint script rejects file arguments. If it rejects file arguments, run `npm run lint` after Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/utils/workflowRecovery.js
git commit -m "feat: add workflow recovery helpers"
```

---

## Task 2: Preserve Paused Recovery State

**Files:**
- Modify: `src/workflowEngine/WorkflowState.js`
- Modify: `src/workflowEngine/WorkflowManager.js`

- [ ] **Step 1: Add `pause` to `WorkflowState`**

In `src/workflowEngine/WorkflowState.js`, add this method after `stop(id)`:

```js
  async pause(id, data = {}) {
    const state = this.states.get(id);
    if (!state) return null;

    this.states.set(id, {
      ...state,
      status: data.status || 'paused-recovery',
      ...data,
    });
    this._saveToStorage();

    this.dispatchEvent('pause', { id, data });
    this.dispatchEvent('update', { id, data });

    return this.states.get(id);
  }
```

- [ ] **Step 2: Add `pauseExecution` to `WorkflowManager`**

In `src/workflowEngine/WorkflowManager.js`, add this method after `stopExecution(stateId)`:

```js
  /**
   * Pause workflow execution for user-assisted recovery
   * @param {string} stateId
   * @param {object} data
   * @returns {Promise<void>}
   */
  pauseExecution(stateId, data) {
    return this.#state.pause(stateId, data);
  }
```

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no new lint errors in `WorkflowState.js` or `WorkflowManager.js`.

- [ ] **Step 4: Commit**

```bash
git add src/workflowEngine/WorkflowState.js src/workflowEngine/WorkflowManager.js
git commit -m "feat: preserve recoverable workflow states"
```

---

## Task 3: Pause The Engine Instead Of Destroying Recoverable Runs

**Files:**
- Modify: `src/workflowEngine/WorkflowEngine.js`
- Modify: `src/workflowEngine/WorkflowWorker.js`
- Modify: `src/utils/workflowRecovery.js`

- [ ] **Step 1: Import recovery helpers**

In `src/workflowEngine/WorkflowEngine.js`, add:

```js
import { RECOVERY_STATUS, buildRecoveryContext } from '@/utils/workflowRecovery';
```

In `src/workflowEngine/WorkflowWorker.js`, add:

```js
import { isRecoverableWorkflowError } from '@/utils/workflowRecovery';
```

- [ ] **Step 2: Add `pauseForRecovery` to `WorkflowEngine`**

In `src/workflowEngine/WorkflowEngine.js`, add this method before `destroy(status, message, blockDetail)`:

```js
  async pauseForRecovery(message, blockDetail, worker) {
    if (this.isDestroyed) return;

    const recovery = buildRecoveryContext({
      workflowId: this.workflow.id,
      workflowName: this.workflow.name,
      stateId: this.id,
      block: blockDetail?.block,
      worker,
      error: blockDetail?.error,
      message,
    });

    this.workers.forEach((item) => {
      item.breakpointState = {
        block: item.currentBlock,
        execParam: {},
        isRetry: false,
      };
    });

    await this.states.pause(this.id, {
      status: RECOVERY_STATUS,
      recovery,
      state: {
        status: RECOVERY_STATUS,
        recovery,
        tabIds: [...this.workers.values()]
          .map((item) => item.activeTab?.id)
          .filter(Boolean),
        currentBlock: [...this.workers.values()].map((item) => ({
          id: item.currentBlock?.id,
          name: item.currentBlock?.label,
          startedAt: item.currentBlock?.startedAt,
        })),
        name: this.workflow.name,
        logs: this.history,
        ctxData: {
          ctxData: this.historyCtxData,
          dataSnapshot: this.refDataSnapshots,
        },
        startedTimestamp: this.startedTimestamp,
      },
    });
  }
```

- [ ] **Step 3: Call `pauseForRecovery` in worker catch path**

In `src/workflowEngine/WorkflowWorker.js`, in the final `else` branch where it currently calls:

```js
this.engine.destroy('error', error.message, errorLogItem);
```

replace that one call with:

```js
        if (
          this.engine.workflow.settings?.assistedRecovery &&
          isRecoverableWorkflowError(error)
        ) {
          await this.engine.pauseForRecovery(error.message, {
            ...errorLogItem,
            block,
            error,
          }, this);
          return;
        }

        this.engine.destroy('error', error.message, errorLogItem);
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors in `WorkflowEngine.js`, `WorkflowWorker.js`, or `workflowRecovery.js`.

- [ ] **Step 5: Commit**

```bash
git add src/workflowEngine/WorkflowEngine.js src/workflowEngine/WorkflowWorker.js src/utils/workflowRecovery.js
git commit -m "feat: pause recoverable workflow failures"
```

---

## Task 4: Bridge Recovery Actions Through Background

**Files:**
- Modify: `src/background/BackgroundWorkflowUtils.js`
- Modify: `src/background/index.js`
- Modify: `src/offscreen/message-listener.js`

- [ ] **Step 1: Add `pauseExecution` bridge**

In `src/background/BackgroundWorkflowUtils.js`, add after `stopExecution(stateId)`:

```js
  /**
   * Pause workflow execution for user-assisted recovery
   * @param {string} stateId
   * @param {object} data
   * @returns {Promise<void>}
   */
  async pauseExecution(stateId, data) {
    if (IS_FIREFOX) {
      await this.#ensureWorkflowManager();
      this.#workflowManager.pauseExecution(stateId, data);
      return;
    }

    await BackgroundOffscreen.instance.sendMessage('workflow:pause', {
      id: stateId,
      data,
    });
  }
```

- [ ] **Step 2: Add background message handler**

In `src/background/index.js`, add after the existing `workflow:stop` handler:

```js
message.on('workflow:pause', ({ id, data }) => {
  if (!id) return;
  BackgroundWorkflowUtils.instance.pauseExecution(id, data);
});
```

- [ ] **Step 3: Add offscreen handler**

In `src/offscreen/message-listener.js`, add this after the `workflow:stop` handler:

```js
messageListener.on('workflow:pause', ({ id, data }) => {
  if (!id) return;
  WorkflowManager.instance.pauseExecution(id, data);
});
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: no new lint errors in `BackgroundWorkflowUtils.js`, `background/index.js`, or `offscreen/message-listener.js`.

- [ ] **Step 5: Commit**

```bash
git add src/background/BackgroundWorkflowUtils.js src/background/index.js src/offscreen/message-listener.js
git commit -m "feat: bridge workflow recovery state"
```

---

## Task 5: Start Append Recording From A Paused Run

**Files:**
- Modify: `src/newtab/utils/startRecordWorkflow.js`
- Modify: `src/newtab/pages/Recording.vue`

- [ ] **Step 1: Allow active tab override**

In `src/newtab/utils/startRecordWorkflow.js`, replace the active tab query with logic that honors `options.activeTabId`:

```js
    let activeTab;
    if (options.activeTabId) {
      activeTab = await browser.tabs.get(options.activeTabId);
    } else {
      [activeTab] = await browser.tabs.query({
        active: true,
        url: '*://*/*',
      });
    }
```

Before writing `recording`, remove non-recording options from the spread:

```js
    const { activeTabId, ...recordingOptions } = options;
```

Then replace `...options` with:

```js
        ...recordingOptions,
```

- [ ] **Step 2: Ensure recovery recordings carry `connectFrom`**

When calling `startRecordWorkflow`, recovery callers must pass:

```js
{
  workflowId: recovery.workflowId,
  name: recovery.workflowName,
  activeTabId: recovery.activeTab?.id,
  recovery,
  connectFrom: {
    id: recovery.failedBlock.id,
    output: `${recovery.failedBlock.id}-output-${recovery.failedBlock.output}`,
  },
}
```

If `recovery.failedBlock.output` is already a full output handle, pass that value unchanged.

- [ ] **Step 3: Normalize output handle in `Recording.vue`**

In `src/newtab/pages/Recording.vue`, inside `generateDrawflow(startBlock, startBlockData)`, before the first `addEdge`, add:

```js
  const sourceHandle = startBlock?.output?.includes('-output-')
    ? startBlock.output
    : `${prevNodeId}-output-${startBlock?.output || 1}`;
```

Then change the first `addEdge` source handle from:

```js
    sourceHandle: startBlock?.output || `${prevNodeId}-output-1`,
```

to:

```js
    sourceHandle,
```

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: no new lint errors in recording files.

- [ ] **Step 5: Commit**

```bash
git add src/newtab/utils/startRecordWorkflow.js src/newtab/pages/Recording.vue
git commit -m "feat: append record from paused workflow runs"
```

---

## Task 6: Add Recovery Controls To The Workflow Debug UI

**Files:**
- Modify: `src/components/newtab/workflow/editor/EditorDebugging.vue`
- Modify: `src/newtab/pages/workflows/[id].vue`

- [ ] **Step 1: Emit a recovery event from `EditorDebugging.vue`**

Change:

```js
defineEmits(['goToBlock']);
```

to:

```js
defineEmits(['goToBlock', 'appendRecord']);
```

Add this computed:

```js
const recovery = computed(() => workflowState.value?.state?.recovery);
```

Add this button below the stop button:

```vue
        <ui-button
          v-if="workflowState.status === 'paused-recovery' && recovery"
          v-tooltip="'Append recording from this paused page'"
          icon
          class="text-primary"
          @click="$emit('appendRecord', recovery)"
        >
          <v-remixicon name="riRecordCircleLine" />
        </ui-button>
```

- [ ] **Step 2: Handle `appendRecord` in workflow page**

In `src/newtab/pages/workflows/[id].vue`, add `@append-record="appendRecordFromRecovery"` to the `EditorDebugging` component usage.

Add this import if it is not already present:

```js
import startRecordWorkflow from '@/newtab/utils/startRecordWorkflow';
```

Add this function near `startRecording`:

```js
async function appendRecordFromRecovery(recovery) {
  if (!recovery?.workflowId || !recovery?.failedBlock?.id) return;

  const output = recovery.failedBlock.output?.includes('-output-')
    ? recovery.failedBlock.output
    : `${recovery.failedBlock.id}-output-${recovery.failedBlock.output || 1}`;

  await startRecordWorkflow({
    workflowId: recovery.workflowId,
    name: recovery.workflowName || workflow.value.name,
    activeTabId: recovery.activeTab?.id,
    recovery,
    connectFrom: {
      id: recovery.failedBlock.id,
      output,
    },
  });

  state.dataChanged = false;
  router.replace('/recording');
}
```

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: Vue lint passes for modified files.

- [ ] **Step 4: Commit**

```bash
git add src/components/newtab/workflow/editor/EditorDebugging.vue src/newtab/pages/workflows/[id].vue
git commit -m "feat: expose append recording for paused runs"
```

---

## Task 7: Add Assisted Recovery Setting

**Files:**
- Modify: `src/stores/workflow.js`
- Modify: `src/components/newtab/workflow/settings/SettingsGeneral.vue`

- [ ] **Step 1: Add default setting**

In `src/stores/workflow.js`, in `defaultWorkflow().settings`, add:

```js
      assistedRecovery: true,
```

- [ ] **Step 2: Add the settings toggle**

In `src/components/newtab/workflow/settings/SettingsGeneral.vue`, add this object to `settingItems` after `reuseLastState`:

```js
  {
    id: 'assistedRecovery',
    name: 'Assisted recovery',
    description: 'Pause and allow append-recording when a step fails',
  },
```

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/workflow.js src/components src/newtab
git commit -m "feat: add assisted recovery workflow setting"
```

---

## Task 8: Build A Check-In Workflow Template Helper

**Files:**
- Modify: `src/newtab/pages/workflows/index.vue`
- Modify: `src/stores/workflow.js` if a store-level helper is cleaner.

- [ ] **Step 1: Add a manual template creation action**

Add a UI action near "Create workflow" named:

```text
Create check-in workflow
```

It should create a normal Automa workflow with:

```js
{
  name: 'Daily check-in',
  description: 'Recorded check-in workflow with assisted recovery enabled',
  settings: {
    assistedRecovery: true,
    notification: true,
    saveLog: true,
    onError: 'stop-workflow'
  }
}
```

Let Automa's existing editor and recording flow handle the actual steps.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no new lint errors.

- [ ] **Step 3: Commit**

```bash
git add src/newtab/pages/workflows/index.vue src/stores/workflow.js
git commit -m "feat: add check-in workflow starter"
```

---

## Task 9: End-To-End Manual Verification

**Files:**
- No source changes unless bugs are found.

- [ ] **Step 1: Install dependencies if needed**

Run:

```bash
pnpm install
```

Expected: dependencies install from `pnpm-lock.yaml`.

- [ ] **Step 2: Build the extension**

Run:

```bash
pnpm run build
```

Expected: production extension build completes.

- [ ] **Step 3: Load unpacked extension**

Open Chrome extension management manually and load the generated build directory. Use the build path printed by `pnpm run build`.

- [ ] **Step 4: Verify basic recording still works**

1. Create a workflow.
2. Start recording.
3. Click a button and type into an input on a simple HTTP test page.
4. Stop recording.
5. Confirm new blocks appear in the workflow editor.

Expected: behavior matches current Automa.

- [ ] **Step 5: Verify recoverable failure pauses**

1. Create a workflow that clicks a selector that is not present.
2. Enable assisted recovery.
3. Run the workflow.

Expected: workflow state remains visible with `status: "paused-recovery"` and shows the append-record button.

- [ ] **Step 6: Verify append-record from paused page**

1. Click append-record on the paused run.
2. Perform a valid action on the current page.
3. Stop recording.

Expected: newly recorded blocks are connected after the failed block's selected output.

- [ ] **Step 7: Verify repaired workflow runs**

Run the workflow again.

Expected: it reaches the newly recorded blocks and completes or reaches the next intended condition.

- [ ] **Step 8: Verify scheduled run path**

Configure the trigger block as a daily schedule a few minutes in the future.

Expected: the workflow starts from the alarm, and recoverable failure still enters `paused-recovery`.

---

## Scope Notes

This plan intentionally does not attempt to auto-generate a full state machine. Automa already has condition and element-exists blocks, so the first useful product change is to make failures repairable in-place. After this lands, a second plan can add a "state detector wizard" that generates element-exists and conditions blocks from the current page.
