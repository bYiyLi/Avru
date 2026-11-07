import { afterEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: 'connected' }),
);
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: send } } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});
it('shows only status, submits pairing, clears local registration, and handles errors', async () => {
  vi.useFakeTimers();
  const status = { textContent: '' };
  const submit = vi.fn();
  const click = vi.fn();
  const form = { addEventListener: submit };
  vi.stubGlobal('document', {
    querySelector: (selector: string) =>
      selector === '#status'
        ? status
        : selector === 'form'
          ? form
          : { addEventListener: click },
  });
  vi.stubGlobal(
    'FormData',
    class {
      get(key: string) {
        return key === 'endpoint' ? 'http://127.0.0.1:43821' : 'Work';
      }
    },
  );
  await import('../entrypoints/popup/main');
  await Promise.resolve();
  expect(status.textContent).toBe('connected');
  const handler = submit.mock.calls[0]?.[1] as (event: {
    preventDefault(): void;
  }) => void;
  const preventDefault = vi.fn();
  handler({ preventDefault });
  await Promise.resolve();
  expect(preventDefault).toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith({
    type: 'pair',
    endpoint: 'http://127.0.0.1:43821',
    name: 'Work',
  });
  (click.mock.calls[0]?.[1] as () => void)();
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith({ type: 'disconnect' });
  send.mockResolvedValueOnce({});
  await vi.advanceTimersByTimeAsync(1000);
  expect(status.textContent).toBe('后台未就绪');
  send.mockRejectedValueOnce(new Error('unavailable'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(status.textContent).toContain('连接失败');
});
it('tolerates closed or absent popup elements', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { querySelector: () => null });
  send.mockRejectedValueOnce(new Error('closed'));
  await import('../entrypoints/popup/main');
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1000);
});
