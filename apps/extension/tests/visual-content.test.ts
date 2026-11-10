import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  send: vi.fn(),
}));
vi.mock('wxt/utils/define-content-script', () => ({
  defineContentScript: (definition: unknown) => definition,
}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      onMessage: { addListener: mocks.listen },
      sendMessage: mocks.send,
    },
  },
}));
afterEach(() => {
  mocks.listen.mockClear();
  mocks.send.mockReset();
  vi.unstubAllGlobals();
});

function page(throws = false) {
  const host = {
    style: {},
    setAttribute: vi.fn(),
    append: vi.fn(),
  };
  const root = {
    append: throws
      ? vi.fn(() => {
          throw new Error('page removed');
        })
      : vi.fn(),
  };
  const link = {
    style: {},
    setAttribute: vi.fn(),
    append: vi.fn(),
    href: '',
    rel: '',
    type: '',
  };
  return {
    head: root,
    documentElement: root,
    createElement: vi.fn((tag: string) => (tag === 'link' ? link : host)),
    querySelector: vi.fn(() => null),
  };
}

it('registers the content script, restores the persisted badge, and responds to messages', async () => {
  const doc = page();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  mocks.send.mockResolvedValueOnce({
    type: 'avru.favicon.status',
    status: 'done',
    taskId: 'task-a',
  });
  const script = (await import('../entrypoints/visual.content'))
    .default as unknown as {
    matches: string[];
    main: () => void;
  };
  expect(script.matches).toEqual(['http://*/*', 'https://*/*']);
  script.main();
  expect(mocks.send).toHaveBeenCalledWith({ type: 'avru.overlay.ready' });
  const listener = mocks.listen.mock.calls[0]?.[0] as (
    message: unknown,
    sender: unknown,
    respond: (result: unknown) => void,
  ) => boolean;
  const respond = vi.fn();
  expect(listener({ type: 'untrusted' }, {}, respond)).toBe(false);
  expect(listener({ type: 'avru.cursor', x: 12, y: 24 }, {}, respond)).toBe(
    true,
  );
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(respond).toHaveBeenCalledWith({ ok: true });
  expect(doc.head.append).toHaveBeenCalledTimes(2);
  expect(doc.documentElement.append).toHaveBeenCalledTimes(2);
});

it('does not block browser actions when the page or the extension is unavailable', async () => {
  vi.stubGlobal('document', page(true));
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  mocks.send.mockRejectedValueOnce(new Error('service worker restarted'));
  const script = (await import('../entrypoints/visual.content'))
    .default as unknown as {
    main: () => void;
  };
  script.main();
  const listener = mocks.listen.mock.calls[0]?.[0] as (
    message: unknown,
    sender: unknown,
    respond: (result: unknown) => void,
  ) => boolean;
  const respond = vi.fn();
  expect(listener({ type: 'avru.cursor', x: 1, y: 2 }, {}, respond)).toBe(true);
  for (let index = 0; index < 5; index++) await Promise.resolve();
  expect(respond).toHaveBeenCalledWith({ ok: false });
});

it('ignores an absent or malformed persisted visual state without drawing a badge', async () => {
  const doc = page();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
  mocks.send.mockResolvedValueOnce({ type: 'avru.cursor', x: 'invalid', y: 2 });
  const script = (await import('../entrypoints/visual.content'))
    .default as unknown as { main: () => void };
  script.main();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(doc.head.append).not.toHaveBeenCalled();
  expect(doc.createElement).not.toHaveBeenCalled();
  expect(mocks.listen).toHaveBeenCalledOnce();
});
