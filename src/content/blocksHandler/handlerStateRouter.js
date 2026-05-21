import defaultHandleSelector from '../handleSelector';

function elementIsVisible(element) {
  if (!element) return false;

  const { visibility, display } = getComputedStyle(element);

  return visibility !== 'hidden' && display !== 'none';
}

function elementIsEnabled(element) {
  if (!element) return false;

  return !element.disabled && element.getAttribute('aria-disabled') !== 'true';
}

function getExpectedValue(condition) {
  return condition.value || condition.contains || '';
}

function textMatches(actual, condition) {
  const expected = getExpectedValue(condition);

  if (condition.match === 'equals') return actual === expected;

  return actual.includes(expected);
}

function valueMatches(actual, condition) {
  const expected = getExpectedValue(condition);

  if (condition.match === 'equals') return actual === expected;

  return actual.includes(expected);
}

async function findConditionElement(block, condition, handleSelector) {
  const selector = condition.selector;
  if (!selector) return null;

  return handleSelector({
    ...block,
    data: {
      ...block.data,
      findBy: condition.findBy || block.data.findBy || 'cssSelector',
      selector,
    },
  });
}

async function evaluateCondition(block, condition, handleSelector) {
  const conditionType = condition.kind || condition.type;

  if (conditionType === 'url') {
    return valueMatches(window.location.href, condition);
  }

  if (conditionType === 'title') {
    return valueMatches(document.title, condition);
  }

  const element = await findConditionElement(block, condition, handleSelector);

  if (conditionType === 'text') {
    if (!element) return false;

    return textMatches(element.textContent || element.innerText || '', condition);
  }

  if (!element) return false;
  if (condition.visible === true && !elementIsVisible(element)) return false;
  if (condition.enabled === true && !elementIsEnabled(element)) return false;

  return true;
}

async function branchMatches(block, branch, handleSelector) {
  const conditions = Array.isArray(branch.conditions) ? branch.conditions : [];
  if (conditions.length === 0) return false;

  for (const condition of conditions) {
    const isMatch = await evaluateCondition(block, condition, handleSelector);
    if (!isMatch) return false;
  }

  return true;
}

export default async function stateRouter(block, helpers = {}) {
  const handleSelector = helpers.handleSelector || defaultHandleSelector;
  const branches = Array.isArray(block.data.branches) ? block.data.branches : [];
  const matchedBranchIds = [];

  for (const branch of branches) {
    if (await branchMatches(block, branch, handleSelector)) {
      matchedBranchIds.push(branch.id);
    }
  }

  return {
    matchedBranchIds,
    url: window.location.href,
    title: document.title,
  };
}
