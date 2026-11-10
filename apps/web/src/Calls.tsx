import type {
  CallHistory,
  CallStatus,
  CallTrace,
  CallSpan,
} from './call-types.js';
import type { MessageKey } from './i18n-types.js';
import { translate as t, number, timestamp } from './i18n.js';
import type { Language } from './presentation.js';
export type LogNotice =
  '' | 'logs.exported' | 'logs.summaryCopied' | 'logs.copyFailed';
export interface LogFilters {
  outcome: 'all' | CallStatus;
  tool: string;
  event: string;
  query: string;
  period?: 'all' | 'hour' | 'day' | 'week';
  sort?: 'newest' | 'oldest' | 'slowest';
}
function hasEvent(call: CallTrace, code: string): boolean {
  return call.spans.some((span) =>
    span.events.some((event) => event.code === code),
  );
}
export function filterCalls(
  calls: CallTrace[],
  filters: LogFilters,
): CallTrace[] {
  const query = filters.query.trim().toLowerCase();
  const windowMs = {
    all: 0,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  }[filters.period ?? 'all'];
  const cutoff = windowMs ? Date.now() - windowMs : -Infinity;
  const filtered = calls.filter((call) => {
    if (call.startedAt < cutoff) return false;
    if (filters.outcome !== 'all' && call.status !== filters.outcome)
      return false;
    if (filters.tool !== 'all' && (call.tool ?? '') !== filters.tool)
      return false;
    if (filters.event !== 'all' && !hasEvent(call, filters.event)) return false;
    if (
      query &&
      ![
        call.traceId,
        call.requestId,
        call.method,
        call.tool ?? '',
        ...call.spans.flatMap((span) => span.events.map((item) => item.code)),
      ].some((value) => value.toLowerCase().includes(query))
    )
      return false;
    return true;
  });
  switch (filters.sort) {
    case 'newest':
      return filtered.sort((a, b) => b.startedAt - a.startedAt);
    case 'oldest':
      return filtered.sort((a, b) => a.startedAt - b.startedAt);
    case 'slowest':
      return filtered.sort((a, b) => {
        if (a.status === 'unknown') return b.status === 'unknown' ? 0 : 1;
        if (b.status === 'unknown') return -1;
        return b.durationMs - a.durationMs;
      });
    case undefined:
      return filtered;
  }
  return filtered;
}
export function lastTraceEvent(call: CallTrace): string | null {
  const events = call.spans.flatMap((span) => span.events);
  const last = events.sort((a, b) => b.at - a.at)[0];
  return last?.code ?? null;
}
export function buildLogsJson(calls: CallTrace[]): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), count: calls.length, calls },
    null,
    2,
  );
}
export function buildDiagnosticsSummary(
  calls: CallTrace[],
  locale: Language,
): string {
  const counts = { succeeded: 0, rejected: 0, failed: 0, unknown: 0 };
  for (const call of calls) counts[call.status] += 1;
  return t(locale, 'logs.summaryText', {
    total: calls.length,
    ...counts,
  });
}
export function downloadTextFile(
  filename: string,
  text: string,
  type: string,
): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
export async function copyText(value: string): Promise<boolean> {
  try {
    const navigatorValue = (globalThis as { navigator?: Navigator }).navigator;
    const clipboard = navigatorValue?.clipboard;
    if (clipboard) {
      await clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy copy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Legacy clipboard fallback for contexts without async clipboard access.
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
export function spanLabel(name: CallSpan['name'], locale: Language): string {
  return t(locale, `calls.span.${name}`);
}
export function failurePoint(
  call: CallTrace,
): { step: CallSpan['name']; code: string } | null {
  const failed = [...call.spans]
    .sort((a, b) => a.startedAt - b.startedAt)
    .find((span) => span.status === 'failed' || span.status === 'rejected');
  if (!failed) return null;
  const events = [...failed.events].sort((a, b) => a.at - b.at);
  const last = events[events.length - 1];
  return { step: failed.name, code: last?.code ?? '—' };
}
function statusLabel(
  status: CallStatus,
  locale: Language,
  events: CallSpan['events'],
) {
  if (
    status === 'succeeded' &&
    events.some((event) => event.code === 'notification_accepted')
  )
    return t(locale, 'calls.notificationAccepted');
  const labels = {
    succeeded: t(locale, 'calls.succeeded'),
    rejected: t(locale, 'calls.rejected'),
    failed: t(locale, 'calls.failed'),
    unknown: t(locale, 'calls.unknown'),
  };
  return labels[status];
}
const EVENT_ADVICE = {
  notification_accepted: 'calls.eventAdvice.notification_accepted',
  authorized: 'calls.eventAdvice.authorized',
  invalid_token: 'calls.eventAdvice.invalid_token',
  unsupported_protocol_version:
    'calls.eventAdvice.unsupported_protocol_version',
  not_acceptable: 'calls.eventAdvice.not_acceptable',
  completed: 'calls.eventAdvice.completed',
  protocol_error: 'calls.eventAdvice.protocol_error',
  internal_error: 'calls.eventAdvice.internal_error',
} as const satisfies Record<string, MessageKey>;
type EventAdviceKey = (typeof EVENT_ADVICE)[keyof typeof EVENT_ADVICE];
export function eventAdvice(code: string, locale: Language): string | null {
  const key = (EVENT_ADVICE as Record<string, EventAdviceKey | undefined>)[
    code
  ];
  return key ? t(locale, key) : null;
}
function TraceEvent({
  event,
  locale,
}: {
  event: { at: number; code: string };
  locale: Language;
}) {
  const advice = eventAdvice(event.code, locale);
  return (
    <li>
      <time dateTime={new Date(event.at).toISOString()}>
        {timestamp(locale, event.at)}
      </time>{' '}
      <code>{event.code}</code>
      {advice && <small>{advice}</small>}
    </li>
  );
}
function TraceDetail({ call, locale }: { call: CallTrace; locale: Language }) {
  return (
    <details className="call-detail">
      <summary>{t(locale, 'calls.viewTrace')}</summary>
      <dl className="trace-identifiers">
        <dt>{t(locale, 'calls.traceId')}</dt>
        <dd>{call.traceId}</dd>
        <dt>{t(locale, 'calls.requestId')}</dt>
        <dd>{call.requestId}</dd>
      </dl>
      <ol className="trace-spans">
        {[...call.spans]
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((span) => (
            <li key={span.spanId}>
              <strong>{spanLabel(span.name, locale)}</strong> ·{' '}
              {statusLabel(span.status, locale, span.events)} ·{' '}
              {span.status === 'unknown'
                ? '—'
                : `${number(locale, span.durationMs, 2)} ms`}
              <small>
                {t(locale, 'calls.spanIdentity', {
                  span: span.spanId,
                  parent: span.parentSpanId ?? '—',
                })}
              </small>
              <small>{timestamp(locale, span.startedAt)}</small>
              <ul>
                {[...span.events]
                  .sort((a, b) => a.at - b.at)
                  .map((event, index) => (
                    <TraceEvent
                      key={`${String(event.at)}-${String(index)}`}
                      event={event}
                      locale={locale}
                    />
                  ))}
              </ul>
            </li>
          ))}
      </ol>
      {call.status === 'unknown' && <p>{t(locale, 'calls.unknownWarning')}</p>}
    </details>
  );
}
function CallRow({ call, locale }: { call: CallTrace; locale: Language }) {
  return (
    <tr>
      <td className="logs-event-time">
        <time dateTime={new Date(call.startedAt).toISOString()}>
          {timestamp(locale, call.startedAt)}
        </time>
      </td>
      <td>
        <strong className="call-tool-name">{call.tool ?? call.method}</strong>
        <small>{call.tool ? call.method : t(locale, 'logs.noTool')}</small>
        <small className="call-trace-short" title={call.traceId}>
          Trace · {call.traceId.slice(0, 8)}
        </small>
      </td>
      <td>
        <span className={`logs-event-status logs-event-status--${call.status}`}>
          {statusLabel(
            call.status,
            locale,
            call.spans.flatMap((span) => span.events),
          )}
        </span>
      </td>
      <td>
        {call.status === 'unknown'
          ? '—'
          : `${number(locale, call.durationMs, 2)} ms`}
      </td>
      <td className="logs-event-message">
        <code className="call-event-code">{lastTraceEvent(call) ?? '—'}</code>
        <small>
          {t(locale, 'calls.spanCount', { count: call.spans.length })}
        </small>
      </td>
      <td className="logs-event-trace">
        <TraceDetail call={call} locale={locale} />
      </td>
    </tr>
  );
}
export function Calls({
  history,
  locale,
  emptyMessage = 'calls.empty',
}: {
  history?: CallHistory | null;
  locale: Language;
  emptyMessage?: 'calls.empty' | 'logs.noResults';
}) {
  return (
    <section className="calls">
      <div className="section-heading">
        <h2>{t(locale, 'calls.title')}</h2>
        {history && (
          <span>
            {t(locale, 'calls.retention', { count: history.retention.limit })} ·{' '}
            {history.retention.persistent
              ? t(locale, 'calls.persistent')
              : t(locale, 'calls.ephemeral')}
          </span>
        )}
      </div>
      {!history ? (
        <p className="empty">{t(locale, 'calls.unavailable')}</p>
      ) : history.calls.length === 0 ? (
        <p className="empty">{t(locale, emptyMessage)}</p>
      ) : (
        <div className="table-scroll logs-table-scroll">
          <table className="call-table logs-event-table">
            <thead>
              <tr>
                {[
                  t(locale, 'calls.started'),
                  t(locale, 'calls.method'),
                  t(locale, 'calls.outcome'),
                  t(locale, 'calls.duration'),
                  t(locale, 'calls.lastEvent'),
                  t(locale, 'calls.details'),
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.calls.map((call) => (
                <CallRow key={call.traceId} call={call} locale={locale} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{t(locale, 'calls.privacy')}</p>
    </section>
  );
}
export function RecentCalls({
  history,
  locale,
  onOpenLogs,
}: {
  history?: CallHistory | null;
  locale: Language;
  onOpenLogs: () => void;
}) {
  const recent = history
    ? [...history.calls].sort((a, b) => b.startedAt - a.startedAt).slice(0, 3)
    : null;
  return (
    <section className="recent-calls">
      <div className="section-heading">
        <h2>{t(locale, 'logs.recentTitle')}</h2>
        <button type="button" onClick={onOpenLogs}>
          {t(locale, 'logs.viewAll')}
        </button>
      </div>
      {!history ? (
        <p className="empty">{t(locale, 'calls.unavailable')}</p>
      ) : history.calls.length === 0 ? (
        <p className="empty">{t(locale, 'calls.empty')}</p>
      ) : (
        <ul className="recent-list">
          {(recent ?? []).map((call) => (
            <li key={call.traceId}>
              <button type="button" onClick={onOpenLogs}>
                <RecentCallBody call={call} locale={locale} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
function RecentCallBody({
  call,
  locale,
}: {
  call: CallTrace;
  locale: Language;
}) {
  const point = failurePoint(call);
  return (
    <>
      <time dateTime={new Date(call.startedAt).toISOString()}>
        {timestamp(locale, call.startedAt)}
      </time>{' '}
      <strong>{call.method}</strong> {call.tool && <small>{call.tool}</small>}{' '}
      <span>
        {statusLabel(
          call.status,
          locale,
          call.spans.flatMap((span) => span.events),
        )}
      </span>
      {point && (
        <small>
          {t(locale, 'logs.failedAt', {
            step: spanLabel(point.step, locale),
            code: point.code,
          })}
        </small>
      )}
    </>
  );
}
