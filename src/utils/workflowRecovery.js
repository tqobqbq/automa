export const RECOVERY_STATUS = 'paused-recovery';

const RECOVERABLE_ERROR_MESSAGES = new Set(['element-not-found']);

export function isRecoverableWorkflowError(error) {
  if (!error) return false;
  if (error.recoverable === true) return true;
  if (RECOVERABLE_ERROR_MESSAGES.has(error.message)) return true;

  const selector = error.data?.selector || error.selector;
  return Boolean(selector && error.message);
}

export function getRecoverySourceOutput(block) {
  const onError = block?.data?.onError;
  if (onError?.enable && onError.toDo === 'fallback') return 'fallback';
  return '1';
}

export function findSegmentForBlock(workflow, blockId) {
  if (blockId == null) return undefined;

  const segments = workflow?.settings?.segments || [];
  return segments.find(
    (segment) =>
      segment.entryBlockId === blockId || segment.blockIds?.includes(blockId)
  );
}

export function findNextSegmentEntry(workflow, segmentId) {
  const segments = workflow?.settings?.segments || [];
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) return null;

  return (
    segments.slice(index + 1).find((segment) => segment.entryBlockId)
      ?.entryBlockId || null
  );
}

export function buildRecoveryContext({
  workflow,
  workflowId,
  workflowName,
  stateId,
  block,
  segment,
  worker,
  error,
  message,
}) {
  return {
    workflowId: workflowId || workflow?.id,
    workflowName: workflowName || workflow?.name,
    stateId,
    reason: message || error?.message || 'Paused for recovery',
    failedBlock: block
      ? {
          id: block.id,
          label: block.label,
          output: getRecoverySourceOutput(block),
        }
      : null,
    segment: segment
      ? {
          id: segment.id,
          name: segment.name,
          entryBlockId: segment.entryBlockId,
        }
      : null,
    activeTab: worker?.activeTab?.id
      ? {
          id: worker.activeTab.id,
          url: worker.activeTab.url,
          windowId: worker.windowId,
        }
      : null,
    createdAt: Date.now(),
  };
}
