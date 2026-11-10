import type { CallStatus } from './call-types.js';
import './overview.css';
import type { BrowserProfile, ViewState } from './controller.js';
import { translate as t, number } from './i18n.js';
import type { Language } from './presentation.js';
import { versionStatus } from './presentation.js';

const OUTCOMES = ['succeeded', 'failed', 'rejected', 'unknown'] as const;
const OUTCOME_LABELS = {
  succeeded: 'overview.callSucceeded',
  failed: 'overview.callFailed',
  rejected: 'overview.callRejected',
  unknown: 'overview.callUnknown',
} as const;
const OUTCOME_COLORS = {
  succeeded: 'var(--console-success)',
  failed: 'var(--console-failure)',
  rejected: 'var(--console-rejected)',
  unknown: 'var(--console-unknown)',
} as const;

type OutcomeCounts = Record<CallStatus, number>;
export interface OverviewStats {
  known: boolean;
  online: number;
  totalBrowsers: number;
  matching: number;
  outdated: number;
  versionUnknown: number;
  remoteConfigured: boolean | null;
  calls: OutcomeCounts | null;
}

export function summarizeOverview(state: ViewState): OverviewStats {
  const known = !!state.system;
  const browsers = known ? state.browsers : [];
  const online = browsers.filter((browser) => browser.connected);
  const expected = state.system?.expectedExtensionVersion;
  const statuses = online.map((browser) =>
    versionStatus(browser.metadata?.extensionVersion, expected),
  );
  const calls =
    known && state.history
      ? state.history.calls.reduce<OutcomeCounts>(
          (counts, call) => {
            counts[call.status] += 1;
            return counts;
          },
          { succeeded: 0, failed: 0, rejected: 0, unknown: 0 },
        )
      : null;
  return {
    known,
    online: online.length,
    totalBrowsers: browsers.length,
    matching: statuses.filter((status) => status === 'match').length,
    outdated: statuses.filter((status) => status === 'mismatch').length,
    versionUnknown: statuses.filter((status) => status === 'unknown').length,
    remoteConfigured:
      state.system?.frpc === 'managed' && state.connection
        ? state.connection.configured
        : null,
    calls,
  };
}

function Metric({
  label,
  value,
  detail,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className="console-metric" type="button" onClick={onClick}>
      <span>
        {label}
        <span aria-hidden="true">↗</span>
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function callTotal(counts: OutcomeCounts): number {
  return OUTCOMES.reduce((total, status) => total + counts[status], 0);
}

export function outcomeGradient(counts: OutcomeCounts): string {
  const total = callTotal(counts);
  if (total === 0) return 'var(--console-track)';
  let position = 0;
  const stops = OUTCOMES.map((status) => {
    const start = position;
    position += (100 * counts[status]) / total;
    return `${OUTCOME_COLORS[status]} ${String(start)}% ${String(position)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function Outcomes({
  stats,
  locale,
}: {
  stats: OverviewStats;
  locale: Language;
}) {
  const counts = stats.calls;
  const total = counts ? callTotal(counts) : null;
  return (
    <section className="console-outcomes">
      <div className="console-card-heading">
        <h3>{t(locale, 'overview.callsTitle')}</h3>
        <span>
          {total === null
            ? t(locale, 'common.unknown')
            : t(locale, 'overview.recentCount', { count: total })}
        </span>
      </div>
      <div className="console-outcomes-body">
        <div
          className="console-donut"
          style={{
            background: counts
              ? outcomeGradient(counts)
              : 'var(--console-track)',
          }}
          role="img"
          aria-label={
            counts
              ? t(locale, 'overview.callsAria', { count: total ?? 0 })
              : t(locale, 'calls.unavailable')
          }
        >
          <div>
            <strong>{total === null ? '—' : number(locale, total)}</strong>
            <small>{t(locale, 'overview.callsTotal')}</small>
          </div>
        </div>
        <div className="console-legend">
          {OUTCOMES.map((status) => (
            <div key={status}>
              <span>
                <i
                  className={`console-dot console-dot--${status}`}
                  aria-hidden="true"
                />
                {t(locale, OUTCOME_LABELS[status])}
              </span>
              <strong>{counts ? number(locale, counts[status]) : '—'}</strong>
              <small>
                {counts && total
                  ? `${String(Math.round((counts[status] / total) * 100))}%`
                  : '—'}
              </small>
            </div>
          ))}
        </div>
      </div>
      <p className="console-card-note">
        {total === null
          ? t(locale, 'calls.unavailable')
          : total === 0
            ? t(locale, 'calls.empty')
            : t(locale, 'overview.callsDisclaimer')}
      </p>
    </section>
  );
}

function VersionSegment({
  browser,
  expected,
}: {
  browser: BrowserProfile;
  expected: string | undefined;
}) {
  const status = versionStatus(browser.metadata?.extensionVersion, expected);
  return (
    <i
      className={`console-segment console-segment--${status}`}
      aria-hidden="true"
    />
  );
}

function OnlineHealth({
  stats,
  browsers,
  locale,
}: {
  stats: OverviewStats;
  browsers: BrowserProfile[];
  locale: Language;
}) {
  return (
    <div className="console-health-item">
      <div>
        <span>{t(locale, 'overview.healthOnline')}</span>
        <strong>
          {stats.known
            ? `${number(locale, stats.online)} / ${number(locale, stats.totalBrowsers)}`
            : '—'}
        </strong>
      </div>
      <div
        className="console-health-track"
        role="img"
        aria-label={
          stats.known
            ? t(locale, 'overview.healthOnlineAria', {
                online: stats.online,
                total: stats.totalBrowsers,
              })
            : t(locale, 'common.unknown')
        }
      >
        {browsers.map((browser) => (
          <i
            key={browser.id}
            className={`console-segment ${browser.connected ? 'console-segment--match' : ''}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <small>
        {stats.known
          ? t(locale, 'overview.healthOffline', {
              count: stats.totalBrowsers - stats.online,
            })
          : t(locale, 'overview.unconfirmed')}
      </small>
    </div>
  );
}

function VersionHealth({
  stats,
  state,
  locale,
}: {
  stats: OverviewStats;
  state: ViewState;
  locale: Language;
}) {
  const online = stats.known
    ? state.browsers.filter((browser) => browser.connected)
    : [];
  return (
    <div className="console-health-item">
      <div>
        <span>{t(locale, 'overview.healthVersions')}</span>
        <strong>
          {stats.known
            ? `${number(locale, stats.matching)} / ${number(locale, stats.online)}`
            : '—'}
        </strong>
      </div>
      <div
        className="console-health-track"
        role="img"
        aria-label={
          stats.known
            ? t(locale, 'overview.healthVersionsAria', {
                matching: stats.matching,
                total: stats.online,
              })
            : t(locale, 'common.unknown')
        }
      >
        {online.map((browser) => (
          <VersionSegment
            key={browser.id}
            browser={browser}
            expected={state.system?.expectedExtensionVersion}
          />
        ))}
      </div>
      <small>
        {stats.known
          ? t(locale, 'overview.healthVersionDetail', {
              outdated: stats.outdated,
              unknown: stats.versionUnknown,
            })
          : t(locale, 'overview.unconfirmed')}
      </small>
    </div>
  );
}

function Health({
  stats,
  state,
  locale,
}: {
  stats: OverviewStats;
  state: ViewState;
  locale: Language;
}) {
  const browsers = stats.known ? state.browsers : [];
  return (
    <section className="console-health">
      <div className="console-card-heading">
        <h3>{t(locale, 'overview.healthTitle')}</h3>
        <span>
          {stats.known
            ? t(locale, 'overview.browserCount', { count: stats.totalBrowsers })
            : t(locale, 'common.unknown')}
        </span>
      </div>
      <OnlineHealth stats={stats} browsers={browsers} locale={locale} />
      <VersionHealth stats={stats} state={state} locale={locale} />
      <p className="console-card-note">
        {t(locale, 'overview.healthDisclaimer')}
      </p>
    </section>
  );
}

function OverviewMetrics({
  stats,
  locale,
  onBrowsers,
  onConnection,
}: {
  stats: OverviewStats;
  locale: Language;
  onBrowsers: () => void;
  onConnection: () => void;
}) {
  const remote = stats.remoteConfigured;
  const metrics = [
    {
      label: t(locale, 'overview.browsersOnline'),
      value: stats.known
        ? `${number(locale, stats.online)} / ${number(locale, stats.totalBrowsers)}`
        : '—',
      detail: stats.known
        ? t(locale, 'overview.healthOffline', {
            count: stats.totalBrowsers - stats.online,
          })
        : t(locale, 'overview.unconfirmed'),
      onClick: onBrowsers,
    },
    {
      label: t(locale, 'overview.updates'),
      value: stats.known ? number(locale, stats.outdated) : '—',
      detail: stats.known
        ? t(locale, 'overview.updatesDetail', { unknown: stats.versionUnknown })
        : t(locale, 'overview.unconfirmed'),
      onClick: onBrowsers,
    },
    {
      label: t(locale, 'overview.remoteEntry'),
      value: remote === null ? '—' : remote ? '1' : '0',
      detail:
        remote === null
          ? t(locale, 'overview.remoteUnavailable')
          : t(
              locale,
              remote
                ? 'overview.remoteConfigured'
                : 'overview.remoteUnconfigured',
            ),
      onClick: onConnection,
    },
    {
      label: t(locale, 'overview.authorizedClients'),
      value: '—',
      detail: t(locale, 'overview.clientsUnavailable'),
      onClick: onConnection,
    },
  ];
  return (
    <div className="console-metrics">
      {metrics.map((item) => (
        <Metric key={item.label} {...item} />
      ))}
    </div>
  );
}

export function OverviewInsights({
  state,
  locale,
  onBrowsers,
  onConnection,
  onCalls,
}: {
  state: ViewState;
  locale: Language;
  onBrowsers: () => void;
  onConnection: () => void;
  onCalls: () => void;
}) {
  const stats = summarizeOverview(state);
  return (
    <section
      className="console-summary"
      aria-label={t(locale, 'overview.operationsTitle')}
    >
      <div className="console-context">
        <span>
          <i
            className={`console-status-dot ${stats.known ? 'console-status-dot--online' : ''}`}
            aria-hidden="true"
          />
          {t(locale, stats.known ? 'overview.running' : 'overview.unconfirmed')}
        </span>
        <span>
          {state.system?.daemonVersion ?? '—'} <span aria-hidden="true">·</span>{' '}
          {t(locale, 'overview.liveData')}
        </span>
      </div>
      <OverviewMetrics
        stats={stats}
        locale={locale}
        onBrowsers={onBrowsers}
        onConnection={onConnection}
      />
      <div className="console-insights-heading">
        <div>
          <h2>{t(locale, 'overview.operationsTitle')}</h2>
          <p>{t(locale, 'overview.operationsDescription')}</p>
        </div>
        <button type="button" onClick={onCalls}>
          {t(locale, 'overview.viewCalls')} <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="console-insights" id="overview-activity">
        <Outcomes stats={stats} locale={locale} />
        <Health stats={stats} state={state} locale={locale} />
      </div>
      <p className="console-data-note">{t(locale, 'overview.dataNote')}</p>
    </section>
  );
}
