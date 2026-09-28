'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUser } from '../session/UserSession';
import type { CurrentUser } from '@/lib/auth/types';
import { isValidNickname } from '@/lib/auth/profile';
import styles from './ProfileEditor.module.css';

export function ProfileEditor({
  user,
  loading,
  density = 'comfortable',
}: {
  user: CurrentUser;
  loading: boolean;
  /** Compact profile composition; feedback expands below the stable control slot. */
  density?: 'comfortable' | 'compact';
}) {
  const { updateProfile } = useUser();
  const [phase, setPhase] = useState<'display' | 'editing' | 'saving'>('display');
  const phaseRef = useRef(phase);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [notice, setNotice] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const original = useRef('');
  const composing = useRef(false);
  const unconfirmedComposition = useRef(false);
  const returnFocus = useRef(false);
  const mounted = useRef(false);
  const editing = phase !== 'display';
  const nickname = user.nickname || '星旅人';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  function transition(next: typeof phase) {
    // Blur can follow Enter or Escape before React replaces the input.
    phaseRef.current = next;
    setPhase(next);
  }

  function open() {
    if (loading || phaseRef.current !== 'display') return;
    original.current = user.nickname;
    setDraft(user.nickname);
    setError('');
    setInvalid(false);
    setNotice('');
    composing.current = false;
    unconfirmedComposition.current = false;
    returnFocus.current = false;
    transition('editing');
  }

  function close(restore: boolean) {
    returnFocus.current = restore && document.activeElement === input.current;
    transition('display');
    setError('');
    setInvalid(false);
  }

  async function commit(value: string, keyboard: boolean) {
    if (phaseRef.current !== 'editing' || composing.current) return;
    const candidate = value.trim();
    if (!candidate) {
      close(keyboard);
      return;
    }
    if (!isValidNickname(value)) {
      setInvalid(true);
      setError(Array.from(candidate).length > 40 ? '昵称最多 40 个字符' : '请去掉换行或控制字符');
      return;
    }
    if (candidate === original.current) {
      close(keyboard);
      return;
    }
    returnFocus.current = keyboard;
    transition('saving');
    setError('');
    setInvalid(false);
    try {
      await updateProfile({ nickname: candidate });
      if (!mounted.current) return;
      setNotice('昵称已保存');
      close(returnFocus.current);
    } catch (error) {
      if (!mounted.current) return;
      transition('editing');
      returnFocus.current = false;
      setError(error instanceof Error ? error.message : '保存失败，请重试');
    }
  }

  return (
    <div className={`${styles.editor} ${density === 'compact' ? styles.compact : ''}`}>
      <h2 className={`text-2xl md:text-3xl text-bone ${styles.controlSlot}`}>
        {editing ? (
          <input
            ref={input}
            aria-label="昵称"
            value={draft}
            readOnly={phase === 'saving'}
            aria-invalid={invalid || undefined}
            aria-describedby={error ? 'nickname-error' : undefined}
            aria-busy={phase === 'saving'}
            autoComplete="nickname"
            enterKeyHint="done"
            className={styles.input}
            onChange={(event) => {
              setDraft(event.target.value);
              setError('');
              setInvalid(false);
              if (!composing.current && !(event.nativeEvent as InputEvent).isComposing)
                unconfirmedComposition.current = false;
            }}
            onCompositionStart={() => {
              composing.current = true;
              unconfirmedComposition.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              setDraft(event.currentTarget.value);
            }}
            onBlur={(event) => {
              returnFocus.current = false;
              // Never infer that an IME draft is finalized from a blur alone.
              if (composing.current || unconfirmedComposition.current) {
                unconfirmedComposition.current = false;
                return;
              }
              void commit(event.currentTarget.value, false);
            }}
            onKeyDown={(event) => {
              if (
                composing.current ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return;
              if (event.key === 'Enter') {
                event.preventDefault();
                void commit(event.currentTarget.value, true);
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                if (phaseRef.current === 'editing') close(true);
              }
            }}
          />
        ) : (
          <button
            ref={button}
            type="button"
            onClick={open}
            aria-label={`${nickname}，${density === 'compact' ? '修改昵称' : '重命名'}`}
            aria-disabled={loading}
            className={styles.button}
          >
            <span className={styles.buttonText}>{nickname}</span>
            {density === 'compact' && (
              <span className={styles.editHint} data-small-affordance="quiet">
                修改昵称
              </span>
            )}
          </button>
        )}
      </h2>
      {!loading && (
        <span className={styles.loginBadge}>{user?.isGuest ? '游客已登录' : '微信已登录'}</span>
      )}
      <div className={styles.feedback}>
        {error && (
          <span id="nickname-error" role="alert" className={styles.error}>
            {error}
          </span>
        )}
      </div>
      {(phase === 'saving' || notice) && (
        <span role="status" className="sr-only">
          {phase === 'saving' ? '正在保存昵称…' : notice}
        </span>
      )}
    </div>
  );
}
