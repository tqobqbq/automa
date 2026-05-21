import {
  STATE_ROUTER_FALLBACK_OUTPUT,
  createAmbiguousStateWarning,
  selectStateBranch,
} from '@/utils/stateRouter';

async function stateRouter(block) {
  const result = await this._sendMessageToTab(block);
  const matchedBranchIds = Array.isArray(result?.matchedBranchIds)
    ? result.matchedBranchIds
    : [];
  const { selectedBranch, matchedBranches, ambiguous } = selectStateBranch(
    block.data.branches,
    matchedBranchIds
  );

  if (ambiguous) {
    this.engine.addLogHistory({
      type: 'warning',
      name: block.label,
      blockId: block.id,
      activeTabUrl: result?.url || this.activeTab?.url,
      ctxData: createAmbiguousStateWarning({
        workflowId: this.engine.workflow.id,
        stateId: this.engine.id,
        stateRouterBlockId: block.id,
        selectedBranchId: selectedBranch.id,
        matchedBranchIds: matchedBranches.map((branch) => branch.id),
        url: result?.url || this.activeTab?.url,
        tabId: this.activeTab?.id,
      }),
    });
  }

  const outputId = selectedBranch?.output || STATE_ROUTER_FALLBACK_OUTPUT;

  return {
    data: {
      matchedBranchIds,
      selectedBranchId: selectedBranch?.id || null,
    },
    nextBlockId: this.getBlockConnections(block.id, outputId),
  };
}

export default stateRouter;
