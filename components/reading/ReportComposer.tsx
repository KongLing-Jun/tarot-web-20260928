'use client';

import { useEffect, useState, type ReactNode, type RefObject, type KeyboardEvent } from 'react';
import { MainNav } from '../layout/MainNav';
import styles from './ReadingReport.module.css';

interface Props {
  feedback?: ReactNode;
  draft: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
  canSend: boolean;
  running: boolean;
  ready: boolean;
  unavailable: boolean;
  keyboardInset: number;
  showLatest: boolean;
  onLatest: () => void;
  activePath?: string;
  inputLabel?: string;
  placeholder?: string;
}

export function ReportComposer({
  draft,
  onChange,
  onSend,
  onKeyDown,
  onCancel,
  draftRef,
  composerRef,
  canSend,
  running,
  ready,
  unavailable,
  keyboardInset,
  showLatest,
  onLatest,
  activePath = '/agent',
  inputLabel = '探索问题或追问',
  placeholder,
  feedback,
}: Props) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const input = draftRef.current;
    if (input) {
      input.style.height = '44px';
      // 空草稿保持单行，避免窄屏占位文字换行后把等待输入栏撑高。
      if (draft) input.style.height = `${Math.min(104, Math.max(44, input.scrollHeight))}px`;
    }
  }, [draft, draftRef]);
  return (
    <div
      ref={composerRef}
      className={styles.composer}
      data-keyboard-open={keyboardInset > 0}
      style={{ bottom: keyboardInset }}
    >
      {showLatest && (
        <button data-small-action="text" className={styles.latest} onClick={onLatest}>
          ↓ 回到最新
        </button>
      )}
      {feedback}
      {unavailable && <p className={styles.serviceNote}>AI 服务暂不可用，请稍后重试</p>}
      <div className={styles.composeRow}>
        <div className={styles.inputBox}>
          <svg className={styles.quill} viewBox="0 0 32 40" fill="none" aria-hidden="true">
            <path
              d="M5 34C7 20 15 7 28 5C27 20 17 29 9 29L5 34Z"
              fill="currentColor"
              fillOpacity=".7"
            />
            <path
              d="M3 38L24 9M10 28L18 25M14 22L21 19M17 16L18 10"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
          <textarea
            aria-label={inputLabel}
            ref={draftRef}
            value={draft}
            rows={1}
            spellCheck={false}
            placeholder={placeholder ?? (canSend ? '继续追问这件事…' : '解读完成后可追问…')}
            disabled={running || !ready}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {running ? (
            <button
              data-small-action="text"
              type="button"
              className={styles.stop}
              onClick={onCancel}
              aria-label="停 止"
            >
              <span aria-hidden="true" />
              停止
            </button>
          ) : (
            (focused || draft.trim() || !ready) && (
              <button
                data-small-action="icon"
                type="button"
                aria-label="发送"
                onClick={onSend}
                disabled={!draft.trim() || !canSend}
              >
                ↑
              </button>
            )
          )}
        </div>
      </div>
      <div className={styles.nav}>
        <MainNav activePath={activePath} />
      </div>
    </div>
  );
}
