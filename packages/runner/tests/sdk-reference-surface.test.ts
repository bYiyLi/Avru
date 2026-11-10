import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { execute } from '../src/engine.js';

interface Reference {
  interfaces: Record<string, Record<string, unknown>>;
}

const reference = JSON.parse(
  readFileSync(
    new URL('../../../docs/26.1103.32239/docs/api.json', import.meta.url),
    'utf8',
  ),
) as Reference;

// Only the instance APIs live inside a QuickJS script. Agent/Browsers and
// Documentation are MCP-side; download/file chooser/dialogs are returned
// dynamically and have separate interaction tests.
const instancePaths = {
  Browser: 'browser',
  BrowserUser: 'browser.user',
  Tabs: 'browser.tabs',
  Tab: 'browser.tab',
  AXAPI: 'browser.tab.ax',
  ContentAPI: 'browser.tab.content',
  CUAAPI: 'browser.tab.cua',
  DomCUAAPI: 'browser.tab.dom_cua',
  PlaywrightAPI: 'browser.tab.playwright',
  PlaywrightFrameLocator: 'browser.tab.playwright.frameLocator("iframe")',
  PlaywrightLocator: 'browser.tab.playwright.locator("button")',
  TabClipboardAPI: 'browser.tab.clipboard',
  TabDevAPI: 'browser.tab.dev',
} as const;

describe('26.1103.32239 reference API structural conformance', () => {
  it('pins the 22 interfaces and all 148 members, including dynamic and MCP-only members', () => {
    expect(Object.keys(reference.interfaces)).toHaveLength(22);
    expect(
      Object.values(reference.interfaces).reduce(
        (count, api) => count + Object.keys(api).length,
        0,
      ),
    ).toBe(148);
  });

  it('exposes every script-instance member under its mapped Avru namespace', async () => {
    const source = [
      'const exposed={};',
      ...Object.entries(instancePaths).map(
        ([name, expression]) =>
          `exposed[${JSON.stringify(name)}]=Object.getOwnPropertyNames(${expression});`,
      ),
      'return exposed;',
    ].join('\n');
    const result = await execute(
      source,
      () => Promise.resolve(JSON.stringify({})),
      5000,
      { target: { browserId: 'test-browser', tabId: '7', generation: 2 } },
    );
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    const parsed: unknown = JSON.parse(result.json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('SDK member inventory did not return an object');
    const exposed = parsed as Record<string, string[]>;
    const missing: Record<string, string[]> = {};
    for (const name of Object.keys(instancePaths)) {
      const absent = Object.keys(reference.interfaces[name] ?? {}).filter(
        (member) => !exposed[name]?.includes(member),
      );
      if (absent.length > 0) missing[name] = absent;
    }
    expect(missing).toEqual({});
  });

  it('returns a PlaywrightDownload with its usable path method', async () => {
    const called: string[] = [];
    const result = await execute(
      'const download=await browser.tab.playwright.waitForEvent("download");' +
        'return {pathType:typeof download.path,saved:await download.path()};',
      (method) => {
        called.push(method);
        return Promise.resolve(
          JSON.stringify(
            method === 'tab.waitForDownload'
              ? { downloadId: '9', suggestedFilename: 'report.pdf' }
              : { path: '/tmp/report.pdf' },
          ),
        );
      },
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"pathType":"function","saved":"/tmp/report.pdf"}',
    });
    expect(called).toEqual(['tab.waitForDownload', 'tab.saveDownload']);
  });

  it('returns a PlaywrightFileChooser with isMultiple and setFiles methods', async () => {
    const called: string[] = [];
    const result = await execute(
      'const chooser=await browser.tab.playwright.waitForEvent("filechooser");' +
        'return {isMultiple:typeof chooser.isMultiple,multiple:chooser.isMultiple(),' +
        'setFiles:typeof chooser.setFiles};',
      (method) => {
        called.push(method);
        return Promise.resolve(
          JSON.stringify(
            method === 'cdp.cursor'
              ? '0'
              : method === 'cdp.events'
                ? {
                    nextCursor: '1',
                    events: [
                      {
                        method: 'Page.fileChooserOpened',
                        params: { backendNodeId: 19, mode: 'selectMultiple' },
                      },
                    ],
                  }
                : {},
          ),
        );
      },
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"isMultiple":"function","multiple":true,"setFiles":"function"}',
    });
    expect(called).toEqual([
      'cdp.send',
      'cdp.cursor',
      'cdp.send',
      'cdp.events',
      'cdp.send',
    ]);
  });
});
