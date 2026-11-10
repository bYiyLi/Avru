import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallTraces } from '../src/call-traces.js';

const directories: string[] = [];
function paths() {
  const root = mkdtempSync(join(tmpdir(), 'avru-trace-migration-'));
  directories.push(root);
  return {
    previous: join(root, 'browsers.sqlite'),
    separate: join(root, 'browsers-execution-audit.sqlite'),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('M4 request trace migration without data loss', () => {
  it('copies previously sanitized call traces into the separate SQLite audit file', () => {
    const { previous, separate } = paths();
    const secret = 'private-form-input';
    const old = new CallTraces(previous);
    const task = old.begin({
      method: 'tools/call',
      id: secret,
      params: { name: 'browser_run_script', arguments: { script: secret } },
    });
    task.step('authorization', 'succeeded', 'authorized');
    task.finish('succeeded', 'completed');
    old.close();
    const audit = new CallTraces(separate);
    try {
      audit.migrateLegacy(previous);
      audit.migrateLegacy(previous);
      expect(audit.snapshot().calls).toHaveLength(1);
      expect(audit.snapshot().calls[0]).toMatchObject({
        traceId: task.traceId,
        requestId: task.requestId,
        tool: 'browser_run_script',
        status: 'succeeded',
      });
      expect(readFileSync(separate).includes(Buffer.from(secret))).toBe(false);
    } finally {
      audit.close();
    }
    const retained = new CallTraces(previous);
    expect(retained.snapshot().calls).toHaveLength(1);
    retained.close();
  });

  it('does not fabricate history when the old browser database had no call table', () => {
    const { previous, separate } = paths();
    const old = new DatabaseSync(previous);
    old.exec('CREATE TABLE unrelated (value TEXT)');
    old.close();
    const audit = new CallTraces(separate);
    try {
      audit.migrateLegacy(previous);
      expect(audit.snapshot().calls).toEqual([]);
    } finally {
      audit.close();
    }
  });

  it('rolls back a failed migration before an idempotent retry', () => {
    const { previous, separate } = paths();
    const old = new CallTraces(previous);
    old.begin({ method: 'ping' }).finish('succeeded', 'completed');
    old.close();
    const audit = new CallTraces(separate);
    const db = new DatabaseSync(separate);
    try {
      db.exec(`CREATE TRIGGER reject_migration BEFORE INSERT ON call_traces
        BEGIN SELECT RAISE(ABORT,'rejected'); END`);
      expect(() => {
        audit.migrateLegacy(previous);
      }).toThrow();
      expect(audit.snapshot().calls).toEqual([]);
      db.exec('DROP TRIGGER reject_migration');
      audit.migrateLegacy(previous);
      expect(audit.snapshot().calls).toHaveLength(1);
    } finally {
      db.close();
      audit.close();
    }
  });

  it('does not replay legacy history on every restart or displace newer calls', () => {
    const { previous, separate } = paths();
    const clock = vi.spyOn(Date, 'now');
    const base = 1_780_000_000_000;
    clock.mockReturnValue(base);
    const source = new CallTraces(previous);
    const older = source.begin({ method: 'ping' });
    older.finish('succeeded', 'completed');
    source.close();
    clock.mockReturnValue(base + 86_400_000);
    const first = new CallTraces(separate);
    const recent = first.begin({ method: 'ping' });
    recent.finish('succeeded', 'completed');
    first.migrateLegacy(previous);
    expect(first.snapshot().calls.map((call) => call.traceId)).toEqual([
      recent.traceId,
      older.traceId,
    ]);
    first.close();
    const legacy = new CallTraces(previous);
    legacy.begin({ method: 'ping' }).finish('failed', 'internal_error');
    legacy.close();
    const restarted = new CallTraces(separate);
    try {
      restarted.migrateLegacy(previous);
      expect(restarted.snapshot().calls.map((call) => call.traceId)).toEqual([
        recent.traceId,
        older.traceId,
      ]);
    } finally {
      restarted.close();
    }
  });

  it('expires old call traces at seven days, including after migration', () => {
    const { previous, separate } = paths();
    const clock = vi.spyOn(Date, 'now');
    const first = 1_760_000_000_000;
    clock.mockReturnValue(first);
    const old = new CallTraces(previous);
    old.begin({ method: 'ping' }).finish('succeeded', 'completed');
    old.close();
    clock.mockReturnValue(first + 8 * 86_400_000);
    const audit = new CallTraces(separate);
    try {
      audit.migrateLegacy(previous);
      expect(audit.snapshot().calls).toEqual([]);
      audit.begin({ method: 'ping' }).finish('succeeded', 'completed');
      expect(audit.snapshot().calls).toHaveLength(1);
    } finally {
      audit.close();
    }
  });
});
