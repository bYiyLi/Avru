import { describe, expect, it, vi } from 'vitest';
import { execute } from '../src/engine';

describe('QuickJS engine error propagation and cancellation', () => {
  it('preserves a structured host error code without exposing Node globals', async () => {
    const host = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('host unavailable'), {
          code: 'EXTENSION_OFFLINE',
        }),
      ),
    );
    const result = await execute(
      'try {await __hostCall("tab.title","[]");return "bad";}' +
        'catch(error){return {code:error.code,ambient:typeof process};}',
      host,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '{"code":"EXTENSION_OFFLINE","ambient":"undefined"}',
    });
    expect(host).toHaveBeenCalledOnce();
  });

  it('uses a safe error code when a host bridge rejects with a plain Error', async () => {
    const host = vi.fn(() =>
      Promise.reject(new Error('sensitive host message')),
    );
    const result = await execute(
      'try {await __hostCall("tab.title","[]");return "bad";}' +
        'catch(error){return error.code;}',
      host,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '"BRIDGE_REJECTED"',
    });
  });

  it('normalizes an empty host rejection reason to a safe error code', async () => {
    // A faulty host adapter can reject without passing an Error instance.
    const host = vi.fn(() => {
      return new Promise<string>((_resolve, reject) => {
        Reflect.apply(reject, undefined, []);
      });
    });
    const result = await execute(
      'try {await __hostCall("tab.title","[]");return "bad";}' +
        'catch(error){return error.code;}',
      host,
    );
    expect(result).toEqual({
      status: 'completed',
      json: '"BRIDGE_REJECTED"',
    });
    expect(host).toHaveBeenCalledOnce();
  });

  it('reports an already cancelled task as cancelled rather than failed', async () => {
    const controller = new AbortController();
    controller.abort();
    const host = vi.fn(() => Promise.resolve('{}'));
    const result = await execute('return 123;', host, 4_000, {
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
    expect(host).not.toHaveBeenCalled();
  });

  it('bounds each task result even if the guest script is otherwise valid', async () => {
    const result = await execute('return "x".repeat(1000);', undefined, 4_000, {
      maxOutputBytes: 100,
    });
    expect(result).toEqual({
      status: 'failed',
      reason: 'output',
    });
  });

  it('limits the number of host calls on a per-task basis', async () => {
    const host = vi.fn(() => Promise.resolve('{}'));
    const result = await execute(
      'await __hostCall("tab.title","[]");await __hostCall("tab.title","[]");return true;',
      host,
      4_000,
      { maxBridgeCalls: 1 },
    );
    expect(result.status).toBe('failed');
    expect(host).toHaveBeenCalledOnce();
  });
});
