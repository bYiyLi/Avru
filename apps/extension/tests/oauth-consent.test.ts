import { afterEach, expect, it, vi } from 'vitest';
import { ConsentController, consentRequest } from '../utils/oauth-consent';
const sample = () => ({
  requestId: 'request',
  nonce: 'nonce',
  clientName: 'Example',
  redirectUri: 'https://example.com/callback',
  resource: 'https://avru.example/mcp',
  scope: 'browser:read' as const,
  expiresAt: Date.now() + 10_000,
});
afterEach(() => vi.useRealTimers());
it('validates bounded, expiring HTTPS consent requests', () => {
  const value = sample();
  expect(consentRequest(value)).toEqual(value);
  for (const bad of [
    null,
    {},
    { ...value, nonce: '' },
    { ...value, expiresAt: NaN },
    { ...value, expiresAt: Date.now() - 1 },
    { ...value, expiresAt: Date.now() + 200_000 },
    { ...value, scope: 'all' },
    { ...value, resource: 'http://evil.test' },
    { ...value, redirectUri: 'https://user:password@example.com/' },
    { ...value, resource: 'bad' },
  ])
    expect(() => consentRequest(bad)).toThrow();
});
function setup() {
  const ports = {
    open: vi.fn().mockResolvedValue(7),
    close: vi.fn().mockResolvedValue(undefined),
    decide: vi.fn(),
    now: Date.now,
  };
  return { ports, controller: new ConsentController(ports) };
}
it('only displayed window can read and settle once; nonce never reaches display', async () => {
  vi.useFakeTimers();
  const { ports, controller } = setup();
  expect(await controller.message({}, 7)).toBeNull();
  await controller.show(sample());
  expect(
    await controller.message({ type: 'oauth-consent-read' }, 8),
  ).toBeNull();
  expect(
    await controller.message({ type: 'oauth-consent-read' }, undefined),
  ).toBeNull();
  expect(
    await controller.message({ type: 'oauth-consent-read' }, 7),
  ).not.toHaveProperty('nonce');
  expect(await controller.message(null, 7)).toBeNull();
  expect(
    await controller.message(
      { type: 'oauth-consent-decide', requestId: 'other', approved: true },
      7,
    ),
  ).toBeNull();
  expect(
    await controller.message(
      { type: 'oauth-consent-decide', requestId: 'request', approved: true },
      7,
    ),
  ).toEqual({ accepted: true });
  controller.removed(7);
  expect(ports.decide).toHaveBeenCalledTimes(1);
  expect(ports.decide).toHaveBeenCalledWith(
    expect.objectContaining({ nonce: 'nonce' }),
    true,
  );
  expect(ports.close).toHaveBeenCalledWith(7);
});
it('denies timeout, close and creation failure; reset never approves', async () => {
  vi.useFakeTimers();
  const { ports, controller } = setup();
  await controller.show(sample());
  controller.removed(8);
  controller.removed(7);
  expect(ports.decide).toHaveBeenLastCalledWith(expect.anything(), false);
  await controller.show(sample());
  controller.close('other');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(ports.decide).toHaveBeenCalledTimes(2);
  ports.open.mockRejectedValueOnce(new Error('unavailable'));
  await controller.show(sample());
  expect(ports.decide).toHaveBeenCalledTimes(3);
  await controller.show(sample());
  controller.close('request');
  expect(ports.decide).toHaveBeenCalledTimes(3);
  ports.close.mockRejectedValueOnce(new Error('already closed'));
  await controller.show(sample());
  controller.reset();
  await Promise.resolve();
});
it('discards delayed windows after reset and checks expiry before a click', async () => {
  vi.useFakeTimers();
  const { ports, controller } = setup();
  let resolve: (id: number) => void = () => undefined;
  ports.open.mockImplementationOnce(
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  );
  const opening = controller.show(sample());
  controller.reset();
  resolve(9);
  await opening;
  expect(ports.close).toHaveBeenCalledWith(9);
  await controller.show(sample());
  vi.setSystemTime(Date.now() + 11_000);
  expect(
    await controller.message({ type: 'oauth-consent-read' }, 7),
  ).toBeNull();
  expect(ports.decide).toHaveBeenLastCalledWith(expect.anything(), false);
});
