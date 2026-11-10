import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';

describe('tabs lifecycle via the isolated browser SDK', () => {
  it('lists windows and moves tabs through the exact browser action routes', async () => {
    const invoked: { method: string; args: unknown }[] = [];
    const invoke = vi.fn((method: string, json: string) => {
      invoked.push({ method, args: JSON.parse(json) as unknown });
      return Promise.resolve(
        method === 'windows.list'
          ? '[{"id":"5","focused":true}]'
          : '{"ok":true,"tabId":"9","changed":true}',
      );
    });
    expect(
      await execute(
        'const windows=await browser.windows.list();' +
          'const moved=await browser.tabs.move("9",{index:0,windowId:5});' +
          'return {windows,moved};',
        invoke,
      ),
    ).toEqual({
      status: 'completed',
      json: '{"windows":[{"id":"5","focused":true}],"moved":{"ok":true,"tabId":"9","changed":true}}',
    });
    expect(invoked).toEqual([
      { method: 'windows.list', args: [] },
      { method: 'tabs.move', args: ['9', { index: 0, windowId: 5 }] },
    ]);
  });

  it('rejects invalid tab moves before reaching the browser', async () => {
    const invoke = vi.fn(() => Promise.resolve('{}'));
    const result = await execute(
      'const invalid=[["x",{index:0}],["09",{index:0}],["9",{index:-2}],' +
        '["9",{index:"2"}],["9",{index:0,windowId:-1}],["9",null]];' +
        'for(const args of invalid){try{await browser.tabs.move(...args);return "wrong";}' +
        'catch(error){if(error.code!=="INVALID_ARGUMENT")return "wrong";}}' +
        'return "validated";',
      invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"validated"' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('reads background page content through the tab content bridge', async () => {
    const invoke = vi.fn((method: string, json: string) => {
      expect(method).toBe('tabs.content');
      expect(JSON.parse(json)).toEqual([
        { contentType: 'text', urls: ['https://example.test/a'] },
      ]);
      return Promise.resolve(
        '[{"url":"https://example.test/a","title":"A","content":"Hello"}]',
      );
    });
    expect(
      await execute(
        'return await browser.tabs.content({contentType:"text", urls:["https://example.test/a"]});',
        invoke,
      ),
    ).toEqual({
      status: 'completed',
      json: '[{"url":"https://example.test/a","title":"A","content":"Hello"}]',
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('rejects malformed background content requests before browser dispatch', async () => {
    const invoke = vi.fn(() => Promise.resolve('{}'));
    expect(
      await execute(
        'const invalid=[{}, {contentType:"text",urls:[]},' +
          '{contentType:"html",urls:["file:///secret"]},' +
          '{contentType:"text",urls:["https://example.test"],timeoutMs:40000}];' +
          'for(const request of invalid){try{await browser.tabs.content(request);return "bad";}' +
          'catch(error){if(error.code!=="INVALID_ARGUMENT")return "bad";}}' +
          'return "validated";',
        invoke,
      ),
    ).toEqual({ status: 'completed', json: '"validated"' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('bridges creation, selection, discovery and closing to the host', async () => {
    const invoked: { method: string; args: unknown }[] = [];
    const invoke = vi.fn((method: string, json: string) => {
      const args = JSON.parse(json) as unknown;
      invoked.push({ method, args });
      const value =
        method === 'tabs.new'
          ? { tabId: '98', title: 'Created' }
          : method === 'tabs.selected'
            ? { tabId: '98', title: 'Created' }
            : { ok: true, tabId: '98', changed: true };
      return Promise.resolve(JSON.stringify(value));
    });
    const result = await execute(
      'const created = await browser.tabs.new("https://example.test", {active:false});' +
        'await browser.tabs.select(created.tabId);' +
        'const current = await browser.tabs.selected();' +
        'await browser.tabs.close(created.tabId);' +
        'return current.tabId;',
      invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '"98"' });
    expect(invoked).toEqual([
      { method: 'tabs.new', args: ['https://example.test', { active: false }] },
      { method: 'tabs.select', args: ['98'] },
      { method: 'tabs.selected', args: [] },
      { method: 'tabs.close', args: ['98'] },
    ]);
  });

  it('creates a default background tab using JSON-serializable arguments', async () => {
    const invoke = vi.fn((method: string, json: string) => {
      expect(method).toBe('tabs.new');
      expect(JSON.parse(json)).toEqual([null, {}]);
      return Promise.resolve('{"tabId":"9"}');
    });
    expect(await execute('return await browser.tabs.new();', invoke)).toEqual({
      status: 'completed',
      json: '{"tabId":"9"}',
    });
  });

  it('validates options and IDs before sending any browser action', async () => {
    const invoke = vi.fn(() => Promise.resolve('{}'));
    const result = await execute(
      'const invalid = [' +
        '() => browser.tabs.new(99),' +
        '() => browser.tabs.new("https://example.test", {active:"yes"}),' +
        '() => browser.tabs.close("0009"),' +
        '() => browser.tabs.select(-1)' +
        ']; for (const test of invalid) {' +
        'try { await test(); return "wrong"; } catch (e) {' +
        'if (e.code !== "INVALID_ARGUMENT") return "wrong"; }' +
        '} return "validated";',
      invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '"validated"',
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
