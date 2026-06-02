import browser from 'webextension-polyfill';
import { isManifestV2 } from '@/utils/manifest';

const isMV2 = isManifestV2();

function canInjectRecordScript(tab) {
  const url = tab?.url || '';
  if (!url.startsWith('http')) return false;

  try {
    const { hostname } = new URL(url);
    return !['chrome.google.com', 'chromewebstore.google.com'].includes(
      hostname
    );
  } catch {
    return false;
  }
}

export default async function (options = {}) {
  try {
    const flows = [];
    const { activeTabId, requireActiveTabId, ...recordingOptions } = options;
    let activeTab;
    if (activeTabId) {
      try {
        activeTab = await browser.tabs.get(activeTabId);
      } catch (error) {
        console.error(error);
      }
    }
    if (!activeTab?.url?.startsWith('http')) {
      if (requireActiveTabId) return false;

      [activeTab] = await browser.tabs.query({
        active: true,
        url: '*://*/*',
      });
    }

    if (activeTab?.url?.startsWith('http')) {
      flows.push({
        id: 'new-tab',
        description: activeTab.url,
        data: { url: activeTab.url },
      });

      await browser.tabs.update(activeTab.id, { active: true });
      await browser.windows.update(activeTab.windowId, { focused: true });
    }

    await browser.storage.local.set({
      isRecording: true,
      recording: {
        flows,
        name: 'unnamed',
        activeTab: {
          id: activeTab?.id,
          url: activeTab?.url,
        },
        ...recordingOptions,
      },
    });

    const action = browser.action || browser.browserAction;
    await action.setBadgeBackgroundColor({ color: '#ef4444' });
    await action.setBadgeText({ text: 'rec' });

    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (canInjectRecordScript(tab)) {
        try {
          if (isMV2) {
            await browser.tabs.executeScript(tab.id, {
              allFrames: true,
              runAt: 'document_start',
              file: './recordWorkflow.bundle.js',
            });
          } else {
            await browser.scripting.executeScript({
              target: {
                tabId: tab.id,
                allFrames: true,
              },
              files: ['recordWorkflow.bundle.js'],
            });
          }
        } catch (error) {
          console.error(
            'Failed to inject record script',
            tab.id,
            tab.url,
            error
          );
        }
      }
    }

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}
