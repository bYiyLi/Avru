import { afterEach, expect, it, vi } from 'vitest';
import { mountConsent } from '../utils/consent-view';
function setup() {
  const elements = new Map<
    string,
    {
      textContent: string;
      disabled: boolean;
      addEventListener: ReturnType<typeof vi.fn>;
      append: ReturnType<typeof vi.fn>;
    }
  >();
  for (const key of [
    'heading',
    'description',
    'details',
    'status',
    'allow',
    'deny',
  ])
    elements.set('#' + key, {
      textContent: '',
      disabled: false,
      addEventListener: vi.fn(),
      append: vi.fn(),
    });
  const document = {
    documentElement: { lang: '' },
    querySelector: (key: string) => elements.get(key),
    createElement: () => ({ textContent: '' }),
  } as unknown as Document;
  const click = (key: string) => {
    (
      elements.get('#' + key)?.addEventListener.mock.calls[0]?.[1] as () => void
    )();
  };
  return { document, elements, click };
}
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('renders untrusted values as text and sends one allow or deny', async () => {
  for (const language of ['zh-CN', 'en-US']) {
    const h = setup();
    const send = vi.fn().mockResolvedValue({
      requestId: 'id',
      clientName: '<script>bad</script>',
      redirectUri: 'https://a.test',
      resource: 'https://b.test',
    });
    mountConsent(h.document, language, send);
    h.click('allow');
    await flush();
    expect(h.elements.get('#details')?.append).toHaveBeenCalledTimes(3);
    expect(h.document.documentElement.lang).toBe(
      language === 'zh-CN' ? 'zh' : 'en',
    );
    h.click(language === 'zh-CN' ? 'allow' : 'deny');
    h.click('allow');
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({
      type: 'oauth-consent-decide',
      requestId: 'id',
      approved: language === 'zh-CN',
    });
    expect(h.elements.get('#status')?.textContent).toBeTruthy();
  }
});
it('handles stale windows, rejected read and failed decision', async () => {
  mountConsent(
    { querySelector: () => null } as unknown as Document,
    'en',
    vi.fn(),
  );
  for (const language of ['zh', 'en']) {
    const h = setup();
    mountConsent(h.document, language, vi.fn().mockResolvedValue(null));
    await flush();
    expect(h.elements.get('#status')?.textContent).toBeTruthy();
    const second = setup();
    mountConsent(
      second.document,
      language,
      vi
        .fn()
        .mockResolvedValueOnce({ requestId: 'id' })
        .mockRejectedValue(new Error('offline')),
    );
    await flush();
    second.click('allow');
    await flush();
    expect(second.elements.get('#status')?.textContent).toBeTruthy();
  }
});
const mocks = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ id: 7 }),
  send: vi.fn().mockResolvedValue(null),
}));
vi.mock('wxt/browser', () => ({
  browser: {
    windows: { getCurrent: mocks.get },
    runtime: { sendMessage: mocks.send },
  },
}));
it('entrypoint binds outgoing messages to actual current window', async () => {
  const h = setup();
  vi.stubGlobal('document', h.document);
  vi.stubGlobal('navigator', { language: 'en' });
  await import('../entrypoints/consent/main');
  await flush();
  expect(mocks.send).toHaveBeenCalledWith({
    type: 'oauth-consent-read',
    windowId: 7,
  });
});
