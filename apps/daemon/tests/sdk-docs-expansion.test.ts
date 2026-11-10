import { describe, expect, it } from 'vitest';
import { SDK_DOCS, sdkDocIndex, sdkDocs } from '../src/oauth/sdk-docs';

describe('AI browser SDK documentation', () => {
  it('documents the implemented browser actions and CDP entry points', () => {
    const topics = sdkDocIndex().map((entry) => entry.topic);
    expect(topics).toEqual(
      expect.arrayContaining([
        'browser.tab.page',
        'browser.tab.actions',
        'browser.tab.playwright',
        'browser.tab.cdp',
        'browser.tab.screenshot',
        'browser.tab.observability',
        'browser.tab.cua',
        'browser.tab.dom',
        'browser.tab.ax',
        'browser.tabs.lifecycle',
      ]),
    );
    for (const topic of topics) {
      const [doc] = sdkDocs([topic]);
      expect(doc?.content.length).toBeGreaterThan(80);
    }
    expect(SDK_DOCS.length).toBe(new Set(topics).size);
  });

  it('explains that manual claiming and per-action approval are not required', () => {
    const overview = sdkDocs(['overview'])[0]?.content ?? '';
    const control = sdkDocs(['mcp.browser_run_script'])[0]?.content ?? '';
    const lifecycle = sdkDocs(['browser.tabs.lifecycle'])[0]?.content ?? '';
    expect(overview).toContain('No manual tab claim');
    expect(control).toContain('automatically locked');
    expect(lifecycle).toContain('never');
  });

  it('documents unrestricted CDP with truthful browser limits', () => {
    const cdp = sdkDocs(['browser.tab.cdp'])[0]?.content ?? '';
    expect(cdp).toContain('no Avru command whitelist');
    expect(cdp).toContain('Browser-native restrictions');
    expect(cdp).toContain('Runtime.evaluate');
  });
  it('documents CUA and DomCUA without claiming downloads are implemented', () => {
    const cua = sdkDocs(['browser.tab.cua'])[0]?.content ?? '';
    const dom = sdkDocs(['browser.tab.dom'])[0]?.content ?? '';
    expect(cua).toContain('doubleClick');
    expect(cua).toContain('NOT YET SUPPORTED');
    expect(dom).toContain('getVisibleTree');
    expect(dom).toContain('saved file path');
  });
  it('documents AX actions and unsupported screenshot streaming accurately', () => {
    const doc = sdkDocs(['browser.tab.ax'])[0]?.content ?? '';
    expect(doc).toContain('browser.tab.ax.snapshot()');
    expect(doc).toContain('platform-appropriate');
    expect(doc).toContain('NOT YET SUPPORTED');
    expect(doc).toContain('CDP itself remains unrestricted');
  });
  it('documents why dialog events must be subscribed before a modal opens', () => {
    const guide = sdkDocs(['browser.tab.observability'])[0]?.content ?? '';
    expect(guide).toContain('browser.tab.devLogs');
    expect(guide).toContain('getJsDialog()');
    expect(guide).toContain('Page.enable');
    expect(guide).toContain('before the dialog opens');
    expect(guide).toContain('dialogDismiss()');
  });
  it('documents inline JPEG limits without claiming full media delivery', () => {
    const guide = sdkDocs(['browser.tab.screenshot'])[0]?.content ?? '';
    expect(guide).toContain('Page.captureScreenshot');
    expect(guide).toContain('48 KiB');
    expect(guide).toContain('model-visible');
  });
});
