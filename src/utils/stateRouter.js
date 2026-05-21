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
