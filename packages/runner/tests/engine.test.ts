import { describe, it, expect } from 'vitest';
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
    expect(result).toEqual({ status: 'timeout' });
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
  expect(
    (await execute('__hostCall("mock.echo", "x"); return 1;')).status,
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
