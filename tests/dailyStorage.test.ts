import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAllDailyNotes,
  getDailyNote,
  saveDailyNote,
  importLegacyDailyNotes,
} from '@/lib/dailyStorage';
import { mockDailyApi, makeEntry } from './helpers/daily-api';

describe('daily database API client', () => {
  let api: ReturnType<typeof mockDailyApi>;
  beforeEach(() => {
    api = mockDailyApi();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports success only after the server stores the note and uses keepalive', async () => {
    expect(await saveDailyNote('2026-09-09', '今日札记')).toMatchObject({ ok: true });
    expect((await getDailyNote('2026-09-09'))?.note).toBe('今日札记');
    expect(api.fetch.mock.calls[0][1]).toMatchObject({ method: 'PATCH', keepalive: true });
    expect(localStorage.length).toBe(0);
  });

  it('reports a database failure and preserves the saved note', async () => {
    await saveDailyNote('2026-09-09', '原文');
    api.failWrite = true;
    expect(await saveDailyNote('2026-09-09', '新草稿')).toEqual({
      ok: false,
      error: '数据库暂不可用',
    });
    expect((await getDailyNote('2026-09-09'))?.note).toBe('原文');
  });

  it('clears only the note and retains the daily interpretation', async () => {
    api.entries.set('2026-09-09', {
      ...makeEntry('2026-09-09'),
      interpretation: '神谕',
      note: '旧文',
    });
    expect(await saveDailyNote('2026-09-09', '')).toEqual({ ok: true, entry: null });
    expect(api.entries.get('2026-09-09')?.interpretation).toBe('神谕');
  });

  it('reads every page without discarding notes older than 60 days', async () => {
    for (let day = 1; day <= 110; day++) {
      const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
      api.entries.set(date, { ...makeEntry(date), note: '札记' });
    }
    expect(await getAllDailyNotes()).toHaveLength(110);
  });

  it('imports legacy notes without overwriting cloud notes and keeps failures for retry', async () => {
    localStorage.setItem(
      'mystic-tarot-daily-notes-v1',
      JSON.stringify({
        '2026-09-08': { dateKey: '2026-09-08', note: '旧设备札记' },
        '2026-09-09': { dateKey: '2026-09-09', note: '冲突内容' },
      }),
    );
    await saveDailyNote('2026-09-09', '云端内容');
    api.failWrite = true;
    await expect(importLegacyDailyNotes()).rejects.toThrow();
    expect(localStorage.getItem('mystic-tarot-daily-notes-v1')).toContain('旧设备札记');
    api.failWrite = false;
    expect(await importLegacyDailyNotes()).toBe(1);
    expect((await getDailyNote('2026-09-09'))?.note).toBe('云端内容');
    expect(localStorage.getItem('mystic-tarot-daily-notes-v1')).toContain('冲突内容');
    expect(localStorage.getItem('mystic-tarot-daily-notes-v1')).not.toContain('旧设备札记');
  });
});
