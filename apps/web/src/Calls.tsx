import type {
  CallHistory,
  CallStatus,
  CallTrace,
  CallSpan,
} from './call-types.js';
import { translate as t, number, timestamp } from './i18n.js';
import type { Language } from './presentation.js';

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
function TraceDetail({ call, locale }: { call: CallTrace; locale: Language }) {
  const names = {
    request: t(locale, 'calls.span.request'),
    authorization: t(locale, 'calls.span.authorization'),
    dispatch: t(locale, 'calls.span.dispatch'),
  };
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
              <strong>{names[span.name]}</strong> ·{' '}
              {statusLabel(span.status, locale, span.events)} ·{' '}
              {number(locale, span.durationMs, 2)} ms
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
                    <li key={`${String(event.at)}-${String(index)}`}>
                      <time dateTime={new Date(event.at).toISOString()}>
                        {timestamp(locale, event.at)}
                      </time>{' '}
                      <code>{event.code}</code>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
      </ol>
      {call.status === 'unknown' && <p>{t(locale, 'calls.unknownWarning')}</p>}
    </details>
  );
}
export function Calls({
  history,
  locale,
}: {
  history?: CallHistory | null;
  locale: Language;
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
        <p className="empty">{t(locale, 'calls.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  t(locale, 'calls.started'),
                  t(locale, 'calls.method'),
                  t(locale, 'calls.outcome'),
                  t(locale, 'calls.duration'),
                  t(locale, 'calls.details'),
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.calls.map((call) => (
                <tr key={call.traceId}>
                  <td>
                    <time dateTime={new Date(call.startedAt).toISOString()}>
                      {timestamp(locale, call.startedAt)}
                    </time>
                  </td>
                  <td>
                    <strong>{call.method}</strong>
                    <small>{call.tool ?? '—'}</small>
                  </td>
                  <td>
                    {statusLabel(
                      call.status,
                      locale,
                      call.spans.flatMap((span) => span.events),
                    )}
                  </td>
                  <td>{number(locale, call.durationMs, 2)} ms</td>
                  <td>
                    <TraceDetail call={call} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{t(locale, 'calls.privacy')}</p>
    </section>
  );
}
