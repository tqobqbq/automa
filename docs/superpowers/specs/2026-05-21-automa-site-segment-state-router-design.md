# Automa Site Segment State Router Design

## Goal

Build a recovery model for recorded check-in workflows where one workflow can contain multiple website tasks, a failed website keeps its tab open for later repair, and the overall workflow continues to the next website task.

## Confirmed Product Semantics

- A single recording may open several tabs, operate on different websites, and close tabs.
- Playback treats each website task as an isolated segment.
- If one segment fails on a recoverable state, the failed tab stays open and the segment is marked for recovery.
- A failed segment does not block later segments in the same workflow.
- The workflow should retain enough context for the user to append-record from the failed tab later.
- Append-recording from an unknown state creates a new state branch near the failure point, not a simple linear append at the end of the workflow.
- If multiple state branches match at the same time, that is an ambiguous state. The engine continues with the first matching branch by priority and records a warning for later rule improvement.

## Architecture

The feature adds two concepts on top of the existing workflow graph and `paused-recovery` support:

1. Site segments: metadata that groups a range of blocks into one website task. A segment failure can be isolated from the rest of the workflow.
2. State router blocks: decision points that evaluate page state before continuing. A router has ordered branches with element-first conditions and a fallback that creates a recoverable paused segment.

This keeps the implementation close to Automa's existing block graph model. It does not require remote code execution, screenshots, or AI page classification for the first version.

## State Recognition

State recognition is element-first.

Each state branch contains one or more conditions. A branch matches when all of its conditions match.

Supported first-version condition kinds:

- `element`: selector exists, is visible, and optionally is enabled/clickable.
- `text`: selector exists and its text contains or equals a configured value.
- `url`: current tab URL contains or matches a configured pattern.
- `title`: document title contains or matches a configured value.

The first condition generated for a newly appended branch should come from the first recorded action:

- Click action: use the clicked element selector as the primary element condition.
- Form input action: use the input/textarea/select selector as the primary element condition.
- Wait/assert action: use the target selector or text as the primary condition.
- Navigation action: use the destination URL as an auxiliary condition.

The user can later edit branch conditions, selector alternatives, URL/text constraints, and branch order.

## State Router Behavior

A state router block evaluates all branches in order.

- Zero matched branches: create a recoverable segment pause and keep the current tab open.
- One matched branch: continue to that branch's output.
- More than one matched branch: continue to the first matched branch, but record an ambiguity warning.

The ambiguity warning should include:

- workflow id
- run state id
- state router block id
- selected branch id
- all matched branch ids
- active URL
- active tab id
- timestamp

Ambiguous states are not fatal in the first version. They are diagnostics for future resolution strategies such as branch weights, mutual exclusion rules, or suggested selector refinements.

## Site Segment Behavior

A segment represents one website task in a multi-site workflow.

Initial segment inference can be conservative:

- A segment starts when the recording opens or switches to a tab for a new top-level site task.
- A segment ends when the recorded flow closes that tab or reaches the next inferred site task.
- The user should eventually be able to adjust segment boundaries in the editor, but the first implementation can store inferred metadata and expose it in recovery diagnostics.

Playback behavior:

- A successful segment follows the recorded graph normally.
- A recoverable failure inside a segment pauses only that segment.
- The failed segment's tab remains open even if the original recording later had a close-tab action for it.
- The engine continues at the next segment entry when one exists.
- If no next segment exists, the workflow finishes with a partial-success state.

The run summary should distinguish full success, partial success with recoverable segments, and fatal workflow failure.

## Append Recording Behavior

Append-recording starts from the failed segment's preserved tab.

When the user records the missing steps:

1. The system identifies the previous stable block or existing router near the failure point.
2. If a state router already exists at that point, the new recording becomes a new branch on that router.
3. If no router exists, the system inserts a router after the previous stable block.
4. The original normal continuation becomes one router branch.
5. The newly recorded recovery path becomes another router branch.
6. The new branch's first condition is generated from the first recorded action and can be edited later.

The old paused run should not be force-resumed with stale in-memory graph data after saving branch changes. The updated workflow is validated on the next run.

## Data Model Sketch

Router block data:

```json
{
  "label": "state-router",
  "data": {
    "branches": [
      {
        "id": "branch-login-required",
        "name": "Login required",
        "conditions": [
          {
            "kind": "element",
            "selector": "input[type=\"email\"]",
            "visible": true,
            "enabled": true
          }
        ],
        "output": "branch-login-required"
      }
    ],
    "fallback": {
      "type": "segment-recovery"
    }
  }
}
```

Segment metadata:

```json
{
  "segments": [
    {
      "id": "segment-site-a",
      "name": "site-a.com",
      "entryBlockId": "block-open-site-a",
      "exitBlockIds": ["block-close-site-a"],
      "origin": "recorded-tab"
    }
  ]
}
```

Ambiguity warning log data:

```json
{
  "type": "ambiguous-state-match",
  "workflowId": "workflow-id",
  "stateId": "run-state-id",
  "stateRouterBlockId": "router-block-id",
  "selectedBranchId": "branch-login-required",
  "matchedBranchIds": ["branch-login-required", "branch-normal-checkin"],
  "url": "https://example.com/checkin",
  "tabId": 123,
  "timestamp": 1780000000000
}
```

## Error Handling

- Recoverable segment failures create a segment recovery record instead of destroying the whole workflow.
- Non-recoverable engine errors still destroy the workflow.
- If the next segment cannot be found, the workflow ends with partial-success if at least one segment was paused for recovery.
- If a recovery tab is closed before append-recording starts, the append-recording action fails instead of falling back to another active tab.
- If branch evaluation itself throws an unexpected error, the router uses existing assisted recovery behavior and records the router as the failed block.

## Testing Strategy

Unit-level tests should cover:

- Element/text/url/title condition matching.
- Router behavior for zero, one, and multiple matches.
- Ambiguity warning creation.
- Segment failure selecting the next segment entry.
- Append-recording insertion into an existing router.
- Append-recording insertion that creates a new router.

Manual verification should cover:

- Recording two or more websites in one workflow.
- One website failing while later websites still execute.
- Failed tabs staying open.
- Multiple failed websites producing separate recovery records.
- Adding a branch from one failed tab and confirming the updated workflow takes that branch on the next run.

## Out of Scope For First Version

- AI-based page classification.
- Screenshot/image-based state recognition.
- Automatic branch priority tuning.
- Automatic conflict resolution when multiple branches match.
- Resuming an already paused run with newly edited graph data.
- Cross-device synchronization of open recovery tabs.

## Self-Review

- No placeholder requirements remain.
- The design keeps existing `paused-recovery` behavior and extends it with segment-level recovery instead of replacing it.
- Multiple branch matches are explicitly non-fatal and logged.
- Append-recording is defined as state-branch insertion, not linear append.
- First-version state recognition is element-first with URL, title, and text as auxiliary constraints.
