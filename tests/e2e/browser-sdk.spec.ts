import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon, testChannel } from './daemon-fixture.js';
import { endpoint, openProfile } from './browser-fixture.js';
import { verifyObservability } from './observability-helper.js';
import { verifyPageExtras } from './page-extras-helper.js';
import { verifyScreenshot } from './screenshot-helper.js';
import { verifyExecutionAudit } from './execution-audit-helper.js';
import { verifyTabsContent } from './tabs-content-helper.js';
import { verifyHistory } from './history-helper.js';
import { verifyVisualFollow } from './visual-helper.js';

type BrowserProfile = Awaited<ReturnType<typeof openProfile>>;
type RemoteTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

async function locateTab(page: Page, url: string, excludedBrowserId?: string) {
  let browserId = '';
  let tabId = -1;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${endpoint}/api/browsers`);
        if (!response.ok()) return false;
        const state = (await response.json()) as {
          browsers: {
            id: string;
            connected: boolean;
            tabs: { id: number; url: string }[];
          }[];
        };
        for (const browser of state.browsers) {
          const tab = browser.tabs.find((candidate) => candidate.url === url);
          if (browser.connected && browser.id !== excludedBrowserId && tab) {
            browserId = browser.id;
            tabId = tab.id;
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return { browserId, tabId };
}

async function grantClient(
  page: Page,
  profile: BrowserProfile,
  config: { issuer: string; remote: string; headers: Record<string, string> },
): Promise<RemoteTool> {
  const { issuer, remote, headers } = config;
  const verifier = 'v'.repeat(43);
  const query = new URLSearchParams({
    client_id: 'test-client',
    redirect_uri: 'https://client.example/callback',
    response_type: 'code',
    state: 'sdk-ci',
    resource: `${issuer}/mcp`,
    scope: 'browser:read browser:control',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const opened = profile.context.waitForEvent('page');
  const pending = page.request.get(
    `${remote}/oauth/authorize?${query.toString()}`,
    {
      headers,
      maxRedirects: 0,
    },
  );
  const popup = await opened;
  await popup.getByRole('button', { name: /^(Allow|允许)$/ }).click();
  const authorized = await pending;
  const code = new URL(authorized.headers().location ?? '').searchParams.get(
    'code',
  );
  expect(code).toBeTruthy();
  const exchanged = await page.request.post(`${remote}/oauth/token`, {
    headers,
    form: {
      grant_type: 'authorization_code',
      client_id: 'test-client',
      code: code ?? '',
      code_verifier: verifier,
      redirect_uri: 'https://client.example/callback',
      resource: `${issuer}/mcp`,
    },
  });
  const token = ((await exchanged.json()) as { access_token: string })
    .access_token;
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await page.request.post(`${remote}/mcp`, {
      headers: {
        ...headers,
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
      },
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    expect(body.result.isError).not.toBe(true);
    return JSON.parse(body.result.content[0]?.text ?? 'null') as Record<
      string,
      unknown
    >;
  };
  return call;
}

async function verifyCua(
  call: RemoteTool,
  tab: Page,
  browserId: string,
  tabId: number,
): Promise<void> {
  const input = await tab.locator('#query').boundingBox();
  const button = await tab.locator('#submit').boundingBox();
  expect(input).not.toBeNull();
  expect(button).not.toBeNull();
  if (!input || !button) throw new Error('CUA targets are not visible');
  const point = (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  const submitted = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script:
      'await browser.tab.cua.click(' +
      JSON.stringify(point(input)) +
      ');' +
      'await browser.tab.cua.keypress({keys:["Meta","a"]});' +
      'await browser.tab.cua.type({text:"tablets"});' +
      'await browser.tab.cua.move(' +
      JSON.stringify(point(button)) +
      ');' +
      'await browser.tab.cua.click(' +
      JSON.stringify(point(button)) +
      ');' +
      'const matched = (await browser.tab.waitFor({kind:"text",value:"Results: tablets",timeoutMs:4000})).matched;' +
      'return { matched, value: await browser.tab.evaluate("document.querySelector(\'#query\').value"),' +
      'message: await browser.tab.evaluate("document.querySelector(\'#message\').textContent") };',
  });
  await expect
    .poll(
      async () => {
        const state = await call('browser_get_execution', {
          executionId: submitted.executionId,
        });
        if (state.state !== 'succeeded') return state.state;
        expect(state.result).toEqual({
          matched: true,
          value: 'tablets',
          message: 'Results: tablets',
        });
        return 'succeeded';
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  await expect(tab.locator('#message')).toHaveText('Results: tablets');
}

async function verifyDomCua(
  call: RemoteTool,
  tab: Page,
  browserId: string,
  tabId: number,
): Promise<void> {
  const submitted = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script:
      'const tree = await browser.tab.dom.getVisibleTree();' +
      'const input = tree.nodes.find(node => node.role === "textbox");' +
      'await browser.tab.dom.fill(input.nodeId, "cameras");' +
      'const refreshed = await browser.tab.dom.getVisibleTree();' +
      'const button = refreshed.nodes.find(node => node.role === "button");' +
      'await browser.tab.dom.click({node_id:button.node_id});' +
      'return (await browser.tab.waitFor({kind:"text",value:"Results: cameras",timeoutMs:4000})).matched;',
  });
  await expect
    .poll(
      async () => {
        const result = await call('browser_get_execution', {
          executionId: submitted.executionId,
        });
        if (result.state !== 'succeeded') return result.state;
        expect(result.result).toBe(true);
        return 'succeeded';
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  await expect(tab.locator('#message')).toHaveText('Results: cameras');
}

async function verifyAx(
  call: RemoteTool,
  tab: Page,
  browserId: string,
  tabId: number,
): Promise<void> {
  const submitted = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script:
      'const ax = await browser.tab.ax.snapshot();' +
      'const input = ax.nodes.find(n => n.role === "textbox" && n.name === "Search");' +
      'if (!input) return {error:"AX_TEXTBOX_NOT_FOUND",ax};' +
      'await browser.tab.ax.setValue(input.index, "speakers");' +
      'const next = await browser.tab.ax.snapshot();' +
      'const button = next.nodes.find(n => n.role === "button" && n.name === "Search");' +
      'if (!button) return {error:"AX_BUTTON_NOT_FOUND",next};' +
      'await browser.tab.ax.click(button.index);' +
      'return (await browser.tab.waitFor({kind:"text",value:"Results: speakers",timeoutMs:4000})).matched;',
  });
  await expect
    .poll(
      async () => {
        const result = await call('browser_get_execution', {
          executionId: submitted.executionId,
        });
        if (result.state !== 'succeeded') return result.state;
        expect(result.result).toBe(true);
        return 'succeeded';
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  await expect(tab.locator('#message')).toHaveText('Results: speakers');
}

async function verifyTabLifecycle(
  call: RemoteTool,
  profile: BrowserProfile,
  browserId: string,
  tabId: number,
): Promise<void> {
  const startingPages = profile.context.pages().length;
  await profile.context.route('https://avru.example/new-tab', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<title>Avru new tab</title>',
    });
  });
  const submitted = await call('browser_run_script', {
    browserId,
    tabId: String(tabId),
    script:
      'const created = await browser.tabs.new("https://avru.example/new-tab", {active:false});' +
      'const windows = await browser.windows.list();' +
      'await browser.tabs.move(created.tabId,{index:-1});' +
      'await browser.tabs.select(created.tabId);' +
      'const selected = await browser.tabs.selected();' +
      'await browser.tabs.close(created.tabId);' +
      'return {created,selected,windowCount:windows.length};',
  });
  await expect
    .poll(
      async () => {
        const status = await call('browser_get_execution', {
          executionId: submitted.executionId,
        });
        if (status.state !== 'succeeded') return status.state;
        const response = status.result as {
          created: { tabId: string };
          selected: { tabId: string };
          windowCount: number;
        };
        expect(response.selected.tabId).toBe(response.created.tabId);
        expect(response.windowCount).toBeGreaterThanOrEqual(1);
        return 'succeeded';
      },
      { timeout: 15_000 },
    )
    .toBe('succeeded');
  await expect
    .poll(() => profile.context.pages().length, { timeout: 5_000 })
    .toBe(startingPages);
}

test('real extension and QuickJS read page through browser SDK MCP', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'avru-sdk-e2e-'));
  const issuer = 'https://avru.example';
  const oauthPort = Number(process.env.AVRU_E2E_OAUTH_PORT ?? 43823);
  const remote = `http://127.0.0.1:${String(oauthPort)}`;
  const headers = { host: 'avru.example' };
  const config = join(root, 'oauth.json');
  await writeFile(
    config,
    JSON.stringify({
      issuer,
      port: oauthPort,
      channel: testChannel,
      clients: [
        {
          id: 'test-client',
          name: 'SDK E2E',
          redirectUris: ['https://client.example/callback'],
        },
      ],
    }),
  );
  const daemon = await startDaemon(join(root, 'data'), config);
  let profile: Awaited<ReturnType<typeof openProfile>> | undefined;
  let secondary: Awaited<ReturnType<typeof openProfile>> | undefined;
  try {
    profile = await openProfile(join(root, 'browser'));
    const tab = await profile.context.newPage();
    await tab.route('https://avru.example/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: '<title>Avru SDK</title><main id="message">Avru isolated browser execution</main><input aria-label="Search" id="query"><button id="submit" onclick="document.getElementById(\'message\').textContent = \'Results: \' + document.getElementById(\'query\').value">Search</button>',
      });
    });
    await tab.goto('https://avru.example/sdk');
    const { browserId, tabId } = await locateTab(
      page,
      'https://avru.example/sdk',
    );
    const call = await grantClient(page, profile, { issuer, remote, headers });
    const submitted = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script: 'return await browser.tab.snapshot();',
    });
    const executionId = submitted.executionId as string;
    await expect
      .poll(
        async () => {
          const result = await call('browser_get_execution', { executionId });
          if (result.state !== 'succeeded') return result.state;
          const value = result.result as { title: string; text: string };
          expect(value.title).toBe('Avru SDK');
          expect(value.text).toContain('Avru isolated browser execution');
          return 'succeeded';
        },
        { timeout: 15_000 },
      )
      .toBe('succeeded');
    // A second task reuses the same selected tab without a manual claim.
    // The CDP command is routed from QuickJS to the real Chromium debugger.
    const cdp = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script:
        'return await browser.tab.cdp.send("Runtime.evaluate", {expression:"document.title", returnByValue:true});',
    });
    await expect
      .poll(
        async () => {
          const result = await call('browser_get_execution', {
            executionId: cdp.executionId,
          });
          if (result.state !== 'succeeded') return result.state;
          const response = result.result as {
            result?: { value?: unknown };
          };
          expect(response.result?.value).toBe('Avru SDK');
          return 'succeeded';
        },
        { timeout: 15_000 },
      )
      .toBe('succeeded');
    await verifyExecutionAudit(page, String(cdp.executionId), browserId, tabId);
    // Semantic SDK methods must use fresh element references and real CDP
    // mouse events, rather than merely returning a mocked action result.
    const interactive = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script:
        'const a = await browser.tab.snapshot(); ' +
        'const input = a.root.children.find(n => n.role === "textbox"); ' +
        'await browser.tab.fill(input.ref, "headphones"); ' +
        'const b = await browser.tab.snapshot(); ' +
        'const button = b.root.children.find(n => n.role === "button"); ' +
        'await browser.tab.click(button.ref); ' +
        'return (await browser.tab.waitFor({kind: "text", value: "Results: headphones", timeoutMs: 4000})).matched;',
    });
    await expect
      .poll(
        async () => {
          const result = await call('browser_get_execution', {
            executionId: interactive.executionId,
          });
          if (result.state === 'failed')
            throw new Error(
              'Interactive SDK execution failed: ' + JSON.stringify(result),
            );
          if (result.state !== 'succeeded') return result.state;
          expect(result.result).toBe(true);
          return 'succeeded';
        },
        { timeout: 15_000 },
      )
      .toBe('succeeded');
    await expect(tab.locator('#message')).toHaveText('Results: headphones');
    // Avru's production locator API, not Playwright as the browser driver:
    // refresh the element snapshot before each action in the same AI task.
    const locatorRun = await call('browser_run_script', {
      browserId,
      tabId: String(tabId),
      script:
        'await browser.tab.playwright.getByRole("textbox", {name:"Search"}).fill("laptops"); ' +
        'await browser.tab.locator("#submit").click(); ' +
        'return (await browser.tab.waitFor({kind:"text",value:"Results: laptops",timeoutMs:4000})).matched;',
    });
    await expect
      .poll(
        async () => {
          const result = await call('browser_get_execution', {
            executionId: locatorRun.executionId,
          });
          if (result.state !== 'succeeded') return result.state;
          expect(result.result).toBe(true);
          return 'succeeded';
        },
        { timeout: 15_000 },
      )
      .toBe('succeeded');
    await expect(tab.locator('#message')).toHaveText('Results: laptops');
    // A user-opened spectator tab must not prevent AI from following its task tab.
    const spectator = await profile.context.newPage();
    await spectator.goto('about:blank');
    await verifyCua(call, tab, browserId, tabId);
    const currentProfile = profile;
    await verifyVisualFollow(tab, () =>
      currentProfile.worker.evaluate<boolean>(
        `chrome.tabs.get(${String(tabId)}).then(tab=>tab.active===true)`,
      ),
    );
    await spectator.close();
    await verifyDomCua(call, tab, browserId, tabId);
    await verifyAx(call, tab, browserId, tabId);
    await verifyObservability(call, tab, browserId, tabId);
    await verifyPageExtras(call, tab, browserId, tabId);
    await verifyScreenshot(call, browserId, tabId);
    await verifyTabLifecycle(call, profile, browserId, tabId);
    await verifyTabsContent(call, profile, browserId, tabId);
    await verifyHistory(call, browserId, tabId);

    // A later connected browser profile is immediately discoverable and
    // controllable by the same authenticated AI client, without a new
    // per-tab claim or browser-specific approval.
    secondary = await openProfile(join(root, 'browser-secondary'));
    const secondaryTab = await secondary.context.newPage();
    await secondaryTab.route(
      'https://avru.example/secondary',
      async (route) => {
        await route.fulfill({
          contentType: 'text/html',
          body: '<title>Secondary profile</title><main>Before control</main>',
        });
      },
    );
    await secondaryTab.goto('https://avru.example/secondary');
    const { browserId: secondaryId, tabId: secondaryTabId } = await locateTab(
      page,
      'https://avru.example/secondary',
      browserId,
    );
    const discovered = await call('browser_list', {});
    const available = discovered.browsers as {
      browserId: string;
      tabs: { tabId: string }[];
    }[];
    expect(available.some((item) => item.browserId === browserId)).toBe(true);
    expect(available.some((item) => item.browserId === secondaryId)).toBe(true);
    const secondRun = await call('browser_run_script', {
      browserId: secondaryId,
      tabId: String(secondaryTabId),
      script: `return await browser.tab.cdp.send("Runtime.evaluate", {expression:"document.querySelector('main').textContent = 'Controlled by Avru'", returnByValue:true});`,
    });
    await expect
      .poll(
        async () => {
          const response = await call('browser_get_execution', {
            executionId: secondRun.executionId,
          });
          return response.state;
        },
        { timeout: 15_000 },
      )
      .toBe('succeeded');
    await expect(secondaryTab.locator('main')).toHaveText('Controlled by Avru');
  } finally {
    await secondary?.context.close();
    await profile?.context.close();
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});
