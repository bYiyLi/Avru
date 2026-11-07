import type {
  CallHistory,
  CallStatus,
  CallTrace,
  CallSpan,
} from './call-types.js';
import { translate as t } from './presentation.js';
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
    return t(locale, '通知已接收', 'Notification accepted');
  const labels = {
    succeeded: t(locale, '已完成', 'Completed'),
    rejected: t(locale, '已拒绝', 'Rejected'),
    failed: t(locale, '失败', 'Failed'),
    unknown: t(locale, '结果未知', 'Outcome unknown'),
  };
  return labels[status];
}
function TraceDetail({ call, locale }: { call: CallTrace; locale: Language }) {
  const names = {
    request: t(locale, '请求', 'Request'),
    authorization: t(locale, '授权检查', 'Authorization'),
    dispatch: t(locale, '分派', 'Dispatch'),
  };
  return (
    <details className="call-detail">
      <summary>{t(locale, '查看链路与日志', 'View trace and logs')}</summary>
      <dl className="trace-identifiers">
        <dt>Trace ID</dt>
        <dd>{call.traceId}</dd>
        <dt>Request ID</dt>
        <dd>{call.requestId}</dd>
      </dl>
      <ol className="trace-spans">
        {[...call.spans]
          .sort((a, b) => a.startedAt - b.startedAt)
          .map((span) => (
            <li key={span.spanId}>
              <strong>{names[span.name]}</strong> ·{' '}
              {statusLabel(span.status, locale, span.events)} ·{' '}
              {span.durationMs} ms
              <small>
                Span {span.spanId} · Parent {span.parentSpanId ?? '—'}
              </small>
              <small>{new Date(span.startedAt).toISOString()}</small>
              <ul>
                {[...span.events]
                  .sort((a, b) => a.at - b.at)
                  .map((event, index) => (
                    <li key={`${String(event.at)}-${String(index)}`}>
                      <time dateTime={new Date(event.at).toISOString()}>
                        {new Date(event.at).toISOString()}
                      </time>{' '}
                      <code>{event.code}</code>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
      </ol>
      {call.status === 'unknown' && (
        <p>
          {t(
            locale,
            '结果未确认，不要盲目重试。',
            'The outcome is unconfirmed. Do not retry blindly.',
          )}
        </p>
      )}
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
        <h2>{t(locale, 'MCP 调用与链路日志', 'MCP calls & trace logs')}</h2>
        {history && (
          <span>
            {t(locale, '最多保留', 'Retains up to')} {history.retention.limit}{' '}
            {t(locale, '条', 'records')} ·{' '}
            {history.retention.persistent
              ? t(locale, '本机保存', 'Saved locally')
              : t(
                  locale,
                  '仅本次运行，重启清空',
                  'This run only; cleared on restart',
                )}
          </span>
        )}
      </div>
      {!history ? (
        <p className="empty">
          {t(locale, '调用记录暂不可用', 'Call history unavailable')}
        </p>
      ) : history.calls.length === 0 ? (
        <p className="empty">
          {t(locale, '暂无真实调用记录', 'No real call records')}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {[
                  t(locale, '开始时间（UTC）', 'Started (UTC)'),
                  t(locale, '方法 / 工具', 'Method / tool'),
                  t(locale, '结果', 'Outcome'),
                  t(locale, '耗时', 'Duration'),
                  t(locale, '详情', 'Details'),
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
                      {new Date(call.startedAt).toISOString()}
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
                  <td>{call.durationMs} ms</td>
                  <td>
                    <TraceDetail call={call} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">
        {t(
          locale,
          '仅展示服务实际记录的步骤与脱敏事件，不记录凭据、完整参数或页面内容。',
          'Only recorded server steps and redacted events are shown. Credentials, full arguments and page contents are not logged.',
        )}
      </p>
    </section>
  );
}
