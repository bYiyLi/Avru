import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { Connection } from '../utils/connection';
import { browserMetadata } from '../utils/metadata';
import { record } from '../utils/protocol';

export default defineBackground(() => {
  const connection = new Connection({
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
  const handleMessage = async (raw: unknown) => {
    const message = record(raw);
    if (
      message?.type === 'pair' &&
      typeof message.endpoint === 'string' &&
      typeof message.name === 'string'
    ) {
      await connection.pair({ endpoint: message.endpoint, name: message.name });
    } else if (message?.type === 'disconnect') await connection.disconnect();
    return { status: connection.status() };
  };
  browser.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
    if (
      sender.id !== browser.runtime.id ||
      sender.url !== `chrome-extension://${browser.runtime.id}/popup.html`
    )
      return false;
    handleMessage(raw).then(respond, () => {
      respond({ status: '请求失败，请检查连接信息' });
    });
    return true;
  });
  browser.alarms
    .create('avru-reconnect', { periodInMinutes: 1 })
    .catch(handleError);
  connection.start().catch(handleError);
});
