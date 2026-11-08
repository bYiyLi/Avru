import { expect, it } from 'vitest';
import { CallTraces } from '../src/call-traces.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
it('records bounded server-owned IDs and fixed events without arbitrary request data', () => {
  const traces = new CallTraces();
  const secret = 'private page content and authorization';
  const active = traces.begin({
    method: 'tools/call',
    id: secret,
    params: { name: 'browsers_list', arguments: { secret } },
  });
  active.step('authorization', 'succeeded', 'authorized');
  active.step('dispatch', 'succeeded', 'completed');
  active.finish('succeeded', 'completed');
  active.finish('failed', 'internal_error');
  active.step('dispatch', 'failed', 'internal_error');
  const snapshot = traces.snapshot();
  expect(snapshot.calls).toHaveLength(1);
  const call = snapshot.calls[0];
  expect(call?.requestId).not.toBe(secret);
  expect(call?.traceId).toBe(active.traceId);
  expect(call?.tool).toBe('browsers_list');
  expect(call?.status).toBe('succeeded');
  expect(call?.spans).toHaveLength(3);
  expect(call?.spans[1]?.parentSpanId).toBe(call?.spans[0]?.spanId);
  expect(call?.durationMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(snapshot)).not.toContain(secret);
  snapshot.calls.length = 0;
  expect(traces.snapshot().calls).toHaveLength(1);
  for (let i = 0; i < 201; i++)
    traces
      .begin({ method: secret, params: { name: secret } })
      .finish('rejected', 'protocol_error');
  expect(traces.snapshot().calls).toHaveLength(200);
  expect(
    traces
      .snapshot()
      .calls.every((value) => value.method === 'other' && value.tool === null),
  ).toBe(true);
  expect(traces.snapshot().retention).toEqual({
    limit: 200,
    persistent: false,
  });
});
it('handles malformed input without storing it', () => {
  const traces = new CallTraces();
  for (const raw of [
    null,
    {},
    { method: 1 },
    { method: 'tools/call' },
    { method: 'tools/call', params: { name: 'other' } },
    { method: 'ping' },
  ])
    traces.begin(raw).finish('rejected', 'protocol_error');
  expect(traces.snapshot().calls).toHaveLength(6);
});

it('persists sanitized calls and leaves interrupted requests unknown across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'avru-traces-'));
  const path = join(dir, 'history.sqlite');
  const secret = 'private-content-token-example';
  try {
    const first = new CallTraces(path);
    const completed = first.begin({
      method: 'tools/call',
      id: secret,
      params: { name: 'browsers_list', arguments: { secret } },
    });
    completed.step('authorization', 'succeeded', 'authorized');
    completed.finish('succeeded', 'completed');
    const interrupted = first.begin({ method: secret });
    interrupted.step('authorization', 'succeeded', 'authorized');
    first.close();
    const restored = new CallTraces(path);
    const history = restored.snapshot();
    expect(history.retention).toEqual({ limit: 200, persistent: true });
    expect(history.calls).toHaveLength(2);
    expect(history.calls[0]?.traceId).toBe(interrupted.traceId);
    expect(history.calls[0]?.status).toBe('unknown');
    expect(history.calls[0]?.spans[0]?.status).toBe('unknown');
    expect(history.calls[1]?.status).toBe('succeeded');
    expect(JSON.stringify(history)).not.toContain(secret);
    restored.close();
    expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Every begin/finish is durably written; Windows hosted disks may exceed the default five seconds.
it('bounds persistent history even across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'avru-traces-limit-'));
  const path = join(dir, 'history.sqlite');
  try {
    const traces = new CallTraces(path);
    for (let i = 0; i < 205; i++)
      traces.begin({ method: 'ping' }).finish('succeeded', 'completed');
    expect(traces.snapshot().calls).toHaveLength(200);
    traces.close();
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT count(*) AS n FROM call_traces').get()?.n).toBe(
      200,
    );
    db.close();
    const restored = new CallTraces(path);
    expect(restored.snapshot().calls).toHaveLength(200);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

it('keeps an unfinished request unknown after an abrupt process exit', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'avru-traces-crash-'));
  const path = join(dir, 'history.sqlite');
  try {
    const script = `import { CallTraces } from './apps/daemon/src/call-traces.ts';
      const traces = new CallTraces(process.argv[1]);
      const call = traces.begin({ method: 'ping' });
      call.step('authorization', 'succeeded', 'authorized');
      process.exit(0);`;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script, path],
      { cwd: process.cwd() },
    );
    expect(child.status, child.stderr.toString()).toBe(0);
    const restored = new CallTraces(path);
    const call = restored.snapshot().calls[0];
    expect(call?.status).toBe('unknown');
    expect(call?.spans.map((span) => [span.name, span.status])).toEqual([
      ['request', 'unknown'],
      ['authorization', 'succeeded'],
    ]);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rolls back a failed insert and can record a later request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'avru-traces-rollback-'));
  const path = join(dir, 'history.sqlite');
  const traces = new CallTraces(path);
  const db = new DatabaseSync(path);
  try {
    db.exec(
      "CREATE TRIGGER reject_trace BEFORE INSERT ON call_traces BEGIN SELECT RAISE(ABORT, 'failure'); END",
    );
    expect(() => traces.begin({ method: 'ping' })).toThrow();
    expect(traces.snapshot().calls).toHaveLength(0);
    db.exec('DROP TRIGGER reject_trace');
    traces.begin({ method: 'ping' }).finish('succeeded', 'completed');
    expect(traces.snapshot().calls).toHaveLength(1);
  } finally {
    db.close();
    traces.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
