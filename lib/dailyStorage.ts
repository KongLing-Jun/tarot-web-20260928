import { apiFetch } from '@/lib/api/client';

export interface DailyDraft {
  note: string;
  dirty: boolean;
  revision: number;
  writes: Promise<boolean>;
}

export interface DailyNoteEntry {
  dateKey: string;
  note: string;
  updatedAt: string | null;
}
export interface DailyEntry extends DailyNoteEntry {
  cardId: string;
  isReversed: boolean;
  interpretation: string;
  interpretationStatus: 'pending' | 'done' | 'error' | 'cancelled' | null;
}
export async function getDailyEntry(dateKey: string, register = false): Promise<DailyEntry | null> {
  const data = await apiFetch<{ entry: DailyEntry | null }>(
    `/api/daily/${encodeURIComponent(dateKey)}`,
    { method: register ? 'POST' : 'GET' },
  );
  return data.entry;
}
export async function getDailyNote(dateKey: string): Promise<DailyNoteEntry | null> {
  const entry = await getDailyEntry(dateKey);
  return entry?.note ? entry : null;
}
export type DailyNoteSaveResult =
  { ok: true; entry: DailyNoteEntry | null } | { ok: false; error: string };
export async function saveDailyNote(dateKey: string, note: string): Promise<DailyNoteSaveResult> {
  try {
    const result = await apiFetch<{ entry: DailyEntry }>(
      `/api/daily/${encodeURIComponent(dateKey)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ note }),
        keepalive: true,
      },
    );
    window.dispatchEvent(new Event('daily-notes-updated'));
    return { ok: true, entry: result.entry.note ? result.entry : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '札记保存失败，请重试' };
  }
}
export async function getAllDailyNotes(): Promise<DailyNoteEntry[]> {
  const entries: DailyNoteEntry[] = [];
  let offset = 0;
  while (true) {
    const page = await apiFetch<{ entries: DailyEntry[]; hasMore: boolean }>(
      `/api/daily?offset=${offset}`,
    );
    entries.push(...page.entries.filter((entry) => entry.note));
    if (!page.hasMore) return entries;
    offset += page.entries.length;
  }
}
const LEGACY_KEY = 'mystic-tarot-daily-notes-v1';
export function hasLegacyDailyNotes(): boolean {
  try {
    return !!localStorage.getItem(LEGACY_KEY);
  } catch {
    return false;
  }
}
export async function importLegacyDailyNotes(): Promise<number> {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return 0;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('旧札记格式错误，原数据已保留');
  const entries = Object.values(parsed) as DailyNoteEntry[];
  const imported: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const result = await apiFetch<{ imported: string[] }>('/api/daily', {
      method: 'POST',
      body: JSON.stringify({ notes: entries.slice(i, i + 100) }),
    });
    imported.push(...result.imported);
  }
  // Keep conflicting dates on the device for manual review; never discard them.
  const remaining = Object.fromEntries(
    Object.entries(parsed).filter(([date]) => !imported.includes(date)),
  );
  if (Object.keys(remaining).length) localStorage.setItem(LEGACY_KEY, JSON.stringify(remaining));
  else localStorage.removeItem(LEGACY_KEY);
  window.dispatchEvent(new Event('daily-notes-updated'));
  return imported.length;
}
