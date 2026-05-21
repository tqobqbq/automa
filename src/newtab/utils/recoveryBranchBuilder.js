import { nanoid } from 'nanoid';
import { STATE_ROUTER_LABEL } from '@/utils/stateRouter';
import { tasks } from '@/utils/shared';

const SELECTOR_FLOW_IDS = new Set([
  'event-click',
  'forms',
  'trigger-event',
  'upload-file',
  'hover-element',
  'element-exists',
]);

function createSelectorCondition(flow, { enabled = false } = {}) {
  const selector = flow?.data?.selector;
  if (!selector) return null;

  return {
    kind: 'element',
    selector,
    visible: true,
    ...(enabled ? { enabled: true } : {}),
  };
}

export function inferConditionFromFirstFlow(flow) {
  const selectorCondition = createSelectorCondition(flow, {
    enabled: ['event-click', 'forms'].includes(flow?.id),
  });

  if (selectorCondition && SELECTOR_FLOW_IDS.has(flow?.id)) {
    return selectorCondition;
  }

  const url = flow?.data?.url || flow?.data?.matchPattern;
  if (url) {
    return {
      kind: 'url',
      contains: url,
    };
  }

  return null;
}

export function inferConditionFromBlock(block) {
  const selectorCondition = createSelectorCondition(block);
  if (selectorCondition) return selectorCondition;

  const url = block?.data?.url || block?.data?.matchPattern;
  if (url) {
    return {
      kind: 'url',
      contains: url,
    };
  }

  return null;
}

export function createRecoveryBranch({ name, firstFlow }) {
  const id = `branch-${nanoid()}`;

  return {
    id,
    name: name || 'Recovered state',
    output: id,
    priority: 0,
    conditions: [inferConditionFromFirstFlow(firstFlow)].filter(Boolean),
  };
}

export function createNormalBranch({ sourceBlock, output = 'branch-normal' }) {
  return {
    id: 'branch-normal',
    name: 'Normal state',
    output,
    priority: 10,
    conditions: [inferConditionFromBlock(sourceBlock)].filter(Boolean),
  };
}

export function createStateRouterNode({
  sourceBlock,
  output = 'branch-normal',
}) {
  const id = nanoid();

  return {
    id,
    label: STATE_ROUTER_LABEL,
    type: tasks[STATE_ROUTER_LABEL].component,
    data: {
      ...tasks[STATE_ROUTER_LABEL].data,
      branches: [createNormalBranch({ sourceBlock, output })],
    },
    position: {
      x: (sourceBlock?.position?.x || 50) + 280,
      y: sourceBlock?.position?.y || 300,
    },
  };
}
