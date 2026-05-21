<template>
  <div class="mx-auto w-full max-w-xl p-5">
    <div class="flex items-center">
      <button
        v-tooltip="t('recording.stop')"
        class="relative flex h-12 w-12 items-center justify-center rounded-full bg-red-400 focus:ring-0"
        @click="stopRecording"
      >
        <span
          class="absolute animate-ping rounded-full bg-red-400"
          style="height: 80%; width: 80%; animation-duration: 1.3s"
        ></span>
        <ui-spinner v-if="state.isGenerating" color="text-white" />
        <v-remixicon v-else name="riStopLine" class="relative z-10" />
      </button>
      <div class="ml-4 flex-1 overflow-hidden">
        <p class="text-sm">{{ t('recording.title') }}</p>
        <p class="text-overflow text-xl font-semibold leading-tight">
          {{ state.name }}
        </p>
      </div>
    </div>
    <p class="mt-6 mb-2 font-semibold">Flows</p>
    <ui-list class="space-y-1">
      <ui-list-item
        v-for="(item, index) in state.flows"
        :key="index"
        class="group"
        small
      >
        <v-remixicon :name="tasks[item.id].icon" />
        <div class="mx-2 flex-1 overflow-hidden">
          <p class="leading-tight">
            {{ t(`workflow.blocks.${item.id}.name`) }}
          </p>
          <p
            :title="item.data.description || item.description"
            class="text-overflow text-sm leading-tight text-gray-600 dark:text-gray-300"
          >
            {{ item.data.description || item.description }}
          </p>
        </div>
        <v-remixicon
          name="riDeleteBin7Line"
          class="invisible cursor-pointer group-hover:visible"
          @click="removeBlock(index)"
        />
      </ui-list-item>
    </ui-list>
  </div>
</template>
<script setup>
import { onMounted, reactive, toRaw, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { nanoid } from 'nanoid';
import defu from 'defu';
import browser from 'webextension-polyfill';
import { tasks } from '@/utils/shared';
import { useWorkflowStore } from '@/stores/workflow';
import RecordWorkflowUtils from '@/newtab/utils/RecordWorkflowUtils';
import { sendMessage } from '@/utils/message';
import {
  createRecoveryBranch,
  createStateRouterNode,
} from '@/newtab/utils/recoveryBranchBuilder';

const browserEvents = {
  onTabCreated: (event) => RecordWorkflowUtils.onTabCreated(event),
  onTabsActivated: (event) => RecordWorkflowUtils.onTabsActivated(event),
  onCommitted: (event) => RecordWorkflowUtils.onWebNavigationCommited(event),
  onWebNavigationCompleted: (event) =>
    RecordWorkflowUtils.onWebNavigationCompleted(event),
};

const { t } = useI18n();
const router = useRouter();
const workflowStore = useWorkflowStore();

const state = reactive({
  name: '',
  flows: [],
  activeTab: {},
  isGenerating: false,
});

function generateDrawflow(startBlock, startBlockData) {
  let nextNodeId = nanoid();
  const triggerId = startBlock?.id || nanoid();
  let prevNodeId = startBlock?.id || triggerId;

  const nodes = [];
  const edges = [];
  const flowNodeIds = [];

  const addEdge = (data = {}) => {
    edges.push({
      ...data,
      id: nanoid(),
      class: `source-${data.sourceHandle} targte-${data.targetHandle}`,
    });
  };
  const sourceHandle = startBlock?.output?.startsWith(`${prevNodeId}-output-`)
    ? startBlock.output
    : `${prevNodeId}-output-${startBlock?.output || 1}`;
  addEdge({
    source: prevNodeId,
    target: nextNodeId,
    targetHandle: `${nextNodeId}-input-1`,
    sourceHandle,
  });

  if (!startBlock) {
    nodes.push({
      position: {
        x: 50,
        y: 300,
      },
      id: triggerId,
      label: 'trigger',
      type: 'BlockBasic',
      data: tasks.trigger.data,
    });
  }

  const position = {
    y: startBlockData ? startBlockData.position.y + 120 : 300,
    x: startBlockData ? startBlockData.position.x + 280 : 320,
  };
  const groups = {};
  let groupFlowIndexes = [];

  state.flows.forEach((block, index) => {
    if (block.groupId) {
      if (!groups[block.groupId]) groups[block.groupId] = [];
      groupFlowIndexes.push(index);

      groups[block.groupId].push({
        id: block.id,
        itemId: nanoid(),
        data: defu(block.data, tasks[block.id].data),
      });

      const nextNodeInGroup = state.flows[index + 1]?.groupId;
      if (nextNodeInGroup) return;

      block.id = 'blocks-group';
      block.data = { blocks: groups[block.groupId] };

      delete groups[block.groupId];
    }

    const node = {
      id: nextNodeId,
      label: block.id,
      type: tasks[block.id].component,
      data: defu(block.data, tasks[block.id].data),
      position: JSON.parse(JSON.stringify(position)),
    };

    prevNodeId = nextNodeId;
    nextNodeId = nanoid();
    flowNodeIds[index] = node.id;

    if (groupFlowIndexes.length > 0) {
      groupFlowIndexes.forEach((flowIndex) => {
        flowNodeIds[flowIndex] = node.id;
      });
      groupFlowIndexes = [];
    }

    if (index !== state.flows.length - 1) {
      addEdge({
        target: nextNodeId,
        source: prevNodeId,
        targetHandle: `${nextNodeId}-input-1`,
        sourceHandle: `${prevNodeId}-output-1`,
      });
    }

    const inNewRow = (index + 1) % 5 === 0;

    position.x = inNewRow ? 50 : position.x + 280;
    position.y = inNewRow ? position.y + 150 : position.y;

    nodes.push(node);
  });

  return {
    edges,
    flowNodeIds,
    nodes,
  };
}
function mapSegmentsToBlocks(segments, flowNodeIds) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  return segments
    .map((segment, index) => {
      const entryBlockId = flowNodeIds[segment.entryFlowIndex];
      if (!entryBlockId) return null;

      const nextEntryFlowIndex = segments[index + 1]?.entryFlowIndex;
      const endFlowIndex =
        typeof segment.exitFlowIndex === 'number'
          ? segment.exitFlowIndex
          : (nextEntryFlowIndex ?? flowNodeIds.length) - 1;
      const blockIds = flowNodeIds
        .slice(segment.entryFlowIndex, endFlowIndex + 1)
        .filter(
          (blockId, blockIndex, ids) =>
            blockId && ids.indexOf(blockId) === blockIndex
        );

      return {
        id: segment.id,
        name: segment.name,
        tabId: segment.tabId,
        url: segment.url,
        origin: segment.origin,
        entryBlockId,
        blockIds,
      };
    })
    .filter(Boolean);
}
function addDrawflowEdge(edges, data = {}) {
  edges.push({
    ...data,
    id: nanoid(),
    class: `source-${data.sourceHandle} targte-${data.targetHandle}`,
  });
}
function ensureRecoveryRouter({ workflow, sourceBlock }) {
  if (!sourceBlock) return null;

  const incomingEdge = workflow.drawflow.edges.find(
    (edge) => edge.target === sourceBlock.id
  );
  if (!incomingEdge) return null;

  const incomingSource = workflow.drawflow.nodes.find(
    (node) => node.id === incomingEdge?.source
  );
  const existingRouter = workflow.drawflow.nodes.find(
    (node) => node.id === incomingSource?.id && node.label === 'state-router'
  );

  if (existingRouter) {
    return {
      routerNode: {
        ...existingRouter,
        data: {
          ...existingRouter.data,
          branches: [...(existingRouter.data?.branches || [])],
        },
      },
      edges: workflow.drawflow.edges,
      nodes: workflow.drawflow.nodes,
    };
  }

  const normalOutput = 'branch-normal';
  const routerNode = createStateRouterNode({
    sourceBlock,
    output: normalOutput,
  });
  const edges = workflow.drawflow.edges.filter(
    (edge) => edge.id !== incomingEdge?.id
  );
  const nodes = [...workflow.drawflow.nodes, routerNode];

  addDrawflowEdge(edges, {
    source: incomingEdge.source,
    target: routerNode.id,
    sourceHandle: incomingEdge.sourceHandle,
    targetHandle: `${routerNode.id}-input-1`,
  });

  addDrawflowEdge(edges, {
    source: routerNode.id,
    target: sourceBlock.id,
    sourceHandle: `${routerNode.id}-output-${normalOutput}`,
    targetHandle: incomingEdge.targetHandle || `${sourceBlock.id}-input-1`,
  });

  return {
    routerNode,
    edges,
    nodes,
  };
}
function buildRecoveryDrawflow({ workflow, sourceBlock }) {
  const recoveryRouter = ensureRecoveryRouter({
    workflow,
    sourceBlock,
  });
  if (!recoveryRouter) return null;

  const { routerNode, nodes, edges } = recoveryRouter;
  const recoveryBranch = createRecoveryBranch({
    name: state.recovery?.reason,
    firstFlow: state.flows[0],
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
  const nextNodes = nodes.map((node) =>
    node.id === routerNode.id ? routerNode : node
  );

  return {
    drawflow: {
      ...workflow.drawflow,
      nodes: [...nextNodes, ...updatedDrawflow.nodes],
      edges: [...edges, ...updatedDrawflow.edges],
    },
    flowNodeIds: updatedDrawflow.flowNodeIds,
  };
}
async function stopRecording() {
  if (state.isGenerating) return;

  try {
    state.isGenerating = true;

    if (state.flows.length !== 0) {
      if (state.workflowId) {
        const workflow = workflowStore.getById(state.workflowId);
        const startBlock = workflow.drawflow.nodes.find(
          (node) => node.id === state.connectFrom.id
        );
        let updatedDrawflow;

        if (state.recovery) {
          updatedDrawflow = buildRecoveryDrawflow({
            workflow,
            sourceBlock: startBlock,
          });
          if (!updatedDrawflow) {
            throw new Error('recovery-source-block-not-found');
          }
        } else {
          const generatedDrawflow = generateDrawflow(
            state.connectFrom,
            startBlock
          );

          updatedDrawflow = {
            drawflow: {
              ...workflow.drawflow,
              nodes: [...workflow.drawflow.nodes, ...generatedDrawflow.nodes],
              edges: [...workflow.drawflow.edges, ...generatedDrawflow.edges],
            },
            flowNodeIds: generatedDrawflow.flowNodeIds,
          };
        }

        const { drawflow } = updatedDrawflow;
        const data = { drawflow };
        const segments = mapSegmentsToBlocks(
          toRaw(state.segments),
          updatedDrawflow.flowNodeIds
        );

        if (segments.length > 0) {
          data.settings = {
            ...workflow.settings,
            segments: [...(workflow.settings?.segments || []), ...segments],
          };
        }

        await workflowStore.update({
          id: state.workflowId,
          data,
        });

        if (state.recovery?.stateId) {
          await sendMessage(
            'workflow:stop',
            state.recovery.stateId,
            'background'
          );
        }
      } else {
        const drawflow = generateDrawflow();
        const segments = mapSegmentsToBlocks(
          toRaw(state.segments),
          drawflow.flowNodeIds
        );

        await workflowStore.insert({
          drawflow,
          name: state.name,
          description: state.description ?? '',
          settings: {
            assistedRecovery: true,
            segments,
          },
        });
      }
    }

    await browser.storage.local.remove(['isRecording', 'recording']);
    await (browser.action || browser.browserAction).setBadgeText({ text: '' });

    const tabs = (await browser.tabs.query({})).filter((tab) =>
      tab.url.startsWith('http')
    );
    Promise.allSettled(
      tabs.map(({ id }) =>
        browser.tabs.sendMessage(id, { type: 'recording:stop' })
      )
    );

    state.isGenerating = false;

    if (state.workflowId) {
      router.replace(
        `/workflows/${state.workflowId}?blockId=${state.connectFrom.id}`
      );
    } else {
      router.replace('/');
    }
  } catch (error) {
    state.isGenerating = false;
    console.error(error);
  }
}
function removeBlock(index) {
  state.flows.splice(index, 1);

  if (Array.isArray(state.segments)) {
    state.segments = state.segments
      .filter((segment) => segment.entryFlowIndex !== index)
      .map((segment) => {
        const nextSegment = { ...segment };

        if (nextSegment.entryFlowIndex > index) {
          nextSegment.entryFlowIndex -= 1;
        }

        if (nextSegment.exitFlowIndex === index) {
          nextSegment.exitFlowIndex = null;
        } else if (nextSegment.exitFlowIndex > index) {
          nextSegment.exitFlowIndex -= 1;
        }

        return nextSegment;
      });
  }

  browser.storage.local.set({ recording: toRaw(state) });
}
function onStorageChanged({ recording }) {
  if (!recording) return;

  Object.assign(state, recording.newValue);
}

onMounted(async () => {
  const { recording, isRecording } = await browser.storage.local.get([
    'recording',
    'isRecording',
  ]);

  if (!isRecording && !recording) return;

  window.stopRecording = stopRecording;

  browser.storage.onChanged.addListener(onStorageChanged);
  browser.tabs.onCreated.addListener(browserEvents.onTabCreated);
  browser.tabs.onActivated.addListener(browserEvents.onTabsActivated);
  browser.webNavigation.onCommitted.addListener(browserEvents.onCommitted);
  browser.webNavigation.onCompleted.addListener(
    browserEvents.onWebNavigationCompleted
  );

  Object.assign(state, recording);
});
onBeforeUnmount(() => {
  window.stopRecording = null;
  browser.storage.local.onChanged.removeListener(onStorageChanged);
  browser.storage.onChanged.removeListener(onStorageChanged);
  browser.tabs.onCreated.removeListener(browserEvents.onTabCreated);
  browser.tabs.onActivated.removeListener(browserEvents.onTabsActivated);
  browser.webNavigation.onCommitted.removeListener(browserEvents.onCommitted);
  browser.webNavigation.onCompleted.removeListener(
    browserEvents.onWebNavigationCompleted
  );
});
</script>
