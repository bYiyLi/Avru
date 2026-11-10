import { describe, expect, it } from 'vitest';
import {
  ChunkAssembler,
  frameMessage,
  sendActionInputError,
} from '../src/actions.js';

const input = {
  browserId: 'browser',
  tabId: 3,
  generation: 1,
  method: 'browser.tabs.list',
  args: [] as unknown[],
};

describe('action framing', () => {
  it('sends small messages directly and splits large ones into bounded chunks', () => {
    const direct = frameMessage(
      'request',
      { type: 'action', requestId: 'request', ...input },
      8192,
    );
    expect(direct).toEqual([
      { v: 1, type: 'action', requestId: 'request', ...input },
    ]);
    const args = ['x'.repeat(9000)];
    const frames = frameMessage(
      'request',
      { type: 'action', requestId: 'request', ...input, args },
      8192,
    );
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) {
      expect(
        Buffer.byteLength(JSON.stringify(frame), 'utf8'),
      ).toBeLessThanOrEqual(8192);
      expect(frame.type).toBe('chunk');
      expect(frame.requestId).toBe('request');
    }
    const joined = frames.map((frame) => frame.payload as string).join('');
    expect(JSON.parse(joined)).toEqual({
      v: 1,
      type: 'action',
      requestId: 'request',
      ...input,
      args,
    });
    frames.forEach((frame, index) => {
      expect(frame.index).toBe(index);
      expect(frame.total).toBe(frames.length);
    });
  });
  it('keeps chunked results inside the 1 MiB frame limit', () => {
    const frames = frameMessage(
      'request',
      {
        type: 'action_result',
        requestId: 'request',
        ok: true,
        value: 'x'.repeat(1_200_000),
      },
      1_048_576,
    );
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames)
      expect(
        Buffer.byteLength(JSON.stringify(frame), 'utf8'),
      ).toBeLessThanOrEqual(1_048_576);
    expect(frames.map((frame) => frame.payload as string).join('')).toContain(
      'x'.repeat(100),
    );
  });
});

describe('chunk reassembly', () => {
  it('reassembles out-of-order chunks', () => {
    const assembler = new ChunkAssembler();
    expect(
      assembler.feed({ requestId: 'r', index: 1, total: 2, payload: 'world' }),
    ).toEqual({ status: 'waiting' });
    expect(assembler.received).toBe(1);
    expect(
      assembler.feed({ requestId: 'r', index: 0, total: 2, payload: 'hello ' }),
    ).toEqual({ status: 'complete', json: 'hello world' });
  });
  it('rejects duplicates, total changes, oversize messages and bad ranges', () => {
    const assembler = new ChunkAssembler(10);
    expect(
      assembler.feed({ requestId: 'r', index: 0, total: 2, payload: '12345' }),
    ).toEqual({ status: 'waiting' });
    expect(
      assembler.feed({ requestId: 'r', index: 0, total: 2, payload: '12345' }),
    ).toEqual({ status: 'invalid', reason: 'Duplicate chunk' });
    expect(
      assembler.feed({ requestId: 'r', index: 1, total: 3, payload: 'x' }),
    ).toEqual({ status: 'invalid', reason: 'Chunk total changed' });
    expect(
      assembler.feed({ requestId: 'r', index: 1, total: 2, payload: '123456' }),
    ).toEqual({ status: 'invalid', reason: 'Reassembled message too large' });
    expect(
      assembler.feed({ requestId: 'r', index: 2, total: 2, payload: 'x' }),
    ).toEqual({ status: 'invalid', reason: 'Invalid chunk range' });
  });
});

describe('sendAction input validation', () => {
  it('accepts valid input and rejects bad fields', () => {
    expect(sendActionInputError(input)).toBeUndefined();
    expect(sendActionInputError({ ...input, browserId: '' })).toBe(
      'Invalid browserId',
    );
    expect(sendActionInputError({ ...input, tabId: -1 })).toBe('Invalid tabId');
    expect(sendActionInputError({ ...input, generation: 1.5 })).toBe(
      'Invalid generation',
    );
    expect(sendActionInputError({ ...input, method: '' })).toBe(
      'Invalid method',
    );
    expect(
      sendActionInputError({ ...input, args: 'nope' as unknown as unknown[] }),
    ).toBe('Invalid args');
    expect(sendActionInputError({ ...input, timeoutMs: 0 })).toBe(
      'Invalid timeoutMs',
    );
    expect(sendActionInputError({ ...input, timeoutMs: 300_001 })).toBe(
      'Invalid timeoutMs',
    );
    expect(sendActionInputError({ ...input, timeoutMs: 5000 })).toBeUndefined();
  });
});
