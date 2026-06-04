import { IS_FIREFOX } from '@/common/utils/constant';
import startRecordWorkflow from '@/newtab/utils/startRecordWorkflow';
import browser from 'webextension-polyfill';
import BackgroundOffscreen from './BackgroundOffscreen';

class BackgroundWorkflowUtils {
  /** @type {BackgroundWorkflowUtils} */
  static #_instance;

  /**
   * BackgroundWorkflowUtils singleton
   * @type {BackgroundWorkflowUtils}
   */
  static get instance() {
    if (!this.#_instance) this.#_instance = new BackgroundWorkflowUtils();

    return this.#_instance;
  }

  /** @type {import('@/workflowEngine/WorkflowManager').default} */
  #workflowManager;

  constructor() {
    this.#workflowManager = null;
  }

  static flattenTeamWorkflows(workflows) {
    return Object.values(Object.values(workflows || {})[0] || {});
  }

  static async getWorkflow(workflowId) {
    if (!workflowId) return null;

    if (workflowId.startsWith('team')) {
      const { teamWorkflows } = await browser.storage.local.get(
        'teamWorkflows'
      );
      if (!teamWorkflows) return null;

      const workflows = this.flattenTeamWorkflows(teamWorkflows);

      return workflows.find((item) => item.id === workflowId);
    }

    const { workflows, workflowHosts } = await browser.storage.local.get([
      'workflows',
      'workflowHosts',
    ]);
    let findWorkflow = Array.isArray(workflows)
      ? workflows.find(({ id }) => id === workflowId)
      : workflows[workflowId];

    if (!findWorkflow) {
      findWorkflow = Object.values(workflowHosts || {}).find(
        ({ hostId }) => hostId === workflowId
      );

      if (findWorkflow) findWorkflow.id = findWorkflow.hostId;
    }

    return findWorkflow;
  }

  async #ensureWorkflowManager() {
    if (!IS_FIREFOX) return;

    this.#workflowManager = (
      await import('@/workflowEngine/WorkflowManager')
    ).default.instance;
  }

  /**
   * Stop workflow execution
   * @param {string} stateId
   * @returns {Promise<void>}
   */
  async stopExecution(stateId) {
    if (IS_FIREFOX) {
      await this.#ensureWorkflowManager();
      this.#workflowManager.stopExecution(stateId);
      return;
    }

    await BackgroundOffscreen.instance.sendMessage('workflow:stop', stateId);
  }

  /**
   * Pause workflow execution for user-assisted recovery
   * @param {string} stateId
   * @param {object} data
   * @returns {Promise<object|null>}
   */
  async pauseExecution(stateId, data) {
    if (IS_FIREFOX) {
      await this.#ensureWorkflowManager();
      return this.#workflowManager.pauseExecution(stateId, data);
    }

    return BackgroundOffscreen.instance.sendMessage('workflow:pause', {
      id: stateId,
      data,
    });
  }

  /**
   * Resume workflow execution
   * @param {string} stateId
   * @param {object} nextBlock
   * @returns {Promise<void>}
   */
  async resumeExecution(stateId, nextBlock) {
    if (IS_FIREFOX) {
      await this.#ensureWorkflowManager();
      this.#workflowManager.resumeExecution(stateId, nextBlock);
      return;
    }

    await BackgroundOffscreen.instance.sendMessage('workflow:resume', {
      id: stateId,
      nextBlock,
    });
  }

  /**
   * Start append-recording from a preserved recovery tab
   * @param {object} recovery
   * @returns {Promise<boolean>}
   */
  async appendRecordFromRecovery(recovery) {
    if (!recovery?.workflowId || !recovery?.failedBlock?.id) return false;

    const workflow = await this.constructor.getWorkflow(recovery.workflowId);
    const sourceBlock = workflow?.drawflow?.nodes?.find(
      (node) => node.id === recovery.failedBlock.id
    );
    if (!sourceBlock) return false;

    const output = recovery.failedBlock.output?.startsWith(
      `${sourceBlock.id}-output-`
    )
      ? recovery.failedBlock.output
      : `${sourceBlock.id}-output-${recovery.failedBlock.output || 1}`;

    const started = await startRecordWorkflow({
      workflowId: recovery.workflowId,
      name: recovery.workflowName || workflow.name,
      activeTabId: recovery.activeTab?.id,
      requireActiveTabId: Boolean(recovery.activeTab?.id),
      recovery,
      connectFrom: {
        id: sourceBlock.id,
        output,
      },
    });

    return started;
  }

  /**
   * Start recording from the currently running workflow/block.
   * @param {object} state
   * @param {object=} tab
   * @returns {Promise<boolean>}
   */
  async startRuntimeRecording(state, tab) {
    if (state?.recovery) {
      return this.appendRecordFromRecovery(state.recovery);
    }

    const workflowId = state?.workflowId;
    const blockId = state?.currentBlock?.[0]?.id;
    if (!workflowId || !blockId) return false;

    const workflow = await this.constructor.getWorkflow(workflowId);
    const sourceBlock = workflow?.drawflow?.nodes?.find(
      (node) => node.id === blockId
    );
    if (!sourceBlock) return false;

    const started = await startRecordWorkflow({
      workflowId,
      name: state.workflowName || workflow.name,
      activeTabId: tab?.id,
      requireActiveTabId: Boolean(tab?.id),
      runtimeRecording: {
        stateId: state.id,
        blockId,
      },
      connectFrom: {
        id: sourceBlock.id,
        output: `${sourceBlock.id}-output-1`,
      },
    });

    if (started && state?.id) {
      await this.stopExecution(state.id);
    }

    return started;
  }

  /**
   * Update workflow execution state
   * @param {string} stateId
   * @param {object} data
   * @returns {Promise<void>}
   */
  async updateExecutionState(stateId, data) {
    if (IS_FIREFOX) {
      await this.#ensureWorkflowManager();
      this.#workflowManager.updateExecution(stateId, data);
      return;
    }

    await BackgroundOffscreen.instance.sendMessage('workflow:update', {
      data,
      id: stateId,
    });
  }

  async executeWorkflow(workflowData, options) {
    if (workflowData.isDisabled) {
      return { ok: false, status: 'disabled', workflowId: workflowData.id };
    }

    if (IS_FIREFOX) {
      await this.#ensureWorkflowManager();
      return this.#workflowManager.execute(workflowData, options);
    }

    return BackgroundOffscreen.instance.sendMessage('workflow:execute', {
      workflow: workflowData,
      options,
    });
  }
}

export default BackgroundWorkflowUtils;
