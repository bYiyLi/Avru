import { useState } from 'react';
import {
  buildDiagnosticsSummary,
  copyText,
  downloadTextFile,
  filterCalls,
} from './Calls.js';
import type { CallHistory, CallTrace } from './call-types.js';
import {
  buildEventLogsJson,
  buildLogRows,
  filterLogRows,
  LogEvents,
} from './LogEvents.js';
import { EventLogFilters, EventLogFooter } from './EventLogControls.js';
import type { EventFilterState, EventLogNotice } from './EventLogControls.js';
import { translate as t } from './i18n.js';
import type { Language } from './presentation.js';
import './logs.css';

const PAGE_SIZE = 20;

const INITIAL_FILTERS: EventFilterState = {
  query: '',
  outcome: 'all',
  stage: 'all',
  event: 'all',
  timeRange: 'all',
};

function eventData(
  calls: CallTrace[],
  filters: EventFilterState,
  locale: Language,
) {
  const allRows = buildLogRows(calls);
  const codes = [
    ...new Set(allRows.flatMap((row) => (row.event ? [row.event.code] : []))),
  ].sort();
  const candidates = filterCalls(calls, {
    outcome: filters.outcome,
    tool: 'all',
    event: filters.event,
    query: '',
  });
  const rows = filterLogRows(
    buildLogRows(candidates),
    {
      event: filters.event,
      stage: filters.stage,
      timeRange: filters.timeRange,
      query: filters.query,
    },
    locale,
  );
  const traceIds = new Set(rows.map((row) => row.call.traceId));
  const matchingCalls = candidates.filter((call) => traceIds.has(call.traceId));
  return { allRows, codes, rows, matchingCalls };
}

function EventLogPrivacy({
  history,
  locale,
}: {
  history: CallHistory | null | undefined;
  locale: Language;
}) {
  return (
    <p className="logs-data-note">
      {history &&
        `${t(locale, 'calls.retention', { count: history.retention.limit })} · ${t(locale, history.retention.persistent ? 'calls.persistent' : 'calls.ephemeral')}. `}
      {t(locale, 'calls.privacy')}
    </p>
  );
}

function activeFilters(filters: EventFilterState): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.outcome !== 'all' ||
    filters.stage !== 'all' ||
    filters.event !== 'all' ||
    filters.timeRange !== 'all'
  );
}

/** Independent event-level viewer backed exclusively by sanitized MCP traces. */
export function EventLogsPage({
  history,
  locale,
}: {
  history?: CallHistory | null;
  locale: Language;
}) {
  const [filters, setFilters] = useState<EventFilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<EventLogNotice>('');
  const { allRows, codes, rows, matchingCalls } = eventData(
    history?.calls ?? [],
    filters,
    locale,
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visibleRows = rows.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE,
  );
  const hasFilters = activeFilters(filters);
  const changeFilter = (key: keyof EventFilterState, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
    setNotice('');
  };
  const exportRows = () => {
    downloadTextFile(
      'avru-events.json',
      buildEventLogsJson(rows),
      'application/json',
    );
    setNotice('exported');
  };
  const copySummary = () => {
    void copyText(buildDiagnosticsSummary(matchingCalls, locale)).then(
      (ok) => {
        setNotice(ok ? 'copied' : 'copyFailed');
      },
      () => {
        setNotice('copyFailed');
      },
    );
  };
  return (
    <section
      className="logs console-logs console-logs--events"
      aria-label={t(locale, 'events.title')}
    >
      <EventLogFilters
        filters={filters}
        codes={codes}
        locale={locale}
        onChange={changeFilter}
      />
      <div className="logs-table-block">
        <LogEvents
          rows={visibleRows}
          locale={locale}
          available={Boolean(history)}
          emptyMessage={hasFilters ? 'logs.noResults' : 'calls.empty'}
        />
        <EventLogFooter
          locale={locale}
          available={Boolean(history)}
          shown={rows.length}
          total={allRows.length}
          page={current}
          pages={pages}
          notice={notice}
          onExport={exportRows}
          onCopy={copySummary}
          onPage={setPage}
        />
      </div>
      <EventLogPrivacy history={history ?? null} locale={locale} />
    </section>
  );
}
