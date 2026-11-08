import { expect, it, vi } from 'vitest';
import { admin, processIdentity } from '../src/transports/frpc-admin.js';
const identity = {
  instance: 'a'.repeat(32),
  pid: 1,
  port: 12345,
  username: 'b'.repeat(32),
  password: 'c'.repeat(64),
  proxy: `avru-dev-${'a'.repeat(32)}`,
};
it('rejects malformed and oversized management replies without following redirects or disclosing credentials', async () => {
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
  try {
    request.mockImplementation(() =>
      Promise.resolve(
        Response.json({ https: [{ name: 'other', status: 'running' }] }),
      ),
    );
    expect(await admin(identity)).toBe(false);
    expect(await admin(identity, false, true)).toBe(false);
    request.mockResolvedValue(
      Response.json({ https: [{ name: identity.proxy, status: 'waiting' }] }),
    );
    expect(await admin(identity, false, true)).toBe(true);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
    for (const response of [
      new Response(null),
      Response.json({}),
      Response.json({ https: {} }),
      new Response('x'.repeat(65537)),
    ]) {
      request.mockResolvedValue(response);
      await expect(admin(identity)).rejects.toThrow();
    }
    request.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(admin(identity)).rejects.toThrow();
    request.mockResolvedValue(new Response(null));
    expect(await admin(identity, true)).toBe(true);
    for (const field of [
      'instance',
      'pid',
      'port',
      'username',
      'password',
      'proxy',
    ])
      expect(() => processIdentity({ ...identity, [field]: null })).toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
