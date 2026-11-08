import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { Calls } from '../src/Calls.js';
import type { CallHistory, CallStatus } from '../src/call-types.js';
import { createController } from '../src/controller.js';
const history: CallHistory = {
  retention: { limit: 200, persistent: false },
  calls: [
    {
      traceId: 'trace-1',
      requestId: 'request-1',
      startedAt: 1000,
      durationMs: 5,
      status: 'succeeded',
      method: 'tools/call',
      tool: 'browsers_list',
      spans: [
        {
          spanId: 'child',
          parentSpanId: 'root',
          name: 'dispatch',
          startedAt: 1002,
          durationMs: 3,
          status: 'succeeded',
          events: [
            { at: 1004, code: 'dispatch.completed' },
            { at: 1003, code: '<script>secret</script>' },
          ],
        },
        {
          spanId: 'root',
          parentSpanId: null,
          name: 'request',
          startedAt: 1000,
          durationMs: 5,
          status: 'succeeded',
          events: [],
        },
        {
          spanId: 'auth',
          parentSpanId: 'root',
          name: 'authorization',
          startedAt: 1001,
          durationMs: 1,
          status: 'succeeded',
          events: [{ at: 1001, code: 'authorization.allowed' }],
        },
      ],
    },
  ],
};
afterEach(() => vi.useRealTimers());
it('renders actual identities and chronological safe events, with accessible disclosure', () => {
  for (const locale of ['zh', 'en'] as const) {
    const html = renderToStaticMarkup(Calls({ history, locale }));
    expect(html).toContain('<details');
    expect(html).toContain('<summary>');
    expect(html).toContain('trace-1');
    expect(html).toContain('request-1');
    expect(html).toContain('browsers_list');
    expect(html.indexOf('Span root')).toBeLessThan(html.indexOf('Span child'));
    expect(html.indexOf('&lt;script&gt;')).toBeLessThan(
      html.indexOf('dispatch.completed'),
    );
    expect(html).not.toContain('<script>');
    expect(history.calls[0]?.spans[0]?.spanId).toBe('child');
  }
});
function requiredCall() {
  const first = history.calls[0];
  if (!first) throw new Error('missing fixture');
  return first;
}
it('separates outcomes, unknown, empty and unavailable history without retry controls', () => {
  for (const locale of ['zh', 'en'] as const) {
    for (const status of [
      'succeeded',
      'rejected',
      'failed',
      'unknown',
    ] as CallStatus[]) {
      const first = requiredCall();
      const html = renderToStaticMarkup(
        Calls({
          history: { ...history, calls: [{ ...first, status, tool: null }] },
          locale,
        }),
      );
      expect(html).not.toContain('<button');
      if (status === 'unknown')
        expect(html).toContain(
          locale === 'zh' ? '结果未知' : 'Outcome unknown',
        );
    }
    expect(renderToStaticMarkup(Calls({ history: null, locale }))).toContain(
      locale === 'zh' ? '暂不可用' : 'unavailable',
    );
    expect(
      renderToStaticMarkup(
        Calls({
          history: { calls: [], retention: { limit: 200, persistent: true } },
          locale,
        }),
      ),
    ).toContain(locale === 'zh' ? '暂无真实调用记录' : 'No real call records');
  }
});
it('loads real trace history and clears it after a connection or authorization failure', async () => {
  vi.useFakeTimers();
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation((path) =>
      Promise.resolve(
        Response.json(
          path === '/api/calls'
            ? history
            : path === '/api/browsers'
              ? { browsers: [] }
              : path === '/api/pairings'
                ? { pairings: [] }
                : { mcp: 'oauthReadOnly' },
        ),
      ),
    );
  const controller = createController({ key: 'key', clear: vi.fn() }, request);
  controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.snapshot().history).toEqual(history);
  expect(controller.snapshot().system?.mcp).toBe('oauthReadOnly');
  request.mockResolvedValue(new Response(null, { status: 503 }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(controller.snapshot().history).toBeNull();
  request.mockResolvedValue(new Response(null, { status: 401 }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(controller.snapshot().history).toBeNull();
  expect(controller.snapshot().authorized).toBe(false);
  controller.stop();
});

it('labels accepted notifications without claiming tool completion in list and spans', () => {
  const base = requiredCall();
  const notification = {
    ...base,
    tool: null,
    spans: base.spans.slice(0, 2).map((span) => ({
      ...span,
      events: [{ at: 1004, code: 'notification_accepted' }],
    })),
  };
  for (const locale of ['zh', 'en'] as const) {
    const label = locale === 'zh' ? '通知已接收' : 'Notification accepted';
    const html = renderToStaticMarkup(
      Calls({ history: { ...history, calls: [notification] }, locale }),
    );
    expect(html.split(label)).toHaveLength(4);
    expect(html).not.toContain(locale === 'zh' ? '已完成' : 'Completed');
    expect(html).not.toContain('browsers_list');
    const rejected = renderToStaticMarkup(
      Calls({
        history: {
          ...history,
          calls: [{ ...notification, status: 'rejected' }],
        },
        locale,
      }),
    );
    expect(rejected).toContain(locale === 'zh' ? '已拒绝' : 'Rejected');
  }
});

it('does not present an unknown outcome as a completed duration', () => {
  const first = requiredCall();
  const root = first.spans[1];
  if (!root) throw new Error('missing root span');
  const unknown = {
    ...first,
    status: 'unknown' as const,
    durationMs: 0,
    spans: [{ ...root, status: 'unknown' as const, durationMs: 0 }],
  };
  const html = renderToStaticMarkup(
    Calls({ history: { ...history, calls: [unknown] }, locale: 'en' }),
  );
  expect(html).toContain('Outcome unknown');
  expect(html).toContain('Do not retry blindly');
  expect(html).not.toContain('0 ms');
});
