export const RECOVERY_STATUS = 'paused-recovery';

const RECOVERABLE_ERROR_MESSAGES = new Set([
  'element-not-found',
]);

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
          output: getRecoverySourceOutput(block),
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
