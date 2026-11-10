import { useState } from 'react';
import {
  Calls,
  buildDiagnosticsSummary,
  buildLogsJson,
  copyText,
  downloadTextFile,
  filterCalls,
} from './Calls.js';
import type { CallHistory, CallTrace } from './call-types.js';
import type { LogFilters } from './Calls.js';
import { buildLogRows, LogEvents } from './LogEvents.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
import './logs.css';
const LOG_PAGE_SIZE = 20;
export type LogNotice =
  '' | 'logs.exported' | 'logs.summaryCopied' | 'logs.copyFailed';
function LogPageHead({
  locale,
  onOpenInstall,
}: {
  locale: Language;
  onOpenInstall: (() => void) | undefined;
}) {
  return (
    <div className="logs-page-head">
      <div>
        <h1>{t(locale, 'logs.title')}</h1>
        <p className="lead">{t(locale, 'logs.pageSubtitle')}</p>
      </div>
      {onOpenInstall && (
        <button type="button" onClick={onOpenInstall}>
          + {t(locale, 'logs.installGuide')}
        </button>
      )}
    </div>
  );
}
function LogResults({
  locale,
  history,
  paged,
  filteredHistory,
  filtered,
  total,
  filtersActive,
  notice,
  current,
  pageCount,
  onPage,
  onNotice,
}: {
  locale: Language;
  history: CallHistory | null | undefined;
  paged: CallTrace[];
  filteredHistory: CallHistory | null;
  filtered: CallTrace[];
  total: number;
  filtersActive: boolean;
  notice: LogNotice;
  current: number;
  pageCount: number;
  onPage: (page: number) => void;
  onNotice: (notice: LogNotice) => void;
}) {
  const emptyMessage = filtersActive ? 'logs.noResults' : 'calls.empty';
  return (
    <>
      <Calls
        history={filteredHistory}
        locale={locale}
        emptyMessage={emptyMessage}
      />
      <footer className="logs-table-footer logs-calls-footer">
        <div className="logs-table-footer-meta">
          <span
            className={`logs-data-state${history ? ' logs-data-state--available' : ''}`}
          >
            {t(locale, history ? 'logs.sourceNote' : 'logs.sourceUnknown')}
          </span>
          {history && (
            <span className="logs-footer-count">
              {t(locale, 'logs.resultCount', {
                shown: filtered.length,
                total,
              })}
            </span>
          )}
          {notice && (
            <span role="status" className="logs-footer-notice">
              {t(locale, notice)}
            </span>
          )}
        </div>
        <div className="logs-table-footer-actions">
          <LogActions
            locale={locale}
            disabled={!history}
            filtered={filtered}
            onNotice={onNotice}
          />
          <LogPagination
            locale={locale}
            current={current}
            pages={pageCount}
            onPage={onPage}
          />
        </div>
      </footer>
      <details className="logs-call-archive">
        <summary>{t(locale, 'logs.eventsSectionTitle')}</summary>
        <LogEvents
          rows={buildLogRows(paged)}
          locale={locale}
          available={Boolean(history)}
          emptyMessage={emptyMessage}
        />
      </details>
    </>
  );
}
function recordedEventCodes(calls: CallTrace[]): string[] {
  return [
    ...new Set(
      calls.flatMap((call) =>
        call.spans.flatMap((span) => span.events.map((item) => item.code)),
      ),
    ),
  ].sort();
}
export function LogsPage({
  history,
  locale,
  onOpenInstall,
}: {
  history?: CallHistory | null;
  locale: Language;
  onOpenInstall?: () => void;
}) {
  const [outcome, setOutcome] = useState<LogFilters['outcome']>('all');
  const [tool, setTool] = useState('all');
  const [event, setEvent] = useState('all');
  const [query, setQuery] = useState('');
  const [period, setPeriod] =
    useState<NonNullable<LogFilters['period']>>('all');
  const [sort, setSort] = useState<NonNullable<LogFilters['sort']>>('newest');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<LogNotice>('');
  const calls = history?.calls ?? [];
  const tools = [...new Set(calls.map((call) => call.tool ?? ''))].sort();
  const events = recordedEventCodes(calls);
  const filtersActive =
    outcome !== 'all' ||
    tool !== 'all' ||
    event !== 'all' ||
    query.trim() !== '' ||
    period !== 'all';
  const filtered = filterCalls(calls, {
    outcome,
    tool,
    event,
    query,
    period,
    sort,
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const paged = filtered.slice(
    (current - 1) * LOG_PAGE_SIZE,
    current * LOG_PAGE_SIZE,
  );
  const filteredHistory = history ? { ...history, calls: paged } : null;
  const updateFilter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  return (
    <section className="logs console-logs" aria-label={t(locale, 'logs.title')}>
      <LogPageHead locale={locale} onOpenInstall={onOpenInstall} />
      <LogFilters
        locale={locale}
        outcome={outcome}
        tool={tool}
        event={event}
        query={query}
        period={period}
        sort={sort}
        tools={tools}
        events={events}
        onOutcome={updateFilter(setOutcome)}
        onTool={updateFilter(setTool)}
        onEvent={updateFilter(setEvent)}
        onQuery={updateFilter(setQuery)}
        onPeriod={updateFilter(setPeriod)}
        onSort={updateFilter(setSort)}
      />
      <LogResults
        locale={locale}
        history={history}
        paged={paged}
        filteredHistory={filteredHistory}
        filtered={filtered}
        total={calls.length}
        filtersActive={filtersActive}
        notice={notice}
        current={current}
        pageCount={pageCount}
        onPage={setPage}
        onNotice={setNotice}
      />
    </section>
  );
}
function FilterSelect({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onSelect(event.currentTarget.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function CoreLogFilters({
  locale,
  outcome,
  tool,
  event,
  tools,
  events,
  onOutcome,
  onTool,
  onEvent,
}: {
  locale: Language;
  outcome: LogFilters['outcome'];
  tool: string;
  event: string;
  tools: string[];
  events: string[];
  onOutcome: (value: LogFilters['outcome']) => void;
  onTool: (value: string) => void;
  onEvent: (value: string) => void;
}) {
  const all = t(locale, 'logs.filterAll');
  return (
    <>
      <FilterSelect
        label={t(locale, 'logs.filterOutcome')}
        value={outcome}
        options={[
          { value: 'all', label: all },
          ...(['succeeded', 'rejected', 'failed', 'unknown'] as const).map(
            (status) => ({
              value: status,
              label: t(locale, `calls.${status}`),
            }),
          ),
        ]}
        onSelect={(value) => {
          onOutcome(value as LogFilters['outcome']);
        }}
      />
      <FilterSelect
        label={t(locale, 'logs.filterTool')}
        value={tool}
        options={[
          { value: 'all', label: all },
          ...tools.map((name) => ({
            value: name,
            label: name || t(locale, 'logs.noTool'),
          })),
        ]}
        onSelect={onTool}
      />
      <FilterSelect
        label={t(locale, 'logs.filterEvent')}
        value={event}
        options={[
          { value: 'all', label: all },
          ...events.map((code) => ({ value: code, label: code })),
        ]}
        onSelect={onEvent}
      />
    </>
  );
}
function LogFilters({
  locale,
  outcome,
  tool,
  event,
  query,
  period,
  sort,
  tools,
  events,
  onOutcome,
  onTool,
  onEvent,
  onQuery,
  onPeriod,
  onSort,
}: {
  locale: Language;
  outcome: LogFilters['outcome'];
  tool: string;
  event: string;
  query: string;
  period: NonNullable<LogFilters['period']>;
  sort: NonNullable<LogFilters['sort']>;
  tools: string[];
  events: string[];
  onOutcome: (value: LogFilters['outcome']) => void;
  onTool: (value: string) => void;
  onEvent: (value: string) => void;
  onQuery: (value: string) => void;
  onPeriod: (value: NonNullable<LogFilters['period']>) => void;
  onSort: (value: NonNullable<LogFilters['sort']>) => void;
}) {
  return (
    <div className="logs-filters">
      <CoreLogFilters
        locale={locale}
        outcome={outcome}
        tool={tool}
        event={event}
        tools={tools}
        events={events}
        onOutcome={onOutcome}
        onTool={onTool}
        onEvent={onEvent}
      />
      <label className="logs-search">
        <span>{t(locale, 'logs.searchLabel')}</span>
        <input
          type="search"
          aria-label={t(locale, 'logs.searchLabel')}
          placeholder={t(locale, 'logs.search')}
          value={query}
          onChange={(event) => {
            onQuery(event.currentTarget.value);
          }}
        />
      </label>
      <FilterSelect
        label={t(locale, 'logs.filterPeriod')}
        value={period}
        options={[
          { value: 'all', label: t(locale, 'logs.periodAll') },
          { value: 'hour', label: t(locale, 'logs.periodHour') },
          { value: 'day', label: t(locale, 'logs.periodDay') },
          { value: 'week', label: t(locale, 'logs.periodWeek') },
        ]}
        onSelect={(value) => {
          onPeriod(value as NonNullable<LogFilters['period']>);
        }}
      />
      <FilterSelect
        label={t(locale, 'logs.sortLabel')}
        value={sort}
        options={[
          { value: 'newest', label: t(locale, 'logs.sortNewest') },
          { value: 'oldest', label: t(locale, 'logs.sortOldest') },
          { value: 'slowest', label: t(locale, 'logs.sortSlowest') },
        ]}
        onSelect={(value) => {
          onSort(value as NonNullable<LogFilters['sort']>);
        }}
      />
    </div>
  );
}
function LogActions({
  locale,
  disabled,
  filtered,
  onNotice,
}: {
  locale: Language;
  disabled: boolean;
  filtered: CallTrace[];
  onNotice: (notice: LogNotice) => void;
}) {
  return (
    <div className="logs-actions">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          downloadTextFile(
            'avru-call-logs.json',
            buildLogsJson(filtered),
            'application/json',
          );
          onNotice('logs.exported');
        }}
      >
        {t(locale, 'logs.exportJson')}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          void copyText(buildDiagnosticsSummary(filtered, locale)).then(
            (ok) => {
              onNotice(ok ? 'logs.summaryCopied' : 'logs.copyFailed');
            },
            () => {
              onNotice('logs.copyFailed');
            },
          );
        }}
      >
        {t(locale, 'logs.copySummary')}
      </button>
    </div>
  );
}
function LogPagination({
  locale,
  current,
  pages,
  onPage,
}: {
  locale: Language;
  current: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="logs-pagination">
      <button
        type="button"
        disabled={current <= 1}
        onClick={() => {
          onPage(current - 1);
        }}
      >
        {t(locale, 'logs.previous')}
      </button>
      <span>{t(locale, 'logs.page', { page: current, pages })}</span>
      <button
        type="button"
        disabled={current >= pages}
        onClick={() => {
          onPage(current + 1);
        }}
      >
        {t(locale, 'logs.next')}
      </button>
    </div>
  );
}
