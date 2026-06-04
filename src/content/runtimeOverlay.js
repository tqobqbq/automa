import { sendMessage } from '@/utils/message';

const ROOT_ID = 'automa-runtime-overlay';

let currentState = null;
let minimized = false;
let timer = null;

function formatElapsed(startedAt) {
  if (!startedAt) return '';

  const elapsed = Math.max(0, Date.now() - startedAt);
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getStatusLabel(status) {
  const labels = {
    running: 'Running',
    breakpoint: 'Breakpoint',
    'paused-recovery': 'Needs input',
    stopped: 'Stopped',
    error: 'Error',
    success: 'Success',
    'partial-success': 'Partial success',
    'waiting-for-params': 'Waiting for params',
  };

  return labels[status] || status || 'Running';
}

function getCurrentBlock(state) {
  const block = state?.currentBlock?.[0];
  if (!block) return 'Preparing workflow';

  return block.name || block.label || block.id || 'Current step';
}

function getLastLog(state) {
  const logs = Array.isArray(state?.logs) ? state.logs : [];
  const log = logs.at(-1);
  if (!log) return '';

  return log.message || log.description || log.name || '';
}

function appendText(parent, tag, text, className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.appendChild(element);

  return element;
}

function getRoot() {
  const existing = document.getElementById(ROOT_ID);
  if (existing) return existing;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.documentElement.appendChild(root);

  return root;
}

function removeRoot() {
  document.getElementById(ROOT_ID)?.remove();
}

function getStyles() {
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .panel {
      width: 304px;
      box-sizing: border-box;
      border: 1px solid rgba(15, 23, 42, 0.16);
      border-radius: 8px;
      background: #111827;
      color: #f9fafb;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.32);
      padding: 12px;
    }
    .panel.minimized {
      width: 220px;
      padding: 10px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #22c55e;
      flex: 0 0 auto;
    }
    .dot.warn {
      background: #f59e0b;
    }
    .dot.error {
      background: #ef4444;
    }
    .title {
      min-width: 0;
      flex: 1;
      font-size: 13px;
      line-height: 18px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status {
      color: #cbd5e1;
      font-size: 12px;
      line-height: 16px;
      margin: 6px 0 0;
      overflow-wrap: anywhere;
    }
    .meta {
      color: #94a3b8;
      font-size: 12px;
      line-height: 16px;
      margin: 4px 0 0;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    button {
      appearance: none;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 16px;
      padding: 7px 9px;
      white-space: nowrap;
    }
    .primary {
      background: #2563eb;
      color: #ffffff;
    }
    .danger {
      background: #dc2626;
      color: #ffffff;
    }
    .secondary {
      background: rgba(148, 163, 184, 0.18);
      color: #e5e7eb;
    }
    .ghost {
      background: transparent;
      color: #cbd5e1;
      padding: 4px 6px;
    }
  `;

  return style;
}

function getDotClass(status) {
  if (status === 'paused-recovery' || status === 'breakpoint') {
    return 'dot warn';
  }
  if (status === 'error') return 'dot error';
  return 'dot';
}

function addAction(panel, label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  panel.appendChild(button);

  return button;
}

async function stopWorkflow(button) {
  if (!currentState?.id) return;

  button.disabled = true;
  button.textContent = 'Stopping...';

  try {
    await sendMessage('workflow:stop', currentState.id, 'background');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Stop';
    console.error(error);
  }
}

async function appendRecording(button) {
  if (!currentState?.recovery) return;

  button.disabled = true;
  button.textContent = 'Starting...';

  try {
    const started = await sendMessage(
      'workflow:append-record-from-recovery',
      currentState.recovery,
      'background'
    );
    if (!started) throw new Error('Unable to start recovery recording');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Append recording';
    console.error(error);
  }
}

function render() {
  if (window.self !== window.top || !currentState?.id) return false;

  const root = getRoot();
  const shadow = root.shadowRoot || root.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

  const panel = document.createElement('div');
  panel.className = minimized ? 'panel minimized' : 'panel';

  const header = document.createElement('div');
  header.className = 'header';

  const dot = document.createElement('span');
  dot.className = getDotClass(currentState.status);
  header.appendChild(dot);

  appendText(
    header,
    'div',
    minimized
      ? getStatusLabel(currentState.status)
      : currentState.workflowName || 'Automa workflow',
    'title'
  );

  addAction(header, minimized ? 'Open' : 'Min', 'ghost', () => {
    minimized = !minimized;
    render();
  });

  panel.appendChild(header);

  if (!minimized) {
    appendText(
      panel,
      'p',
      `${getStatusLabel(currentState.status)}${
        currentState.elapsed ? ` - ${currentState.elapsed}` : ''
      }`,
      'status'
    );
    appendText(panel, 'p', getCurrentBlock(currentState), 'meta');

    const lastLog = getLastLog(currentState);
    if (lastLog) appendText(panel, 'p', lastLog, 'meta');

    const actions = document.createElement('div');
    actions.className = 'actions';

    addAction(actions, 'Dashboard', 'secondary', () => {
      sendMessage('open:dashboard', '', 'background');
    });

    addAction(actions, 'Stop', 'danger', (event) => {
      stopWorkflow(event.currentTarget);
    });

    if (
      currentState.status === 'paused-recovery' &&
      currentState.recovery &&
      currentState.canAppendRecording
    ) {
      addAction(actions, 'Append recording', 'primary', (event) => {
        appendRecording(event.currentTarget);
      });
    }

    panel.appendChild(actions);
  }

  shadow.append(getStyles(), panel);
  return true;
}

function ensureTimer() {
  if (timer) return;

  timer = setInterval(() => {
    if (!currentState) return;

    currentState.elapsed = formatElapsed(currentState.startedTimestamp);
    render();
  }, 1000);
}

function clearTimer() {
  if (!timer) return;

  clearInterval(timer);
  timer = null;
}

export function showRuntimeOverlay(state) {
  currentState = {
    ...state,
    elapsed: formatElapsed(state?.startedTimestamp),
  };
  ensureTimer();

  return render();
}

export function hideRuntimeOverlay(stateId) {
  if (stateId && currentState?.id && stateId !== currentState.id) return false;

  currentState = null;
  clearTimer();
  removeRoot();
  return true;
}
