function normalizeUrl(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;

  if (value.startsWith('*://')) {
    return `https://${value.slice(4).replace(/^\*\./, '')}`;
  }

  return '';
}

function getHostname(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';

  try {
    return new URL(normalized).hostname.replace(/^\*\./, '');
  } catch {
    return '';
  }
}

function getNodeUrl(node) {
  if (!node?.data) return '';

  if (node.label === 'new-tab') return node.data.url || '';
  if (node.label === 'switch-tab') {
    return node.data.url || node.data.matchPattern || '';
  }

  return '';
}

function getOrderedNodes(drawflow) {
  const nodes = Array.isArray(drawflow?.nodes) ? drawflow.nodes : [];
  const edges = Array.isArray(drawflow?.edges) ? drawflow.edges : [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeOrder = new Map(edges.map((edge, index) => [edge.id, index]));
  const adjacency = edges.reduce((acc, edge) => {
    if (!edge.source || !edge.target) return acc;
    if (!acc.has(edge.source)) acc.set(edge.source, []);

    acc.get(edge.source).push(edge);

    return acc;
  }, new Map());
  adjacency.forEach((items) => {
    items.sort(
      (a, b) => (edgeOrder.get(a.id) || 0) - (edgeOrder.get(b.id) || 0)
    );
  });

  const trigger = nodes.find((node) => node.label === 'trigger') || nodes[0];
  const visited = new Set();
  const ordered = [];

  function visit(nodeId) {
    if (!nodeId || visited.has(nodeId)) return;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    visited.add(nodeId);
    ordered.push(node);

    (adjacency.get(nodeId) || []).forEach((edge) => visit(edge.target));
  }

  visit(trigger?.id);
  nodes.forEach((node) => visit(node.id));

  return ordered;
}

function isExplicitSiteStart(
  node,
  previousNode,
  hasCurrentSegment,
  suppressSwitchStart = false
) {
  if (!node) return false;

  if (node.label === 'new-tab') {
    if (!getHostname(node.data?.url)) return false;
    if (!hasCurrentSegment) return true;
    if (previousNode?.label === 'link') return false;

    return node.data?.updatePrevTab !== true;
  }

  if (node.label === 'switch-tab') {
    if (suppressSwitchStart) return false;

    return Boolean(getHostname(node.data?.url || node.data?.matchPattern));
  }

  return false;
}

export function getStoredWorkflowSegments(workflow) {
  const segments = workflow?.settings?.segments;

  return Array.isArray(segments) ? segments : [];
}

export function inferWorkflowSegments(workflow) {
  const orderedNodes = getOrderedNodes(workflow?.drawflow);
  const segments = [];
  let currentSegment = null;
  let previousNode = null;
  let suppressNextSwitchStart = false;

  orderedNodes.forEach((node) => {
    const url = getNodeUrl(node);
    const hostname = getHostname(url);
    const suppressCurrentSwitchStart =
      node.label === 'switch-tab' && suppressNextSwitchStart;
    const shouldStartSegment = isExplicitSiteStart(
      node,
      previousNode,
      Boolean(currentSegment),
      suppressCurrentSwitchStart
    );
    const isClickOpenedTab =
      node.label === 'new-tab' &&
      previousNode?.label === 'link' &&
      Boolean(hostname);

    suppressNextSwitchStart = false;

    if (shouldStartSegment) {
      currentSegment = {
        id: `segment-inferred-${segments.length + 1}`,
        name: hostname,
        url: normalizeUrl(url),
        origin: 'inferred',
        entryBlockId: node.id,
        blockIds: [],
      };
      segments.push(currentSegment);
    } else if (!currentSegment && hostname) {
      currentSegment = {
        id: `segment-inferred-${segments.length + 1}`,
        name: hostname,
        url: normalizeUrl(url),
        origin: 'inferred',
        entryBlockId: node.id,
        blockIds: [],
      };
      segments.push(currentSegment);
    }

    if (currentSegment && node.label !== 'trigger') {
      currentSegment.blockIds.push(node.id);
    }

    if (isClickOpenedTab) suppressNextSwitchStart = true;
    previousNode = node;
  });

  return segments.filter((segment) => segment.blockIds.length > 0);
}

export function getWorkflowSegments(workflow) {
  const storedSegments = getStoredWorkflowSegments(workflow);

  return storedSegments.length > 0
    ? storedSegments
    : inferWorkflowSegments(workflow);
}
