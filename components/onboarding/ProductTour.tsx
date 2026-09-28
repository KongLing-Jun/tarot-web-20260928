'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import 'driver.js/dist/driver.css';
import styles from './ProductTour.module.css';
import { useUser } from '@/components/session/UserSession';
import { apiFetch } from '@/lib/api/client';
import { isProductTourState, type ProductTourState } from '@/lib/product-tour';

const pageHidden = () => document.visibilityState === 'hidden';

async function readTourState(controller: AbortController): Promise<ProductTourState | null> {
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const value = await apiFetch('/api/product-tour', { signal: controller.signal });
    return isProductTourState(value) ? value : null;
  } catch {
    // Unknown is not unseen. Manual viewing can still work without persistence.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Home-only eligibility check; the engine loads only for an accepted launch. */
export function ProductTour() {
  const { user, loading, error: sessionError } = useUser();
  const launcher = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const launchLookup = useRef<AbortController | null>(null);
  const autoLookup = useRef<AbortController | null>(null);
  const launchKind = useRef<'auto' | 'manual' | null>(null);
  const manualRequested = useRef(false);
  const autoShown = useRef(new Set<string>());
  const account = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const cancel = useCallback(() => {
    generation.current++;
    launchLookup.current?.abort();
    autoLookup.current?.abort();
    pending.current = false;
    const dispose = stop.current;
    stop.current = null;
    dispose?.();
    if (mounted.current) setBusy(false);
  }, []);

  const start = useCallback(
    async (knownState?: ProductTourState, automatic = false) => {
      if (!automatic) {
        manualRequested.current = true;
        // Manual intent supersedes an automatic launch still waiting for assets.
        if (pending.current && launchKind.current === 'auto') cancel();
      }
      if (pending.current || stop.current || pageHidden()) return;
      pending.current = true;
      launchKind.current = automatic ? 'auto' : 'manual';
      const request = ++generation.current;
      setBusy(true);
      setMessage('');
      try {
        const controller = new AbortController();
        launchLookup.current = controller;
        const state = knownState ?? (await readTourState(controller));
        if (!mounted.current || request !== generation.current) return;
        launchLookup.current = null;
        if (state) account.current = state.accountScope;
        const { runProductTour, waitForTourTargets } = await import('./runProductTour');
        await waitForTourTargets();
        if (!mounted.current || request !== generation.current || pageHidden()) return;
        pending.current = false;
        const previousFocus = document.activeElement;
        stop.current = runProductTour({
          launcher: launcher.current!,
          ...(automatic
            ? {
                restoreFocus:
                  previousFocus instanceof HTMLElement && previousFocus !== document.body
                    ? previousFocus
                    : null,
              }
            : {}),
          onEnd: ({ reason, error }) => {
            stop.current = null;
            if (mounted.current && request === generation.current) {
              setBusy(false);
              setMessage(error || '随时可以从这里，或「我的」重新查看指引。');
            }
            if (reason === 'interrupted') return;
            const saveFailed = () => {
              if (mounted.current && request === generation.current)
                setMessage('未能保存引导状态，下次可能再次展示。你仍可随时手动查看指引。');
            };
            if (!state) {
              saveFailed();
              return;
            }
            autoShown.current.add(state.accountScope);
            // This terminal write survives cleanup; its captured scope prevents account mixing.
            void apiFetch('/api/product-tour', {
              method: 'PUT',
              keepalive: true,
              body: JSON.stringify({ ...state, status: reason }),
            })
              .then((saved) => {
                if (
                  !isProductTourState(saved) ||
                  saved.accountScope !== state.accountScope ||
                  saved.status === null
                )
                  saveFailed();
              })
              .catch(saveFailed);
          },
        });
        if (state) autoShown.current.add(state.accountScope);
        if (!state) setMessage('暂时无法读取引导记录，本次查看结果可能无法保存。');
      } catch {
        if (mounted.current && request === generation.current) {
          pending.current = false;
          setBusy(false);
          setMessage('指引暂时没有准备好，请稍后重试。');
        }
      }
    },
    [cancel],
  );

  useEffect(() => {
    mounted.current = true;
    // Defer the one-shot request to the next frame so Strict Mode's rehearsal
    // cannot consume it and then cancel the only pending startup.
    const frame = requestAnimationFrame(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tour') !== 'welcome') return;
      url.searchParams.delete('tour');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
      void start();
    });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
  }, [cancel, start]);

  useEffect(() => {
    if (loading || sessionError) return;
    if (!user) {
      if (account.current) {
        cancel();
        account.current = null;
        manualRequested.current = false;
      }
      return;
    }
    // Explicit replay is handled by the one-shot frame above, even when already acknowledged.
    if (new URL(window.location.href).searchParams.get('tour') === 'welcome') return;
    const controller = new AbortController();
    autoLookup.current = controller;
    let active = true;
    const request = generation.current;
    void readTourState(controller).then((state) => {
      if (
        !active ||
        !state ||
        !mounted.current ||
        request !== generation.current ||
        document.visibilityState === 'hidden'
      )
        return;
      if (account.current && account.current !== state.accountScope) {
        cancel();
        manualRequested.current = false;
      }
      account.current = state.accountScope;
      if (
        state.status === null &&
        !manualRequested.current &&
        !autoShown.current.has(state.accountScope) &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        void start(state, true);
    });
    return () => {
      active = false;
      controller.abort();
      if (pending.current && launchKind.current === 'auto') cancel();
    };
  }, [user, loading, sessionError, cancel, start]);

  return (
    <div className={styles.launcher}>
      <button
        ref={launcher}
        type="button"
        className={styles.launchButton}
        aria-disabled={busy}
        onClick={() => void start()}
      >
        {busy ? '指引进行中' : '初次相遇 · 新手指引'}
      </button>
      <p className={styles.status} role="status">
        {message}
      </p>
    </div>
  );
}
