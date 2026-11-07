import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
describe('health-only daemon scaffold', () => {
  it('states browser control is not implemented', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      service: 'avru',
      state: 'scaffold',
      browserControl: false,
    });
  });
  it.each(['/mcp', '/oauth/authorize', '/pair'])(
    'does not expose unfinished endpoint %s',
    async (url) => {
      const app = buildApp();
      apps.push(app);
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(404);
    },
  );
});
