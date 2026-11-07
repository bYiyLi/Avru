import { browser } from 'wxt/browser';
import { record } from '../../utils/protocol';
const status = document.querySelector<HTMLElement>('#status');
const form = document.querySelector<HTMLFormElement>('form');
async function request(message: unknown): Promise<void> {
  try {
    const response = record(await browser.runtime.sendMessage(message));
    if (status)
      status.textContent =
        typeof response?.status === 'string' ? response.status : '后台未就绪';
  } catch {
    if (status) status.textContent = '连接失败，请检查配对信息和守护进程';
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
