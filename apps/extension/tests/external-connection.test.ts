import { expect, it, vi } from 'vitest';
import type { Connection } from '../utils/connection';
import { ExternalConnection } from '../utils/external-connection';
const endpoint = 'http://127.0.0.1:43822';
const sender = {
  url: `${endpoint}/`,
  origin: endpoint,
  documentId: 'doc',
  frameId: 0,
  tab: { id: 1, incognito: false },
};
const challenge = 'a'.repeat(64);
function setup() {
  const connection = {
    inspect: vi.fn().mockReturnValue({ status: 'unpaired', autoAllowed: true }),
    probe: vi.fn().mockResolvedValue(challenge),
    redeem: vi.fn(),
  };
  let now = 0;
  const bridge = new ExternalConnection(
    connection as unknown as Connection,
    endpoint,
    '0.0.1',
    () => now,
  );
  return {
    connection,
    bridge,
    expire: () => {
      now = 30000;
    },
  };
}
it('detects and binds a single redemption to the same top-level document', async () => {
  const { bridge, connection } = setup();
  expect(await bridge.message({ type: 'avru-detect' }, sender)).toEqual({
    version: '0.0.1',
    status: 'unpaired',
    autoAllowed: true,
  });
  expect(await bridge.message({ type: 'avru-probe' }, sender)).toEqual({
    challenge,
  });
  expect(
    await bridge.message(
      { type: 'avru-redeem', challenge, ticket: 'b'.repeat(64) },
      sender,
    ),
  ).toEqual({ accepted: true });
  expect(connection.redeem).toHaveBeenCalledOnce();
  await expect(
    bridge.message(
      { type: 'avru-redeem', challenge, ticket: 'b'.repeat(64) },
      sender,
    ),
  ).rejects.toThrow('Expired');
});
it('rejects wrong origin, port, frame, extension, missing fields and private context', async () => {
  const { bridge } = setup();
  for (const changed of [
    {},
    { ...sender, id: 'other' },
    { ...sender, origin: 'null' },
    { ...sender, url: `${endpoint}/other` },
    { ...sender, frameId: 1 },
    { ...sender, documentId: undefined },
    { ...sender, tab: { id: 2, incognito: true } },
    { ...sender, tab: { incognito: false } },
  ]) {
    await expect(
      bridge.message({ type: 'avru-detect' }, changed),
    ).rejects.toThrow('Untrusted');
  }
});
it('rejects navigation, other profiles, mismatched challenge, expiry and malformed messages', async () => {
  const h = setup();
  for (const changed of [
    { ...sender, documentId: 'new' },
    { ...sender, tab: { id: 2, incognito: false } },
  ]) {
    await h.bridge.message({ type: 'avru-probe' }, sender);
    await expect(
      h.bridge.message(
        { type: 'avru-redeem', challenge, ticket: 'b' },
        changed,
      ),
    ).rejects.toThrow('Expired');
  }
  await h.bridge.message({ type: 'avru-probe' }, sender);
  await expect(
    h.bridge.message(
      { type: 'avru-redeem', challenge: 'wrong', ticket: 'b' },
      sender,
    ),
  ).rejects.toThrow();
  await h.bridge.message({ type: 'avru-probe' }, sender);
  h.expire();
  await expect(
    h.bridge.message({ type: 'avru-redeem', challenge, ticket: 'b' }, sender),
  ).rejects.toThrow();
  await expect(h.bridge.message(null, sender)).rejects.toThrow('Unsupported');
  expect(h.connection.redeem).not.toHaveBeenCalled();
});
it('serializes probes and clears busy state on failure', async () => {
  const h = setup();
  let complete: (value: string) => void = () => {};
  h.connection.probe.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      complete = resolve;
    }),
  );
  const first = h.bridge.message({ type: 'avru-probe' }, sender);
  await expect(
    h.bridge.message({ type: 'avru-probe' }, sender),
  ).rejects.toThrow('busy');
  complete(challenge);
  await first;
  h.connection.probe.mockRejectedValueOnce(new Error('blocked'));
  await expect(
    h.bridge.message({ type: 'avru-probe' }, sender),
  ).rejects.toThrow('blocked');
  await expect(
    h.bridge.message({ type: 'avru-probe' }, sender),
  ).resolves.toEqual({ challenge });
});
