import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyNote } from '@/hooks/useDailyNote';
import { getDailyNote, type DailyDraft } from '@/lib/dailyStorage';
import { mockDailyApi, makeEntry } from './helpers/daily-api';

const drafts = vi.hoisted(() => new Map<string, DailyDraft>());
vi.mock('@/components/session/UserSession', () => ({ useUser: () => ({ dailyDrafts: drafts }) }));
async function settle() {
  await act(async () => {});
}

describe('daily note database lifecycle', () => {
  let api: ReturnType<typeof mockDailyApi>;
  beforeEach(() => {
    drafts.clear();
    api = mockDailyApi();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads the saved cloud note and saves the old date when switching immediately', async () => {
    api.entries.set('2026-09-08', { ...makeEntry('2026-09-08'), note: '云端札记' });
    const first = renderHook(() => useDailyNote('2026-09-08'));
    await settle();
    expect(first.result.current.note).toBe('云端札记');
    act(() => first.result.current.updateNote('昨天的草稿'));
    first.unmount();
    const second = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    expect(second.result.current.note).toBe('');
    expect((await getDailyNote('2026-09-08'))?.note).toBe('昨天的草稿');
    act(() => second.result.current.updateNote('今天的草稿'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect((await getDailyNote('2026-09-09'))?.note).toBe('今天的草稿');
    expect(second.result.current.saveState).toBe('saved');
  });

  it.each(['visibilitychange', 'pagehide'])('flushes pending input on %s', async (event) => {
    const { result } = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    act(() => result.current.updateNote('退出前最后一笔'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
    });
    expect((await getDailyNote('2026-09-09'))?.note).toBe('退出前最后一笔');
    expect(result.current.saveState).toBe('saved');
  });

  it('retains a failed draft across navigation and retries it', async () => {
    const first = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    api.failWrite = true;
    act(() => first.result.current.updateNote('不能丢失的草稿'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(first.result.current.saveState).toBe('error');
    first.unmount();
    const returned = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    expect(returned.result.current.note).toBe('不能丢失的草稿');
    api.failWrite = false;
    await act(async () => {
      await returned.result.current.flush();
    });
    expect(returned.result.current.saveState).toBe('saved');
  });

  it('keeps editing disabled after a load failure until retry succeeds', async () => {
    api.failRead = true;
    const { result } = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    expect(result.current.loading).toBe(true);
    expect(result.current.saveError).toBeTruthy();
    api.failRead = false;
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.loading).toBe(false);
  });

  it('warns on exit while a database write is unacknowledged', async () => {
    const { result } = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    act(() => result.current.updateNote('未保存'));
    const event = new Event('beforeunload', { cancelable: true });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    const saved = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(saved));
    expect(saved.defaultPrevented).toBe(false);
  });

  it('serializes slow saves and does not mark newer unsaved input as saved', async () => {
    const { result } = renderHook(() => useDailyNote('2026-09-09'));
    await settle();
    const original = api.fetch.getMockImplementation()!;
    let release!: () => void;
    api.fetch.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return original(...args);
    });
    act(() => result.current.updateNote('第一版'));
    await act(async () => {
      void result.current.flush();
    });
    act(() => result.current.updateNote('第二版'));
    await act(async () => {
      release();
    });
    expect(result.current.saveState).toBe('saving');
    await act(async () => {
      await result.current.flush();
    });
    expect((await getDailyNote('2026-09-09'))?.note).toBe('第二版');
  });
});
