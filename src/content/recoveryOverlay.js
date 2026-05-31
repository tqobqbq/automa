import { sendMessage } from '@/utils/message';

const ROOT_ID = 'automa-recovery-menu';

function getSiteName(recovery) {
  if (recovery?.segment?.name) return recovery.segment.name;

  try {
    return new URL(recovery?.activeTab?.url || window.location.href).hostname;
  } catch {
    return 'Current site';
  }
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

export default function showRecoveryOverlay(recovery) {
  if (window.self !== window.top || !recovery?.workflowId) return false;

  const root = getRoot();
  const shadow = root.shadowRoot || root.attachShadow({ mode: 'open' });
  shadow.replaceChildren();

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
      width: 280px;
      box-sizing: border-box;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 8px;
      background: #111827;
      color: #f9fafb;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.32);
      padding: 12px;
    }
    .title {
      font-size: 13px;
      line-height: 18px;
      font-weight: 700;
      margin: 0;
    }
    .meta {
      color: #cbd5e1;
      font-size: 12px;
      line-height: 17px;
      margin: 4px 0 0;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
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
    }
    button:disabled {
      cursor: default;
      opacity: 0.7;
    }
    .primary {
      background: #2563eb;
      color: #ffffff;
      flex: 1;
    }
    .secondary {
      background: rgba(148, 163, 184, 0.18);
      color: #e5e7eb;
    }
    .error {
      color: #fecaca;
      font-size: 12px;
      line-height: 16px;
      margin-top: 8px;
    }
  `;

  const panel = document.createElement('div');
  panel.className = 'panel';

  appendText(panel, 'p', 'Automa recovery', 'title');
  appendText(panel, 'p', getSiteName(recovery), 'meta');
  appendText(panel, 'p', recovery.reason || 'Paused for recovery', 'meta');

  const actions = document.createElement('div');
  actions.className = 'actions';

  const appendButton = document.createElement('button');
  appendButton.type = 'button';
  appendButton.className = 'primary';
  appendButton.textContent = 'Append recording';
  actions.appendChild(appendButton);

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'secondary';
  hideButton.textContent = 'Hide';
  actions.appendChild(hideButton);

  panel.appendChild(actions);
  shadow.append(style, panel);

  hideButton.addEventListener('click', () => {
    root.remove();
  });

  appendButton.addEventListener('click', async () => {
    appendButton.disabled = true;
    appendButton.textContent = 'Starting...';

    try {
      const started = await sendMessage(
        'workflow:append-record-from-recovery',
        recovery,
        'background'
      );
      if (started) {
        root.remove();
        return;
      }

      throw new Error('Unable to start recovery recording');
    } catch (error) {
      appendButton.disabled = false;
      appendButton.textContent = 'Append recording';

      const currentError = shadow.querySelector('.error');
      currentError?.remove();
      appendText(panel, 'p', error.message, 'error');
    }
  });

  return true;
}
