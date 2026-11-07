import { expect, it } from 'vitest';
import { CallTraces } from '../src/call-traces.js';
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
