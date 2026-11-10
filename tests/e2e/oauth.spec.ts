import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startDaemon, testChannel } from './daemon-fixture.js';
import { endpoint, openProfile, waitForProfile } from './browser-fixture.js';

test.use({ locale: 'zh-CN' });
test('real paired extension popup alone approves OAuth and revoked grants stop MCP', async ({
  page,
}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'avru-oauth-e2e-'));
  const configuration = join(directory, 'oauth.json');
  const issuer = 'https://avru.example';
  const remote = 'http://127.0.0.1:43823';
  const headers = { host: 'avru.example' };
  await writeFile(
    configuration,
    JSON.stringify({
      issuer,
      port: 43823,
      channel: testChannel,
      clients: [
        {
          id: 'test-client',
          name: 'Avru CI client',
          redirectUris: ['https://client.example/callback'],
        },
      ],
    }),
  );
  let daemon = await startDaemon(join(directory, 'data'), configuration);
  const profiles: Awaited<ReturnType<typeof openProfile>>[] = [];
  try {
    await page.goto(daemon.url);
    await page.getByRole('button', { name: '进入 Avru' }).click();
    const first = await openProfile(join(directory, 'profile'));
    profiles.push(first);
    await waitForProfile(first, page);
    const verifier = 'v'.repeat(43);
    const query = new URLSearchParams({
      client_id: 'test-client',
      redirect_uri: 'https://client.example/callback',
      response_type: 'code',
      state: 'ci-state',
      resource: `${issuer}/mcp`,
      scope: 'browser:read',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const popupOpened = first.context.waitForEvent('page');
    const waiting = page.request.get(
      `${remote}/oauth/authorize?${query.toString()}`,
      { headers, maxRedirects: 0 },
    );
    const popup = await popupOpened;
    await expect(popup).toHaveURL(
      /chrome-extension:\/\/[a-p]{32}\/consent.html/,
    );
    await expect(
      popup.getByRole('button', { name: /^(Allow|允许)$/ }),
    ).toBeEnabled();
    await expect(popup.locator('body')).toContainText('Avru CI client');
    const before = await page.request.post(`${remote}/mcp`, {
      headers,
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(before.status()).toBe(401);
    await popup.screenshot({
      path: testInfo.outputPath('extension-oauth-consent.png'),
    });
    await popup.getByRole('button', { name: /^(Allow|允许)$/ }).click();
    const authorization = await waiting;
    expect(authorization.status()).toBe(302);
    const location = new URL(authorization.headers().location ?? '');
    expect(location.searchParams.get('state')).toBe('ci-state');
    expect(location.searchParams.get('iss')).toBe(issuer);
    const tokenResponse = await page.request.post(`${remote}/oauth/token`, {
      headers,
      form: {
        grant_type: 'authorization_code',
        client_id: 'test-client',
        code: location.searchParams.get('code') ?? '',
        code_verifier: verifier,
        redirect_uri: 'https://client.example/callback',
        resource: `${issuer}/mcp`,
      },
    });
    expect(tokenResponse.status()).toBe(200);
    const token = ((await tokenResponse.json()) as { access_token: string })
      .access_token;
    const call = () =>
      page.request.post(`${remote}/mcp`, {
        headers: {
          ...headers,
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
        },
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'browser_list' },
        },
      });
    expect((await call()).status()).toBe(200);
    await page.getByRole('button', { name: '日志', exact: true }).click();
    const history = page.locator('.calls');
    await expect(
      history.getByText('browser_list', { exact: true }),
    ).toBeVisible();
    const successful = history
      .locator('tbody tr')
      .filter({ hasText: 'browser_list' });
    await expect(successful).toContainText('已完成');
    await successful.locator('summary').click();
    await expect(successful).toContainText('链路 ID');
    await expect(successful).toContainText('authorized');
    await expect(successful).toContainText('completed');
    await expect(history).not.toContainText(token);
    await page.screenshot({
      path: testInfo.outputPath('real-mcp-trace.png'),
      fullPage: true,
    });
    const key =
      new URLSearchParams(new URL(daemon.url).hash.slice(1)).get('key') ?? '';
    const localHeaders = { authorization: `Bearer ${key}`, origin: endpoint };
    const grants = await page.request.get(`${endpoint}/api/grants`, {
      headers: localHeaders,
    });
    const id = ((await grants.json()) as { grants: { id: string }[] }).grants[0]
      ?.id;
    expect(id).toBeTruthy();
    expect(
      (
        await page.request.delete(`${endpoint}/api/grants/${id ?? ''}`, {
          headers: localHeaders,
        })
      ).status(),
    ).toBe(204);
    expect((await call()).status()).toBe(401);
    await daemon.stop();
    daemon = await startDaemon(join(directory, 'data'), configuration);
    await page.goto(daemon.url);
    await page.getByRole('button', { name: '进入 Avru' }).click();
    await page.getByRole('button', { name: '日志', exact: true }).click();
    const restored = page.locator('.calls');
    await expect(restored).toContainText('本机保存');
    await expect(
      restored.getByText('browser_list', { exact: true }).first(),
    ).toBeVisible();
    await expect(restored).not.toContainText(token);
  } finally {
    for (const profile of profiles) await profile.context.close();
    await daemon.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
