import { vi } from 'vitest';
import type { DailyEntry } from '@/lib/dailyStorage';
import { getDailyDraw, parseDateKey } from '@/lib/tarot/daily';

// Exercise the actual frontend HTTP client, with controllable network failures.
export function mockDailyApi() {
  const entries = new Map<string, DailyEntry>();
  const api = { entries, failRead: false, failWrite: false, fetch: vi.fn() };
  api.fetch.mockImplementation(async (input: string, options?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = options?.method ?? 'GET';
    if ((method === 'GET' && api.failRead) || (method !== 'GET' && api.failWrite)) {
      return Response.json({ error: '数据库暂不可用' }, { status: 503 });
    }
    if (url.pathname === '/api/daily' && method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const sorted = [...entries.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey));
      return Response.json({
        entries: sorted.slice(offset, offset + 100),
        hasMore: sorted.length > offset + 100,
      });
    }
    if (url.pathname === '/api/daily' && method === 'POST') {
      const { notes } = JSON.parse(String(options?.body));
      const imported: string[] = [];
      for (const note of notes) {
        if (!entries.get(note.dateKey)?.updatedAt) {
          entries.set(note.dateKey, {
            ...makeEntry(note.dateKey),
            ...note,
            updatedAt: new Date().toISOString(),
          });
          imported.push(note.dateKey);
        }
      }
      return Response.json({ imported });
    }
    const date = url.pathname.slice('/api/daily/'.length);
    if (method === 'POST' || method === 'PATCH') {
      const entry = entries.get(date) ?? makeEntry(date);
      entries.set(
        date,
        method === 'PATCH'
          ? { ...entry, ...JSON.parse(String(options?.body)), updatedAt: new Date().toISOString() }
          : entry,
      );
    }
    return Response.json({ entry: entries.get(date) ?? null });
  });
  vi.stubGlobal('fetch', api.fetch);
  return api;
}

export function makeEntry(dateKey: string): DailyEntry {
  const draw = getDailyDraw(parseDateKey(dateKey)!);
  return {
    dateKey,
    cardId: draw.card.id,
    isReversed: draw.isReversed,
    note: '',
    updatedAt: null,
    interpretation: '',
    interpretationStatus: null,
  };
}
