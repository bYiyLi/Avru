import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_BRIDGE_CALLS,
  MAX_OUTPUT_BYTES,
  MAX_TIMEOUT_MS,
  codedError,
  errorCode,
  normalizeSnapshotUrl,
  normalizeTabId,
  sleep,
  submitErrorCode,
  submitErrorMessage,
  uncertainActionOutcome,
  unknownAfterDispatch,
  validateRunOptions,
} from '../src/execution-types';
import type { RunOptions } from '../src/execution-types';

describe('execution error classifications', () => {
  it('preserves structured error codes and safe error-message fallbacks', () => {
    const typed = codedError('INVALID_TARGET', 'target unavailable');
    expect(errorCode(typed)).toBe('INVALID_TARGET');
    expect(errorCode(new Error('QUEUE_FULL'))).toBe('QUEUE_FULL');
    expect(errorCode(new Error('a readable error message'))).toBe(
      'UNKNOWN_RESULT',
    );
    expect(errorCode({ code: 123 })).toBe('UNKNOWN_RESULT');
    expect(errorCode({ code: 'EXTENSION_OFFLINE' })).toBe('EXTENSION_OFFLINE');
    expect(errorCode(null)).toBe('UNKNOWN_RESULT');
  });

  it('does not report a lost browser action result as a safe failure', () => {
    expect(unknownAfterDispatch('TIMEOUT')).toBe(true);
    expect(unknownAfterDispatch('EXTENSION_OFFLINE')).toBe(true);
    expect(unknownAfterDispatch('INVALID_ARGUMENT')).toBe(false);
    expect(uncertainActionOutcome('step-9')).toEqual({
      state: 'unknown',
      error: {
        code: 'UNKNOWN_RESULT',
        message: expect.stringContaining('may have completed') as string,
        step: 'step-9',
      },
    });
    const withoutStep = uncertainActionOutcome();
    expect(withoutStep.error.code).toBe('UNKNOWN_RESULT');
    expect(withoutStep.error).not.toHaveProperty('step');
  });

  it('maps runner submit errors without inventing results for unknown failures', () => {
    const table = [
      ['source limit', 'SCRIPT_TOO_LARGE', 'script exceeds the 64 KiB limit'],
      ['queue full', 'QUEUE_FULL', 'execution queue is full'],
      ['invalid target', 'INVALID_TARGET', 'target tab is not available'],
      [
        'runner closed',
        'DAEMON_UNAVAILABLE',
        'execution runner is unavailable',
      ],
    ] as const;
    for (const [message, code, explanation] of table) {
      expect(submitErrorCode(new Error(message))).toBe(code);
      expect(submitErrorMessage(code)).toBe(explanation);
    }
    expect(submitErrorCode(new Error('other'))).toBeUndefined();
    expect(submitErrorCode('source limit')).toBeUndefined();
    expect(submitErrorMessage('OTHER_CODE')).toBe(
      'runner failed to start the task',
    );
  });
});

describe('tab target input normalization', () => {
  it('accepts safe nonnegative integer tab IDs and numeric strings', () => {
    expect(normalizeTabId(0)).toBe(0);
    expect(normalizeTabId(12)).toBe(12);
    expect(normalizeTabId('12')).toBe(12);
    expect(normalizeTabId('00012')).toBe(12);
  });

  it('rejects non-integer IDs and unsafe numeric values', () => {
    for (const value of [
      -1,
      1.2,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      String(Number.MAX_SAFE_INTEGER + 1),
      '12.2',
      '1e3',
      '',
      'not-an-id',
      null,
      undefined,
    ]) {
      expect(normalizeTabId(value)).toBeUndefined();
    }
  });

  it('drops URL credentials and tracking parameters without changing the origin', () => {
    expect(
      normalizeSnapshotUrl(
        'https://user:password@example.test/a?token=secret#x',
      ),
    ).toBe('https://example.test/a');
    expect(() => normalizeSnapshotUrl('not an URL')).toThrow(
      'INVALID_ARGUMENT',
    );
  });
});

describe('validated execution resource limits', () => {
  it('uses the documented defaults for each new task', () => {
    expect(validateRunOptions({})).toEqual({
      timeoutMs: DEFAULT_TIMEOUT_MS,
      limits: {
        maxOutputBytes: MAX_OUTPUT_BYTES,
        maxBridgeCalls: MAX_BRIDGE_CALLS,
      },
    });
  });

  it('allows smaller settings and clamps resource caps', () => {
    expect(
      validateRunOptions({
        timeoutMs: MAX_TIMEOUT_MS,
        taskName: 'search',
        limits: { maxOutputBytes: 100, maxSteps: 2 },
      }),
    ).toEqual({
      timeoutMs: MAX_TIMEOUT_MS,
      limits: { maxOutputBytes: 100, maxBridgeCalls: 2 },
    });
    expect(
      validateRunOptions({
        limits: { maxOutputBytes: 1_000_000, maxSteps: 999 },
      }).limits,
    ).toEqual({
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxBridgeCalls: MAX_BRIDGE_CALLS,
    });
  });

  it('rejects invalid timeout and task names before starting a process', () => {
    const invalid: unknown[] = [
      { timeoutMs: 0 },
      { timeoutMs: -1 },
      { timeoutMs: MAX_TIMEOUT_MS + 1 },
      { timeoutMs: 2.5 },
      { timeoutMs: '500' },
      { taskName: '' },
      { taskName: 5 },
      { taskName: 'x'.repeat(129) },
    ];
    for (const input of invalid)
      expect(() => validateRunOptions(input as RunOptions)).toThrow(
        'INVALID_ARGUMENT',
      );
  });

  it('rejects invalid output and bridge-call limits', () => {
    const invalid: unknown[] = [
      { limits: { maxOutputBytes: 0 } },
      { limits: { maxOutputBytes: 1.5 } },
      { limits: { maxOutputBytes: '100' } },
      { limits: { maxSteps: 0 } },
      { limits: { maxSteps: -5 } },
      { limits: { maxSteps: Infinity } },
    ];
    for (const input of invalid)
      expect(() => validateRunOptions(input as RunOptions)).toThrow(
        'INVALID_ARGUMENT',
      );
  });

  it('provides a bounded promise-based sleep for shutdown/retry coordination', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
