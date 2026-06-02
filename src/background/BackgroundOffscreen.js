/* eslint-disable class-methods-use-this */
import { IS_FIREFOX } from '@/common/utils/constant';
import { sleep } from '@/utils/helper';
import { MessageListener } from '@/utils/message';
import Browser from 'webextension-polyfill';

const OFFSCREEN_URL = Browser.runtime.getURL('/offscreen.html');

function isMissingReceiverError(error) {
  const message = error?.message || '';

  return (
    message.includes('Could not establish connection') ||
    message.includes('Receiving end does not exist')
  );
}

class BackgroundOffscreen {
  /** @type {BackgroundOffscreen} */
  static #_instance;

  /**
   * OffscreenService singleton
   * @returns {BackgroundOffscreen}
   */
  static get instance() {
    if (!this.#_instance) {
      this.#_instance = new BackgroundOffscreen();
    }

    return this.#_instance;
  }

  /** @type {MessageListener} */
  #messageListener;

  constructor() {
    this.#messageListener = new MessageListener('offscreen');

    this.on = this.#messageListener.on;
  }

  /**
   *
   * @returns {Promise<boolean>}
   */
  async #ensureDocument() {
    if (IS_FIREFOX) return;

    const isOpened = await this.isOpened();
    if (isOpened) return;

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [
        chrome.offscreen.Reason.BLOBS,
        chrome.offscreen.Reason.CLIPBOARD,
        chrome.offscreen.Reason.IFRAME_SCRIPTING,
      ],
      justification: 'For running the workflow',
    });

    await sleep(500);
  }

  /**
   *
   * @returns {Promise<boolean>}
   */
  async isOpened() {
    if (IS_FIREFOX) return false;

    const contexts = await chrome.runtime.getContexts({
      documentUrls: [OFFSCREEN_URL],
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    return Boolean(contexts.length);
  }

  /**
   *
   * @param {string} name
   * @param {*} data
   * @returns {Promise<*>}
   */
  async sendMessage(name, data) {
    await this.#ensureDocument();

    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.#messageListener.sendMessage(name, data);
      } catch (error) {
        lastError = error;
        if (!isMissingReceiverError(error)) throw error;

        await sleep(250 * (attempt + 1));
        await this.#ensureDocument();
      }
    }

    throw lastError;
  }
}

export default BackgroundOffscreen;
