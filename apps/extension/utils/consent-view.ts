import { record } from './protocol';
export function mountConsent(
  root: Document,
  language: string,
  send: (message: Record<string, unknown>) => Promise<unknown>,
): void {
  const zh = language.toLowerCase().startsWith('zh');
  const heading = root.querySelector('#heading');
  const description = root.querySelector('#description');
  const details = root.querySelector('#details');
  const status = root.querySelector('#status');
  const allow = root.querySelector<HTMLButtonElement>('#allow');
  const deny = root.querySelector<HTMLButtonElement>('#deny');
  if (!heading || !description || !details || !status || !allow || !deny)
    return;
  root.documentElement.lang = zh ? 'zh' : 'en';
  root.title = zh ? 'Avru 授权确认' : 'Avru authorization';
  heading.textContent = zh ? '允许连接 Avru？' : 'Allow access to Avru?';
  description.textContent = zh
    ? '仅允许你刚发起的请求。此授权可读取已连接浏览器的标签页标题和地址。'
    : 'Approve only a request you initiated. This permits reading connected browser tab titles and addresses.';
  allow.textContent = zh ? '允许' : 'Allow';
  deny.textContent = zh ? '拒绝' : 'Deny';
  let requestId = '';
  let decided = false;
  const decide = (approved: boolean) => {
    if (!requestId || decided) return;
    decided = true;
    allow.disabled = true;
    deny.disabled = true;
    send({ type: 'oauth-consent-decide', requestId, approved }).then(
      () => {
        status.textContent = zh
          ? '请求已提交；请返回原应用。'
          : 'Decision submitted. Return to the requesting app.';
      },
      () => {
        status.textContent = zh
          ? '连接已断开，请重新发起授权。'
          : 'Disconnected. Start authorization again.';
      },
    );
  };
  allow.addEventListener('click', () => {
    decide(true);
  });
  deny.addEventListener('click', () => {
    decide(false);
  });
  send({ type: 'oauth-consent-read' })
    .then((value) => {
      const data = record(value);
      if (!data || typeof data.requestId !== 'string')
        throw new Error('No pending request');
      requestId = data.requestId;
      for (const [key, label] of [
        ['clientName', zh ? '请求应用' : 'Application'],
        ['redirectUri', zh ? '回调地址' : 'Redirect URI'],
        ['resource', zh ? '授权服务' : 'Resource'],
      ] as const) {
        const title = root.createElement('dt');
        title.textContent = label;
        const content = root.createElement('dd');
        content.textContent = typeof data[key] === 'string' ? data[key] : '';
        details.append(title, content);
      }
      allow.disabled = false;
    })
    .catch(() => {
      status.textContent = zh
        ? '没有有效的授权请求。请关闭窗口后重新发起。'
        : 'No valid authorization request. Close this window and retry.';
    });
}
