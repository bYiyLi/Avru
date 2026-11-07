import { localeFor, text } from '../../utils/i18n';
import { statusText } from '../../utils/connection-status';
import { localizePopup } from '../../utils/popup-view';
import { defaultEndpoint } from '../../utils/channel';
import { browser } from 'wxt/browser';
import { record } from '../../utils/protocol';
const locale = localeFor(navigator.language);
localizePopup(document, locale);
const status = document.querySelector<HTMLElement>('#status');
const form = document.querySelector<HTMLFormElement>('form');
const endpoint = document.querySelector<HTMLInputElement>('[name=endpoint]');
if (endpoint) {
  endpoint.value = defaultEndpoint();
  endpoint.readOnly = true;
}
async function request(message: unknown): Promise<void> {
  try {
    const response = record(await browser.runtime.sendMessage(message));
    if (status) status.textContent = statusText(locale, response?.status);
  } catch {
    if (status) status.textContent = text(locale, 'status.connectionFailed');
  }
}
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  request({
    type: 'pair',
    endpoint: data.get('endpoint'),
    name: data.get('name'),
  }).catch(console.error);
});
document.querySelector('#disconnect')?.addEventListener('click', () => {
  request({ type: 'disconnect' }).catch(console.error);
});
request({ type: 'status' }).catch(console.error);

setInterval(() => {
  request({ type: 'status' }).catch(console.error);
}, 1000);
