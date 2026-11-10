import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';
import { SDK_CAPABILITIES, installSdk } from '../src/sdk';
import type { QuickJSContext } from 'quickjs-emscripten';

describe('QuickJS CDP SDK', () => {
  it('exposes arbitrary CDP methods without a command allowlist', async () => {
    const invoke = vi.fn((method: string, json: string) => {
      expect(method).toBe('cdp.send');
      expect(JSON.parse(json)).toEqual([
        'Storage.getCookies',
        { browserContextId: 'test' },
      ]);
      return Promise.resolve(JSON.stringify({ cookies: [] }));
    });
    const result = await execute(
      'return await browser.tab.cdp.send("Storage.getCookies", { browserContextId: "test" });',
      invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '{"cookies":[]}' });
    expect(invoke).toHaveBeenCalledOnce();
  });
  it('surfaces event reads and cursor capture', async () => {
    const invoke = vi.fn((method: string, json: string) =>
      Promise.resolve(
        JSON.stringify({ method, args: JSON.parse(json) as unknown }),
      ),
    );
    const result = await execute(
      'return {cursor: await browser.tab.cdp.cursor(), events: await browser.tab.cdp.events("12")};',
      invoke,
    );
    expect(result.status).toBe('completed');
    expect(invoke.mock.calls).toEqual([
      ['cdp.cursor', '[]', expect.anything()],
      ['cdp.events', '["12"]', expect.anything()],
    ]);
  });
  it('rejects non-object CDP parameters before calling host', async () => {
    const invoke = vi.fn(() => Promise.resolve('{}'));
    const result = await execute(
      'return await browser.tab.cdp.send("Runtime.evaluate", ["invalid"]);',
      invoke,
    );
    expect(result.status).toBe('failed');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('advertises the three CDP capabilities', () => {
    expect(
      SDK_CAPABILITIES.filter((item) => item.name.startsWith('cdp.')),
    ).toHaveLength(3);
  });
  it('reads the target page URL and a bounded text snapshot through CDP', async () => {
    const invoke = vi.fn((method: string, json: string) => {
      expect(method).toBe('cdp.send');
      const args = JSON.parse(json) as [
        string,
        { expression: string; returnByValue: boolean },
      ];
      expect(args[0]).toBe('Runtime.evaluate');
      expect(args[1].returnByValue).toBe(true);
      const value =
        args[1].expression.includes('location.href') &&
        !args[1].expression.includes('const KEY =')
          ? 'https://example.test/page?a=1'
          : {
              title: 'Example',
              url: 'https://example.test/page',
              text: 'Body',
              truncated: false,
            };
      return Promise.resolve(JSON.stringify({ result: { value } }));
    });
    const result = await execute(
      'return {url: await browser.tab.url(), page: await browser.tab.snapshot()};',
      invoke,
    );
    expect(result).toEqual({
      status: 'completed',
      json: JSON.stringify({
        url: 'https://example.test/page?a=1',
        page: {
          title: 'Example',
          url: 'https://example.test/page',
          text: 'Body',
          truncated: false,
        },
      }),
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('passes serializable evaluation arguments into the page expression', async () => {
    const invoke = vi.fn((method: string, json: string) => {
      expect(method).toBe('cdp.send');
      const args = JSON.parse(json) as [
        string,
        { expression: string; awaitPromise: boolean },
      ];
      expect(args[0]).toBe('Runtime.evaluate');
      expect(args[1].awaitPromise).toBe(true);
      expect(args[1].expression).toContain('const args = {"answer":42}');
      return Promise.resolve(JSON.stringify({ result: { value: 42 } }));
    });
    const result = await execute(
      'return await browser.tab.evaluate("args.answer", {answer: 42});',
      invoke,
    );
    expect(result).toEqual({ status: 'completed', json: '42' });
  });
  it('fails closed on an evaluation exception and invalid arguments', async () => {
    const failure = await execute('return await browser.tab.url();', () =>
      Promise.resolve(
        JSON.stringify({ exceptionDetails: { text: 'inaccessible' } }),
      ),
    );
    expect(failure.status).toBe('failed');
    const invoke = vi.fn(() => Promise.resolve('{}'));
    const rejected = await execute(
      'const x = {}; x.self = x; return await browser.tab.evaluate("1", x);',
      invoke,
    );
    expect(rejected.status).toBe('failed');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('fails closed when the browser SDK global cannot be frozen', () => {
    const dispose = vi.fn();
    let evalCount = 0;
    const evalCode = vi.fn(() => {
      evalCount += 1;
      return evalCount === 10 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk install failed');
    expect(evalCode).toHaveBeenCalledTimes(10);
  });
});

describe('SDK layer installation failure modes', () => {
  it('fails closed when the page API cannot be injected into QuickJS', () => {
    const dispose = vi.fn();
    let count = 0;
    const evalCode = vi.fn(() => {
      count += 1;
      return count === 2 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk page API install failed');
    expect(evalCode).toHaveBeenCalledTimes(2);
  });
  it('fails closed when CUA script injection fails', () => {
    const dispose = vi.fn();
    let count = 0;
    const evalCode = vi.fn(() => {
      count += 1;
      return count === 3 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk cua API install failed');
    expect(evalCode).toHaveBeenCalledTimes(3);
  });
  it('fails closed when the DOM CUA layer cannot be installed', () => {
    const dispose = vi.fn();
    let calls = 0;
    const evalCode = vi.fn(() => {
      calls += 1;
      return calls === 4 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk DOM CUA install failed');
    expect(evalCode).toHaveBeenCalledTimes(4);
  });
  it('fails closed when observability SDK injection fails', () => {
    const dispose = vi.fn();
    let calls = 0;
    const evalCode = vi.fn(() => {
      calls += 1;
      return calls === 6 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk observability API install failed');
    expect(evalCode).toHaveBeenCalledTimes(6);
  });
  it('fails closed when screenshot SDK injection fails', () => {
    const dispose = vi.fn();
    let calls = 0;
    const evalCode = vi.fn(() => {
      calls += 1;
      return calls === 7 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk screenshot API install failed');
    expect(evalCode).toHaveBeenCalledTimes(7);
  });
  it('fails closed when accessibility SDK injection fails', () => {
    const dispose = vi.fn();
    let calls = 0;
    const evalCode = vi.fn(() => {
      calls += 1;
      return calls === 5 ? { error: { dispose } } : { value: { dispose } };
    });
    const vm = {
      global: {},
      evalCode,
      getProp: vi.fn(() => ({ dispose })),
    } as unknown as QuickJSContext;
    expect(() => {
      installSdk(vm);
    }).toThrow('sdk AX API install failed');
    expect(evalCode).toHaveBeenCalledTimes(5);
  });
});
