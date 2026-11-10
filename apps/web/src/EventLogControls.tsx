import type { CallSpan, CallStatus } from './call-types.js';
import type { LogTimeRange } from './LogEvents.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';

export interface EventFilterState {
  query: string;
  outcome: 'all' | CallStatus;
  stage: 'all' | CallSpan['name'];
  event: string;
  timeRange: LogTimeRange;
}

type SelectKey = Exclude<keyof EventFilterState, 'query'>;
type Option = { value: string; label: string };
type FilterConfig = { key: SelectKey; label: string; options: Option[] };

function filterConfigs(locale: Language, eventCodes: string[]): FilterConfig[] {
  return [
    {
      key: 'outcome',
      label: t(locale, 'events.outcome'),
      options: [
        { value: 'all', label: t(locale, 'events.allOutcomes') },
        ...(['succeeded', 'rejected', 'failed', 'unknown'] as const).map(
          (status) => ({ value: status, label: t(locale, `calls.${status}`) }),
        ),
      ],
    },
    {
      key: 'stage',
      label: t(locale, 'events.stage'),
      options: [
        { value: 'all', label: t(locale, 'events.allStages') },
        ...(['request', 'authorization', 'dispatch'] as const).map((name) => ({
          value: name,
          label: t(locale, `calls.span.${name}`),
        })),
      ],
    },
    {
      key: 'event',
      label: t(locale, 'events.eventCode'),
      options: [
        { value: 'all', label: t(locale, 'events.allEvents') },
        ...eventCodes.map((code) => ({ value: code, label: code })),
      ],
    },
    {
      key: 'timeRange',
      label: t(locale, 'events.timeRange'),
      options: (['all', '15m', '1h', '24h'] as const).map((range) => ({
        value: range,
        label: t(locale, `events.time.${range}`),
      })),
    },
  ];
}

export function EventLogFilters({
  filters,
  codes,
  locale,
  onChange,
}: {
  filters: EventFilterState;
  codes: string[];
  locale: Language;
  onChange: (key: keyof EventFilterState, value: string) => void;
}) {
  return (
    <div className="logs-filters">
      <label className="logs-search">
        <span>{t(locale, 'events.searchLabel')}</span>
        <input
          type="search"
          aria-label={t(locale, 'events.searchLabel')}
          placeholder={t(locale, 'events.search')}
          value={filters.query}
          onChange={(event) => {
            onChange('query', event.currentTarget.value);
          }}
        />
      </label>
      {filterConfigs(locale, codes).map((config) => (
        <label key={config.key}>
          <span>{config.label}</span>
          <select
            aria-label={config.label}
            value={filters[config.key]}
            onChange={(event) => {
              onChange(config.key, event.currentTarget.value);
            }}
          >
            {config.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

export type EventLogNotice = '' | 'exported' | 'copied' | 'copyFailed';

export function EventLogFooter({
  locale,
  available,
  shown,
  total,
  page,
  pages,
  notice,
  onExport,
  onCopy,
  onPage,
}: {
  locale: Language;
  available: boolean;
  shown: number;
  total: number;
  page: number;
  pages: number;
  notice: EventLogNotice;
  onExport: () => void;
  onCopy: () => void;
  onPage: (value: number) => void;
}) {
  return (
    <footer className="logs-table-footer">
      <div className="logs-table-footer-meta">
        <span
          className={`logs-data-state${available ? ' logs-data-state--available' : ''}`}
        >
          {t(locale, available ? 'events.localRecords' : 'events.unavailable')}
        </span>
        <span className="logs-footer-count">
          {available
            ? t(locale, 'events.count', { shown, total })
            : t(locale, 'common.unknown')}
        </span>
        <span className="logs-footer-time">{t(locale, 'events.timeZone')}</span>
        {notice && (
          <span role="status" className="logs-footer-notice">
            {t(
              locale,
              notice === 'exported'
                ? 'events.exported'
                : notice === 'copied'
                  ? 'events.summaryCopied'
                  : 'events.copyFailed',
            )}
          </span>
        )}
      </div>
      <div className="logs-table-footer-actions">
        <button type="button" disabled={!available} onClick={onExport}>
          {t(locale, 'events.export')}
        </button>
        <button type="button" disabled={!available} onClick={onCopy}>
          {t(locale, 'events.copySummary')}
        </button>
        <EventLogPagination
          locale={locale}
          page={page}
          pages={pages}
          onPage={onPage}
        />
      </div>
    </footer>
  );
}

export function EventLogPagination({
  locale,
  page,
  pages,
  onPage,
}: {
  locale: Language;
  page: number;
  pages: number;
  onPage: (value: number) => void;
}) {
  return (
    <div className="logs-pagination">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        {t(locale, 'events.previous')}
      </button>
      <span>{t(locale, 'events.page', { page, pages })}</span>
      <button
        type="button"
        disabled={page >= pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        {t(locale, 'events.next')}
      </button>
    </div>
  );
}
