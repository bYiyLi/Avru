/** Browser history is read via the owning extension, not page JavaScript. */
export interface HistoryRecord {
  url?: string | undefined;
  title?: string | undefined;
  lastVisitTime?: number | undefined;
}

export interface HistoryPort {
  history?: {
    search(options: {
      text: string;
      maxResults: number;
      startTime: number;
      endTime?: number;
    }): Promise<HistoryRecord[]>;
  };
}

interface HistoryOptions {
  from?: string;
  to?: string;
  limit?: number;
  queries?: string[];
}

interface HistoryEntry {
  dateVisited: string;
  title?: string;
  url: string;
}

function toHistoryEntry(item: HistoryRecord): HistoryEntry | undefined {
  if (
    !item.url ||
    item.url.length > 2048 ||
    typeof item.lastVisitTime !== 'number' ||
    !Number.isFinite(item.lastVisitTime)
  )
    return undefined;
  const visit = new Date(item.lastVisitTime);
  if (!Number.isFinite(visit.getTime())) return undefined;
  return {
    url: item.url,
    dateVisited: visit.toISOString(),
    ...(item.title ? { title: item.title.slice(0, 200) } : {}),
  };
}

function parseOptions(args: unknown[]): {
  limit: number;
  from: number;
  to?: number;
  queries: string[];
} {
  const input: unknown = args[0];
  if (
    args.length !== 1 ||
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input)
  )
    throw new Error('INVALID_ARGUMENT');
  const options = input as HistoryOptions;
  if (
    (options.from !== undefined && typeof options.from !== 'string') ||
    (options.to !== undefined && typeof options.to !== 'string')
  )
    throw new Error('INVALID_ARGUMENT');
  const limit = options.limit ?? 20;
  const queries = options.queries ?? [''];
  const from = options.from === undefined ? 0 : Date.parse(options.from);
  const to = options.to === undefined ? undefined : Date.parse(options.to);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 20 ||
    !Array.isArray(queries) ||
    queries.length < 1 ||
    queries.length > 4 ||
    queries.some((query) => typeof query !== 'string' || query.length > 120) ||
    !Number.isFinite(from) ||
    from < 0 ||
    (to !== undefined && (!Number.isFinite(to) || to < from))
  )
    throw new Error('INVALID_ARGUMENT');
  return { limit, from, ...(to !== undefined ? { to } : {}), queries };
}

export async function searchBrowserHistory(
  api: HistoryPort,
  args: unknown[],
): Promise<HistoryEntry[]> {
  const options = parseOptions(args);
  if (!api.history) throw new Error('CAPABILITY_NOT_ALLOWED');
  const found = new Map<string, HistoryEntry>();
  for (const text of options.queries) {
    const records = await api.history.search({
      text,
      maxResults: options.limit,
      startTime: options.from,
      ...(options.to !== undefined ? { endTime: options.to } : {}),
    });
    for (const item of records) {
      const entry = toHistoryEntry(item);
      if (!entry) continue;
      const previous = found.get(entry.url);
      if (previous && previous.dateVisited >= entry.dateVisited) continue;
      found.set(entry.url, entry);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.dateVisited.localeCompare(a.dateVisited))
    .slice(0, options.limit);
}
