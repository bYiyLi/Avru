import { browser } from 'wxt/browser';
import { mountConsent } from '../../utils/consent-view';
import './style.css';
mountConsent(document, navigator.language, async (message) => {
  const current = await browser.windows.getCurrent();
  return browser.runtime.sendMessage({ ...message, windowId: current.id });
});
