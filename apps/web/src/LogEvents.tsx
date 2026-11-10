import type { CallSpan, CallTrace } from './call-types.js';
import { eventAdvice, spanLabel } from './Calls.js';
import { number, timestamp, translate as t } from './i18n.js';
import type { MessageKey } from './i18n-types.js';
import type { Language } from './presentation.js';

export interface LogRow {
  key: string;
  call: CallTrace;
  span: CallSpan;
  event: CallSpan['events'][number] | null;
  at: number;
  order: number;
}

export type LogTimeRange = 'all' | '15m' | '1h' | '24h';

export interface EventFilters {
  event: string;
  stage: 'all' | CallSpan['name'];
  query: string;
  timeRange: LogTimeRange;
}

/** Export exactly the visible matching events, without raw arguments, page
 * content, credentials, or unrelated events from the same trace.
 */
export function buildEventLogsJson(rows: LogRow[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: rows.length,
      events: rows.map(({ call, span, event, at }) => ({
        at,
        code: event?.code ?? null,
        status: span.status,
        stage: span.name,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        traceId: call.traceId,
        requestId: call.requestId,
        method: call.method,
        tool: call.tool,
      })),
    },
    null,
    2,
  );
}

const EVENT_MESSAGES = {
  notification_accepted: 'events.message.notification_accepted',
  authorized: 'events.message.authorized',
  invalid_token: 'events.message.invalid_token',
  unsupported_protocol_version: 'events.message.unsupported_protocol_version',
  not_acceptable: 'events.message.not_acceptable',
  completed: 'events.message.completed',
  protocol_error: 'events.message.protocol_error',
  internal_error: 'events.message.internal_error',
} as const satisfies Record<string, MessageKey>;

/** Each row represents an actual recorded event, or an actual span without an
 * event (for example an interrupted request). Never generate synthetic steps.
 */
export function buildLogRows(calls: CallTrace[]): LogRow[] {
  const rows: LogRow[] = [];
  let order = 0;
  for (const call of calls) {
    for (const span of call.spans) {
      if (span.events.length === 0) {
        rows.push({
          key: `${call.traceId}:${span.spanId}:span`,
          call,
          span,
          event: null,
          at: span.startedAt,
          order: order++,
        });
      } else {
        for (const [index, event] of span.events.entries()) {
          rows.push({
            key: `${call.traceId}:${span.spanId}:${String(index)}`,
            call,
            span,
            event,
            at: event.at,
            order: order++,
          });
        }
      }
    }
  }
  return rows.sort((a, b) => b.at - a.at || a.order - b.order);
}

export function logMessage(row: LogRow, locale: Language): string {
  if (!row.event)
    return `${spanLabel(row.span.name, locale)} · ${t(locale, `calls.${row.span.status}`)}`;
  const key = (
    EVENT_MESSAGES as Record<
      string,
      (typeof EVENT_MESSAGES)[keyof typeof EVENT_MESSAGES] | undefined
    >
  )[row.event.code];
  return key ? t(locale, key) : row.event.code;
}

/** Search is restricted to sanitized identifiers, event codes, and localized
 * fixed text. Never search or surface request arguments or page contents.
 */
export function filterLogRows(
  rows: LogRow[],
  filters: EventFilters,
  locale: Language,
  now = Date.now(),
): LogRow[] {
  const since =
    filters.timeRange === 'all'
      ? null
      : now -
        {
          '15m': 15 * 60_000,
          '1h': 60 * 60_000,
          '24h': 24 * 60 * 60_000,
        }[filters.timeRange];
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.event !== 'all' && row.event?.code !== filters.event)
      return false;
    if (filters.stage !== 'all' && row.span.name !== filters.stage)
      return false;
    if (since !== null && row.at < since) return false;
    if (!query) return true;
    return [
      row.call.traceId,
      row.call.requestId,
      row.call.method,
      row.call.tool ?? '',
      row.span.spanId,
      row.span.parentSpanId ?? '',
      row.span.name,
      row.event?.code ?? '',
      logMessage(row, locale),
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

function eventClock(locale: Language, at: number): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(at);
}

function SpanTrace({ call, locale }: { call: CallTrace; locale: Language }) {
  return (
    <div className="logs-trace-body">
      <dl>
        <dt>{t(locale, 'calls.traceId')}</dt>
        <dd>
          <code>{call.traceId}</code>
        </dd>
        <dt>{t(locale, 'calls.requestId')}</dt>
        <dd>
          <code>{call.requestId}</code>
        </dd>
      </dl>
      <ol>
        {[...call.spans]
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((span) => (
            <li key={span.spanId}>
              <strong>{spanLabel(span.name, locale)}</strong>
              <span> · {t(locale, `calls.${span.status}`)}</span>
              <span>
                {' '}
                ·{' '}
                {span.status === 'unknown'
                  ? '—'
                  : `${number(locale, span.durationMs, 2)} ms`}
              </span>
              <small>{timestamp(locale, span.startedAt)}</small>
              <small>
                {t(locale, 'calls.spanIdentity', {
                  span: span.spanId,
                  parent: span.parentSpanId ?? '—',
                })}
              </small>
              {span.events.map((event, index) => (
                <div key={`${String(event.at)}:${String(index)}`}>
                  <code>{event.code}</code>
                  <small>{timestamp(locale, event.at)}</small>
                  {eventAdvice(event.code, locale) && (
                    <small>{eventAdvice(event.code, locale)}</small>
                  )}
                </div>
              ))}
            </li>
          ))}
      </ol>
      {call.status === 'unknown' && (
        <p className="logs-trace-warning">
          {t(locale, 'calls.unknownWarning')}
        </p>
      )}
    </div>
  );
}

export function LogEvents({
  rows,
  locale,
  available,
  emptyMessage,
}: {
  rows: LogRow[];
  locale: Language;
  available: boolean;
  emptyMessage: 'calls.empty' | 'logs.noResults';
}) {
  if (!available)
    return (
      <p className="logs-empty" role="status">
        {t(locale, 'calls.unavailable')}
      </p>
    );
  if (rows.length === 0)
    return (
      <p className="logs-empty" role="status">
        {t(locale, emptyMessage)}
      </p>
    );
  return (
    <div className="logs-table-scroll">
      <table className="logs-event-table">
        <thead>
          <tr>
            <th scope="col">{t(locale, 'events.eventTime')}</th>
            <th scope="col">{t(locale, 'logs.filterOutcome')}</th>
            <th scope="col">{t(locale, 'events.stage')}</th>
            <th scope="col">{t(locale, 'events.messageEvent')}</th>
            <th scope="col">{t(locale, 'calls.traceId')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="logs-event-time">
                <time
                  dateTime={new Date(row.at).toISOString()}
                  title={timestamp(locale, row.at)}
                >
                  {eventClock(locale, row.at)}
                </time>
              </td>
              <td>
                <span
                  className={`logs-event-status logs-event-status--${row.span.status}`}
                >
                  {t(locale, `calls.${row.span.status}`)}
                </span>
              </td>
              <td className="logs-event-stage">
                {spanLabel(row.span.name, locale)}
              </td>
              <td className="logs-event-message">
                <strong>{logMessage(row, locale)}</strong>
                <small>
                  {row.event ? (
                    <code>{row.event.code}</code>
                  ) : (
                    t(locale, 'events.noEvent')
                  )}
                  {row.call.tool && (
                    <span className="logs-event-tool"> · {row.call.tool}</span>
                  )}
                </small>
              </td>
              <td className="logs-event-trace">
                <details>
                  <summary title={row.call.traceId}>
                    <code>…{row.call.traceId.slice(-8)}</code>
                    <span aria-hidden="true"> ↗</span>
                  </summary>
                  <SpanTrace call={row.call} locale={locale} />
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
