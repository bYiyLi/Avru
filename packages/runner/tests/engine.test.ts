import { describe, it, expect, vi } from 'vitest';
import { execute } from '../src/engine.js';
import { limits } from '../src/protocol.js';
describe('isolated QuickJS engine', () => {
  it('isolates globals and denies ambient Node/network/module access', async () => {
    expect(await execute('globalThis.secret = 123; return 7;')).toEqual({
      status: 'completed',
      json: '7',
    });
    expect(
      await execute(
        'return [typeof secret, typeof process, typeof require, typeof fetch];',
      ),
    ).toEqual({
      status: 'completed',
      json: '["undefined","undefined","undefined","undefined"]',
    });
    expect((await execute("await import('node:fs');")).status).toBe('failed');
  });
  it('handles Promise jobs, serializable values and errors', async () => {
    expect(await execute('return await Promise.resolve({ok:true});')).toEqual({
      status: 'completed',
      json: '{"ok":true}',
    });
    expect(await execute('return undefined;')).toEqual({
      status: 'completed',
      json: 'null',
    });
    for (const code of [
      '}',
      'throw new Error("private text");',
      'return 1n;',
      'const a = {}; a.a=a; return a;',
    ]) {
      expect(await execute(code)).toEqual({
        status: 'failed',
        reason: 'script',
      });
    }
  });
  it('bridges only explicitly injected mock callbacks and denies by default', async () => {
    expect(
      (await execute('return await __hostCall("mock.echo", "hi");')).status,
    ).toBe('failed');
    expect(
      await execute(
        'return await __hostCall("mock.echo", "hello");',
        (_, json) => Promise.resolve(json),
      ),
    ).toEqual({ status: 'completed', json: '"hello"' });
    expect(
      (await execute('return await __hostCall("bad name", "hi");')).status,
    ).toBe('failed');
    expect(
      (
        await execute(
          'return await __hostCall("mock.echo", "x".repeat(70000));',
        )
      ).status,
    ).toBe('failed');
    expect(
      (
        await execute(
          'for(let i=0;i<33;i++) await __hostCall("mock.echo", "x");',
          () => Promise.resolve('ok'),
        )
      ).status,
    ).toBe('failed');
    expect(
      (
        await execute('return await __hostCall("mock.echo", "x");', () =>
          Promise.resolve('x'.repeat(limits.valueBytes + 1)),
        )
      ).status,
    ).toBe('failed');
  });
  it('bounds source, output, heap, stack and infinite computation', async () => {
    expect(await execute('x'.repeat(limits.sourceBytes + 1))).toEqual({
      status: 'failed',
      reason: 'protocol',
    });
    expect(await execute('return "x".repeat(70000);')).toEqual({
      status: 'failed',
      reason: 'output',
    });
    expect((await execute('return new Array(10000000).fill(1);')).status).toBe(
      'failed',
    );
    expect((await execute('function f(){return f()} return f();')).status).toBe(
      'failed',
    );
    expect(await execute('while(true){}', undefined, 20)).toEqual({
      status: 'timeout',
    });
    expect(await execute('return 42;')).toEqual({
      status: 'completed',
      json: '42',
    });
  });
  it('bounds unresolved promises and ignores late host completion after disposal', async () => {
    expect(await execute('await new Promise(()=>{});', undefined, 20)).toEqual({
      status: 'timeout',
    });
    let finish: (value: string) => void = () => undefined;
    const result = await execute(
      'return await __hostCall("mock.echo", "x");',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      20,
    );
    // A bridge call is in flight at the deadline, so the result is unknown.
    expect(result).toEqual({ status: 'unknown' });
    finish('late');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await execute('return 1;')).status).toBe('completed');
  });
});
it('joins fire-and-forget bridge work before reporting completion', async () => {
  let completed = false;
  const result = await execute(
    '__hostCall("mock.echo", "x"); return 1;',
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          completed = true;
          resolve('1');
        }, 20);
      }),
  );
  expect(completed).toBe(true);
  expect(result).toEqual({ status: 'completed', json: '1' });
});
it('does not hide a rejected fire-and-forget bridge or starve host timers with jobs', async () => {
  // M1 contract change: a bridge rejection is delivered to the script as a
  // rejected __hostCall promise (an SdkError for SDK methods). A script that
  // awaits and catches it completes normally, and the runner cannot tell
  // that apart from a fire-and-forget call it never observes
  // (quickjs-emscripten 0.32.0 has no unhandled-rejection hook), so an
  // unobserved rejection no longer fails the task; the script is the
  // authority. An awaited rejection that escapes still fails the task.
  expect(await execute('__hostCall("mock.echo", "x"); return 1;')).toEqual({
    status: 'completed',
    json: '1',
  });
  expect(
    (await execute('return await __hostCall("mock.echo", "x");')).status,
  ).toBe('failed');
  expect(
    (
      await execute(
        'function spin(){ Promise.resolve().then(spin); } spin(); return 1;',
        undefined,
        20,
      )
    ).status,
  ).toBe('timeout');
});

describe('browser SDK shell', () => {
  const tabs = [
    {
      browserId: 'b1',
      tabId: 't1',
      generation: 1,
      title: 'Example',
      url: 'https://example.test/',
      active: true,
      claimed: true,
    },
  ];
  const sdkInvoke = (method: string) => {
    if (method === 'tabs.list') return Promise.resolve(JSON.stringify(tabs));
    if (method === 'tab.title')
      return Promise.resolve(JSON.stringify('Example'));
    if (method === 'capabilities.list')
      return Promise.resolve(JSON.stringify([]));
    return Promise.reject(new Error('denied'));
  };
  it('runs the M1 acceptance script through tabs.list and tab.title', async () => {
    expect(
      await execute(
        'return { tabs: await browser.tabs.list(), title: await browser.tab.title() };',
        sdkInvoke,
      ),
    ).toEqual({
      status: 'completed',
      json: JSON.stringify({ tabs, title: 'Example' }),
    });
  });
  it('reports INVALID_ARGUMENT without sending anything to the bridge', async () => {
    const invoke = vi.fn(() => Promise.resolve('null'));
    expect(
      await execute(
        'try { await browser.tabs.get(42); return "sent"; } catch (e) { return e.code; }',
        invoke,
      ),
    ).toEqual({ status: 'completed', json: '"INVALID_ARGUMENT"' });
    expect(invoke).not.toHaveBeenCalled();
    expect(
      await execute(
        'try { await browser.capabilities.get(""); return "sent"; } catch (e) { return e.code; }',
        invoke,
      ),
    ).toEqual({ status: 'completed', json: '"INVALID_ARGUMENT"' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('surfaces bridge error codes as SdkError codes', async () => {
    const invoke = () =>
      Promise.reject(Object.assign(new Error('gone'), { code: 'TARGET_GONE' }));
    expect(
      await execute(
        'try { await browser.tabs.list(); return "ok"; } catch (e) { return [e.name, e.code]; }',
        invoke,
      ),
    ).toEqual({
      status: 'completed',
      json: '["SdkError","TARGET_GONE"]',
    });
  });
  it('exposes target ids and CDP-backed write methods', async () => {
    expect(
      await execute(
        'return [browser.tab.browserId, browser.tab.tabId, browser.tab.generation];',
        sdkInvoke,
        5000,
        {
          target: { browserId: 'b1', tabId: 't1', generation: 3 },
        },
      ),
    ).toEqual({ status: 'completed', json: '["b1","t1",3]' });
    expect(
      await execute(
        'return [typeof browser.tab.click, typeof browser.tabs.new, typeof SdkError];',
        sdkInvoke,
      ),
    ).toEqual({
      status: 'completed',
      json: '["function","function","function"]',
    });
  });
  it('returns unknown when the deadline hits with a bridge call in flight', async () => {
    expect(
      await execute(
        'return await __hostCall("mock.echo", "x");',
        () => new Promise<string>(() => undefined),
        20,
      ),
    ).toEqual({ status: 'unknown' });
  });
  it('returns cancelled when the external signal aborts', async () => {
    const controller = new AbortController();
    const pending = execute('await new Promise(()=>{});', undefined, 5000, {
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ status: 'cancelled' });
    const controller2 = new AbortController();
    const hanging = execute(
      'return await __hostCall("mock.echo", "x");',
      () => new Promise<string>(() => undefined),
      5000,
      { signal: controller2.signal },
    );
    controller2.abort();
    expect(await hanging).toEqual({ status: 'cancelled' });
  });
  it('honours per-task output and bridge-call budgets', async () => {
    expect(
      await execute('return "x".repeat(20);', undefined, 5000, {
        maxOutputBytes: 10,
      }),
    ).toEqual({ status: 'failed', reason: 'output' });
    expect(
      await execute(
        'await __hostCall("mock.echo", "x"); await __hostCall("mock.echo", "x"); return 1;',
        () => Promise.resolve('ok'),
        5000,
        { maxBridgeCalls: 1 },
      ),
    ).toEqual({ status: 'failed', reason: 'script' });
  });
});
