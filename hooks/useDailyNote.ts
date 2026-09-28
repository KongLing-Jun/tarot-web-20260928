'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDailyNote, saveDailyNote, type DailyNoteEntry } from '@/lib/dailyStorage';
import { useUser } from '@/components/session/UserSession';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Mount an editor per date. Serial writes prevent slow requests overwriting newer input. */
export function useDailyNote(dateKey: string) {
  const { dailyDrafts } = useUser();
  const [initialDraft] = useState(() => {
    const value = dailyDrafts.get(dateKey) ?? {
      note: '',
      dirty: false,
      revision: 0,
      writes: Promise.resolve(true),
    };
    dailyDrafts.set(dateKey, value);
    return value;
  });
  const draft = useRef(initialDraft);
  const [savedNote, setSavedNote] = useState<DailyNoteEntry | null>(null);
  const [note, setNote] = useState(initialDraft.note);
  const [loading, setLoading] = useState(!initialDraft.dirty);
  const [saveState, setSaveState] = useState<SaveState>(initialDraft.dirty ? 'error' : 'idle');
  const [saveError, setSaveError] = useState<string | null>(
    initialDraft.dirty ? '此日期有尚未保存的草稿，请重试保存。' : null,
  );
  const mounted = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timerRef.current);
    const text = draft.current.note;
    const version = draft.current.revision;
    draft.current.writes = draft.current.writes.then(async () => {
      if (!draft.current.dirty || version !== draft.current.revision) return true;
      const result = await saveDailyNote(dateKey, text);
      if (version !== draft.current.revision) return result.ok;
      if (result.ok) draft.current.dirty = false;
      if (mounted.current) {
        if (result.ok) {
          setSavedNote(result.entry);
          setSaveError(null);
          setSaveState('saved');
        } else {
          setSaveError(result.error);
          setSaveState('error');
        }
      }
      return result.ok;
    });
    return draft.current.writes;
  }, [dateKey, draft]);

  const updateNote = useCallback(
    (value: string) => {
      draft.current.note = value;
      draft.current.revision++;
      draft.current.dirty = true;
      setNote(value);
      setSaveState('saving');
      setSaveError(null);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, 800);
    },
    [flush, draft],
  );

  const reload = useCallback(async () => {
    try {
      await draft.current.writes;
      if (draft.current.dirty) return;
      const version = draft.current.revision;
      const entry = await getDailyNote(dateKey);
      if (!mounted.current || draft.current.dirty || version !== draft.current.revision) return;
      draft.current.note = entry?.note ?? '';
      setNote(draft.current.note);
      setSavedNote(entry);
      setSaveError(null);
      setLoading(false);
    } catch (error) {
      if (mounted.current) setSaveError(error instanceof Error ? error.message : '札记读取失败');
    }
  }, [dateKey, draft]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      void reload();
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => {
      void flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draft.current.dirty) {
        void flush();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('daily-notes-updated', reload);
    return () => {
      mounted.current = false;
      void flush();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('daily-notes-updated', reload);
    };
  }, [flush, reload, draft]);

  return { note, savedNote, saveState, saveError, loading, updateNote, flush, reload };
}
