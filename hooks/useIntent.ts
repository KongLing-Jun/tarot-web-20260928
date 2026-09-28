'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { IntentRequest, IntentSnapshot } from '@/lib/intent/types';

export function useIntent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<IntentSnapshot | null>(null);
  const revision = useRef(0);
  const pending = useRef<{ key: string; controller: AbortController } | null>(null);
  const lastResolved = useRef<{
    snapshot: IntentSnapshot;
    sceneId?: string;
    readingId?: string;
  } | null>(null);

  const cancel = useCallback(() => {
    revision.current += 1;
    pending.current?.controller.abort();
    pending.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const invalidate = useCallback(() => {
    cancel();
    setBusy(false);
    setError(null);
    setSnapshot(null);
  }, [cancel]);

  const reset = useCallback(() => {
    lastResolved.current = null;
    invalidate();
  }, [invalidate]);

  const analyze = useCallback(
    async (request: IntentRequest): Promise<IntentSnapshot | null> => {
      const previous = lastResolved.current;
      const sameScope =
        previous?.sceneId === request.sceneId && previous?.readingId === request.readingId;
      const previousIntentId =
        request.previousIntentId ?? (sameScope ? previous?.snapshot.id : undefined);
      const input = previousIntentId ? { ...request, previousIntentId } : request;
      const key = JSON.stringify([
        request.question,
        request.sceneId,
        request.readingId,
        input.previousIntentId,
      ]);
      if (pending.current?.key === key) return null;
      cancel();
      const currentRevision = revision.current;
      const controller = new AbortController();
      pending.current = { key, controller };
      setBusy(true);
      setError(null);
      setSnapshot(null);

      try {
        const next = await apiFetch<IntentSnapshot>('/api/intent', {
          method: 'POST',
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        if (controller.signal.aborted || revision.current !== currentRevision) return null;
        lastResolved.current = {
          snapshot: next,
          sceneId: request.sceneId,
          readingId: request.readingId,
        };
        setSnapshot(next);
        return next;
      } catch {
        if (!controller.signal.aborted && revision.current === currentRevision) {
          setError('暂时无法确认你的问题，请稍后重试。已填写的内容会保留。');
        }
        return null;
      } finally {
        if (revision.current === currentRevision) {
          pending.current = null;
          setBusy(false);
        }
      }
    },
    [cancel],
  );

  return { busy, error, snapshot, invalidate, reset, analyze };
}
