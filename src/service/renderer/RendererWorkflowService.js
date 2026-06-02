import { MessageListener } from '@/utils/message';
import { toRaw } from 'vue';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientMessageError(error) {
  const message = error?.message || '';

  return (
    message.includes('Could not establish connection') ||
    message.includes('Receiving end does not exist') ||
    message.includes('message channel closed')
  );
}

function toMessageData(data) {
  if (data == null) return data;

  return JSON.parse(JSON.stringify(toRaw(data)));
}

class RendererWorkflowService {
  static executeWorkflow(workflowData, options) {
    return this.#sendExecuteMessage(workflowData, options);
  }

  static async #sendExecuteMessage(workflowData, options) {
    let payload;
    try {
      payload = {
        ...toMessageData(workflowData),
        options: toMessageData(options),
      };
    } catch (error) {
      console.error('Failed to serialize workflow execution payload', error);
      return {
        ok: false,
        status: 'error',
        error:
          error.message || 'Failed to serialize workflow execution payload',
      };
    }

    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await MessageListener.sendMessage(
          'workflow:execute',
          payload,
          'background'
        );

        return result || { ok: true, status: 'started' };
      } catch (error) {
        lastError = error;
        if (!isTransientMessageError(error)) break;

        await sleep(250 * (attempt + 1));
      }
    }

    console.error('Failed to execute workflow', lastError);
    return {
      ok: false,
      status: 'error',
      error: lastError?.message || 'Failed to execute workflow',
    };
  }

  static stopWorkflowExecution(executionId) {
    return MessageListener.sendMessage(
      'workflow:stop',
      executionId,
      'background'
    );
  }
}

export default RendererWorkflowService;
