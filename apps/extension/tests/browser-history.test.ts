import { describe, expect, it, vi } from 'vitest';
import {
  searchBrowserHistory,
  type HistoryPort,
} from '../utils/browser-history';

function fixture(
  records: { url?: string; title?: string; lastVisitTime?: number }[],
) {
  const search = vi.fn(() => Promise.resolve(records));
  const api: HistoryPort = { history: { search } };
  return { api, search };
}

describe('browser history in the connected extension', () => {
  it('returns recent visits with bounded fields and a default search', async () => {
    const h = fixture([
      { url: 'https://example.test/a', title: 'Title', lastVisitTime: 2000 },
      { url: 'https://example.test/b', lastVisitTime: 1000 },
    ]);
    expect(await searchBrowserHistory(h.api, [{}])).toEqual([
      {
        url: 'https://example.test/a',
        title: 'Title',
        dateVisited: '1970-01-01T00:00:02.000Z',
      },
      {
        url: 'https://example.test/b',
        dateVisited: '1970-01-01T00:00:01.000Z',
      },
    ]);
    expect(h.search).toHaveBeenCalledWith({
      text: '',
      maxResults: 20,
      startTime: 0,
    });
  });

  it('combines several searches, deduplicates and sorts by latest visit', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([
        { url: 'https://example.test/a', title: 'a', lastVisitTime: 1000 },
        { url: 'https://example.test/b', title: 'b', lastVisitTime: 3000 },
      ])
      .mockResolvedValueOnce([
        { url: 'https://example.test/a', title: 'new', lastVisitTime: 4000 },
        { url: 'https://example.test/c', title: 'c', lastVisitTime: 2000 },
      ]);
    const api: HistoryPort = { history: { search } };
    const result = await searchBrowserHistory(api, [
      {
        from: '1970-01-01T00:00:00.000Z',
        to: '2026-12-01T00:00:00.000Z',
        limit: 2,
        queries: ['a', 'b'],
      },
    ]);
    expect(result).toEqual([
      {
        url: 'https://example.test/a',
        title: 'new',
        dateVisited: '1970-01-01T00:00:04.000Z',
      },
      {
        url: 'https://example.test/b',
        title: 'b',
        dateVisited: '1970-01-01T00:00:03.000Z',
      },
    ]);
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledWith({
      text: 'b',
      startTime: 0,
      endTime: Date.parse('2026-12-01T00:00:00.000Z'),
      maxResults: 2,
    });
  });

  it('rejects invalid arguments before accessing the browser API', async () => {
    const h = fixture([]);
    const invalid = [
      [],
      [null],
      ['hello'],
      [7],
      [{ limit: 0 }],
      [{ limit: 21 }],
      [{ from: 0 }],
      [{ to: true }],
      [{ from: 'not a date' }],
      [{ to: 'bad' }],
      [{ from: '2026-12-01', to: '2026-11-01' }],
      [{ queries: [] }],
      [{ queries: Array(5).fill('query') }],
      [{ queries: [2] }],
      [{ queries: ['x'.repeat(121)] }],
    ];
    for (const args of invalid)
      await expect(searchBrowserHistory(h.api, args)).rejects.toThrow(
        'INVALID_ARGUMENT',
      );
    expect(h.search).not.toHaveBeenCalled();
  });

  it('reports unsupported browser APIs without pretending to have history', async () => {
    await expect(searchBrowserHistory({}, [{}])).rejects.toThrow(
      'CAPABILITY_NOT_ALLOWED',
    );
  });

  it('skips corrupt records, invalid timestamps and older duplicate visits', async () => {
    const h = fixture([
      { url: 'https://example.test/a', lastVisitTime: 4000 },
      { url: 'https://example.test/a', lastVisitTime: 2000 },
      {
        url: 'https://example.test/b',
        title: 'Z'.repeat(250),
        lastVisitTime: 3000,
      },
      { title: 'No URL', lastVisitTime: 1000 },
      { url: 'https://example.test/' + 'z'.repeat(3000), lastVisitTime: 5000 },
      {
        url: 'https://example.test/invalid',
        lastVisitTime: Number.POSITIVE_INFINITY,
      },
      { url: 'https://example.test/missing' },
      { url: 'https://example.test/outside-range', lastVisitTime: 1e20 },
    ]);
    const result = await searchBrowserHistory(h.api, [{}]);
    expect(result).toHaveLength(2);
    expect(result[0]?.url).toBe('https://example.test/a');
    expect(result[1]?.title).toBe('Z'.repeat(200));
  });

  it('does not convert a browser API rejection into a successful empty result', async () => {
    const api: HistoryPort = {
      history: {
        search: () => Promise.reject(new Error('permission denied')),
      },
    };
    await expect(searchBrowserHistory(api, [{}])).rejects.toThrow(
      'permission denied',
    );
  });
});
