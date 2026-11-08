import { defaultEndpoint } from '../utils/channel';
import { extensionChannel } from '../utils/channel';
import type { ConsentRequest } from '../utils/oauth-consent';
import { ConsentController } from '../utils/oauth-consent';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { Connection } from '../utils/connection';
import { browserMetadata } from '../utils/metadata';
import { record } from '../utils/protocol';

function createConsent(
  decide: (request: ConsentRequest, approved: boolean) => void,
): ConsentController {
  const consent = new ConsentController({
    open: async () => {
      const window = await browser.windows.create({
        url: `chrome-extension://${browser.runtime.id}/consent.html`,
        type: 'popup',
        width: 480,
        height: 600,
        focused: true,
      });
      if (window?.id === undefined)
        throw new Error('Consent window unavailable');
      return window.id;
    },
    close: (id) => browser.windows.remove(id),
    decide,
    now: Date.now,
  });
  browser.windows.onRemoved.addListener((id) => {
    consent.removed(id);
  });
  return consent;
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    browser.tabs.create({ url: `${defaultEndpoint()}/#overview` }).catch(() => {
      console.warn('Avru management page unavailable');
    });
  });
  const consent = createConsent((request, approved) => {
    connection.decideOAuth(request, approved);
  });
  const connection = new Connection({
    local: true,
    channel: extensionChannel(),
    onOAuthRequest: (request) => consent.show(request),
    onOAuthClose: (id) => {
      consent.close(id);
    },
    resetOAuth: () => {
      consent.reset();
    },
    metadata: () =>
      browserMetadata(navigator, browser.runtime.getManifest().version),
    read: async () =>
      (await browser.storage.local.get('connection')).connection,
    save: async (value) => {
      await browser.storage.local.set({ connection: value });
    },
    clear: async () => {
      await browser.storage.local.remove('connection');
    },
    tabs: () => browser.tabs.query({}),
    socket: (url) => new WebSocket(url),
    uuid: () => crypto.randomUUID(),
    later: (callback, delay) => setTimeout(callback, delay),
    cancel: (timer) => {
      clearTimeout(timer);
    },
  });
  const started = connection.start();
  const handleError = () => {
    console.warn('Avru local connection unavailable');
  };
  const publish = () => {
    connection.publish().catch(handleError);
  };
  browser.tabs.onCreated.addListener(publish);
  browser.tabs.onUpdated.addListener(publish);
  browser.tabs.onRemoved.addListener(publish);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'avru-reconnect') connection.reconnect();
  });
  browser.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (
      sender.id === browser.runtime.id &&
      sender.url === `chrome-extension://${browser.runtime.id}/consent.html`
    ) {
      const message = record(raw);
      consent
        .message(
          raw,
          typeof message?.windowId === 'number' ? message.windowId : undefined,
        )
        .then(respond, () => {
          respond(null);
        });
      return true;
    }
    return false;
  });
  browser.alarms
    .create('avru-reconnect', { periodInMinutes: 1 })
    .catch(handleError);
  started.catch(handleError);
});
