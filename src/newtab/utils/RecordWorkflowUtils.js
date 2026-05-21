import browser from 'webextension-polyfill';

const validateUrl = (str) => str?.startsWith('http');
const isMV2 = browser.runtime.getManifest().manifest_version === 2;
const getHostname = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
const ensureSegments = (recording) => {
  if (!Array.isArray(recording.segments)) recording.segments = [];

  return recording.segments;
};
const startSegment = (recording, { tabId, url, flowIndex }) => {
  const hostname = getHostname(url);
  if (!hostname) return null;

  const segments = ensureSegments(recording);
  const lastSegment = segments.at(-1);
  if (
    lastSegment &&
    lastSegment.exitFlowIndex == null &&
    lastSegment.tabId === tabId
  ) {
    return null;
  }

  const segment = {
    id: `segment-${Date.now()}-${segments.length + 1}`,
    name: hostname,
    tabId,
    url,
    entryFlowIndex: flowIndex,
    exitFlowIndex: null,
    origin: 'recorded-tab',
  };

  segments.push(segment);

  return segment;
};

class RecordWorkflowUtils {
  static async updateRecording(callback) {
    const { isRecording, recording } = await browser.storage.local.get([
      'isRecording',
      'recording',
    ]);

    if (!isRecording || !recording) return;

    callback(recording);

    await browser.storage.local.set({ recording });
  }

  static onTabCreated(tab) {
    this.updateRecording((recording) => {
      const url = tab.url || tab.pendingUrl;
      const lastFlow = recording.flows[recording.flows.length - 1];
      const invalidPrevFlow =
        lastFlow &&
        lastFlow.id === 'new-tab' &&
        !validateUrl(lastFlow.data.url);

      if (!invalidPrevFlow) {
        const validUrl = validateUrl(url) ? url : '';

        recording.flows.push({
          id: 'new-tab',
          data: {
            url: validUrl,
            description: tab.title || validUrl,
          },
        });

        if (validUrl) {
          startSegment(recording, {
            tabId: tab.id,
            url: validUrl,
            flowIndex: recording.flows.length - 1,
          });
        }
      }

      recording.activeTab = {
        url,
        id: tab.id,
      };

      browser.storage.local.set({ recording });
    });
  }

  static async onTabsActivated({ tabId }) {
    const { url, id, title } = await browser.tabs.get(tabId);

    if (!validateUrl(url)) return;

    this.updateRecording((recording) => {
      recording.activeTab = { id, url };
      recording.flows.push({
        id: 'switch-tab',
        description: title,
        data: {
          url,
          matchPattern: url,
          createIfNoMatch: true,
        },
      });
      startSegment(recording, {
        tabId: id,
        url,
        flowIndex: recording.flows.length - 1,
      });
    });
  }

  static onWebNavigationCommited({ frameId, tabId, url, transitionType }) {
    const allowedType = ['link', 'typed'];
    if (frameId !== 0 || !allowedType.includes(transitionType)) return;

    this.updateRecording((recording) => {
      if (recording.activeTab.id && tabId !== recording.activeTab.id) return;

      const lastFlow = recording.flows.at(-1) ?? {};
      const isInvalidNewtabFlow =
        lastFlow &&
        lastFlow.id === 'new-tab' &&
        !validateUrl(lastFlow.data.url);

      if (isInvalidNewtabFlow) {
        lastFlow.data.url = url;
        lastFlow.description = url;

        if (validateUrl(url)) {
          startSegment(recording, {
            tabId,
            url,
            flowIndex: recording.flows.length - 1,
          });
        }
      } else if (validateUrl(url)) {
        if (lastFlow?.id !== 'link' || !lastFlow.isClickLink) {
          recording.flows.push({
            id: 'new-tab',
            description: url,
            data: {
              url,
              updatePrevTab: recording.activeTab.id === tabId,
            },
          });
          startSegment(recording, {
            tabId,
            url,
            flowIndex: recording.flows.length - 1,
          });
        }

        recording.activeTab.id = tabId;
        recording.activeTab.url = url;
      }
    });
  }

  static async onWebNavigationCompleted({ tabId, url, frameId }) {
    if (frameId > 0 || !url.startsWith('http')) return;

    try {
      const { isRecording } = await browser.storage.local.get('isRecording');
      if (!isRecording) return;

      if (isMV2) {
        await browser.tabs.executeScript(tabId, {
          allFrames: true,
          runAt: 'document_start',
          file: './recordWorkflow.bundle.js',
        });
      } else {
        await browser.scripting.executeScript({
          target: {
            tabId,
            allFrames: true,
          },
          files: ['recordWorkflow.bundle.js'],
        });
      }
    } catch (error) {
      console.error(error);
    }
  }
}

export default RecordWorkflowUtils;
