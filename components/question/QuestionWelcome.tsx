'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { MainNav } from '../layout/MainNav';
import { BlinkingEyes } from '../effects/BlinkingEyes';
import styles from './QuestionWelcome.module.css';
import transition from '../layout/PageTransition.module.css';
import type { Spread } from '@/lib/tarot/types';
import type { ReadingScene } from '@/lib/readingEntry';
import {
  countQuestionCharacters,
  QUESTION_MAX_CHARACTERS,
  QUESTION_WARNING_CHARACTERS,
} from '@/lib/questionInput';

const OPENINGS = [
  {
    title: '从一件事说起',
    text: '最近发生了……，我想弄清的是……。我已经尝试过……，目前需要顾及……',
    icon: 0,
  },
  { title: '从一个选择说起', text: '我在……和……之间犹豫，最看重的是……，目前的限制是……', icon: 2 },
  {
    title: '从一段关系说起',
    text: '我们是……关系，最近一次让我在意的互动是……。这次我想……',
    icon: 3,
  },
];
const FEELINGS = ['焦虑', '委屈', '难过', '犹豫', '烦躁', '平静', '不确定'];
type SheetKind = 'opening' | 'feelings';

function resizeQuestionInput(input: HTMLTextAreaElement) {
  if (!input.clientWidth) return;
  // Reset to the intrinsic four-row height so deleting text also shrinks the field.
  input.style.height = 'auto';
  const style = getComputedStyle(input);
  const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  input.style.height = `${Math.ceil(input.scrollHeight + borders)}px`;
}

function OrnamentIcon({ index, className = '' }: { index: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.icon} ${className}`}
      style={{ backgroundPosition: `${(index * 100) / 3}% center` }}
    />
  );
}

interface Props {
  feedback?: ReactNode;
  scene?: ReadingScene;
  selectedSpread?: Spread;
  onChangeSpread?: () => void;
  spreadWarning?: string;
  draft: string;
  onChange: (text: string) => void;
  onPick: (text: string) => void;
  onSend: () => void;
  canSend: boolean;
  unavailable: boolean;
  busy: boolean;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
  keyboardInset: number;
  mode?: 'agent' | 'manual';
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function QuestionWelcome({
  draft,
  onChange,
  onPick,
  onSend,
  canSend,
  unavailable,
  busy,
  draftRef,
  composerRef,
  keyboardInset,
  mode = 'agent',
  onKeyDown,
  selectedSpread,
  onChangeSpread,
  spreadWarning,
  scene,
  feedback,
}: Props) {
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const filledRef = useRef(false);
  const characterCount = useMemo(() => countQuestionCharacters(draft), [draft]);
  const overLimit = characterCount > QUESTION_MAX_CHARACTERS;
  const canSubmit = !!draft.trim() && canSend && !busy && !overLimit;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Only guard an existing submit shortcut; AI welcome keeps Enter as a newline.
    if (
      onKeyDown &&
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !canSubmit
    ) {
      event.preventDefault();
      return;
    }
    onKeyDown?.(event);
  };

  useLayoutEffect(() => {
    if (draftRef.current) resizeQuestionInput(draftRef.current);
  }, [draft, draftRef]);

  useEffect(() => {
    const input = draftRef.current;
    if (!input) return;
    let active = true;
    let frame = 0;
    const scheduleResize = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => resizeQuestionInput(input));
    };
    let width = -1;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => {
            if (entry && entry.contentRect.width !== width) {
              width = entry.contentRect.width;
              scheduleResize();
            }
          });
    observer?.observe(input);
    window.addEventListener('resize', scheduleResize);
    void document.fonts?.ready.then(scheduleResize);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      cancelAnimationFrame(frame);
    };
  }, [draftRef]);

  useEffect(() => {
    if (!sheet && filledRef.current) {
      filledRef.current = false;
      draftRef.current?.focus();
    }
  }, [sheet, draftRef]);

  return (
    <>
      <div ref={pageRef} className={styles.page}>
        <header className={`${styles.header} ${transition.fade}`}>
          <Link
            data-small-action="icon"
            data-small-icon="back"
            href="/"
            aria-label="返回首页"
            className={styles.back}
          >
            <span aria-hidden="true">〈</span>
          </Link>
          <Link data-small-action="text" href="/history">
            轨迹
          </Link>
        </header>
        <main id="main-content" className={styles.main}>
          {mode === 'manual' && (
            <p className={styles.eyebrow}>
              {scene ? `场景占卜 · ${scene.title}` : '自选牌阵 · 写下问题'}
            </p>
          )}
          {spreadWarning && (
            <p className={styles.eyebrow} role="status">
              {spreadWarning}{' '}
              <Link data-small-action="text" href="/spreads">
                浏览牌阵
              </Link>
            </p>
          )}
          {selectedSpread && (
            <div className={styles.spreadChoice}>
              <span>
                已选：{selectedSpread.nameCn} · {selectedSpread.positions.length} 张
              </span>
              <button data-small-action="text" type="button" onClick={onChangeSpread}>
                {scene ? '改为自选牌阵' : '更换牌阵'}
              </button>
            </div>
          )}
          <section
            aria-labelledby="question-heading"
            className={`${styles.sanctuary} ${transition.rise}`}
          >
            <div aria-hidden="true" className={styles.art} />
            <div aria-hidden="true" className={styles.stars} />
            <BlinkingEyes variant="question" />
            <div className={styles.intro}>
              <h1 id="question-heading">
                此刻，
                <br />
                想聊聊什么？
              </h1>
              <p>从你愿意分享的部分开始。</p>
            </div>
            <div className={styles.writing}>
              <label htmlFor="question-draft">写下你的问题</label>
              <textarea
                id="question-draft"
                ref={draftRef}
                value={draft}
                rows={4}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={busy}
                placeholder={
                  scene?.placeholder ??
                  '写下发生了什么，以及这次最想弄清的问题……\n也可以补充时间或资源限制、已经尝试过的做法；只想倾诉也可以。'
                }
                spellCheck={false}
                aria-invalid={overLimit || undefined}
                aria-describedby={
                  overLimit ? 'question-send-hint question-length-error' : 'question-send-hint'
                }
              />
              <div className={styles.inputFeedback}>
                <p
                  id="question-length-error"
                  aria-live="polite"
                  aria-atomic="true"
                  className={styles.lengthError}
                >
                  {overLimit ? `请精简到 ${QUESTION_MAX_CHARACTERS} 字以内` : ''}
                </p>
                {draft !== '' && (
                  <span
                    className={styles.characterCount}
                    data-warning={characterCount > QUESTION_WARNING_CHARACTERS}
                  >
                    {characterCount} / {QUESTION_MAX_CHARACTERS}
                  </span>
                )}
              </div>
            </div>
          </section>
          {feedback}
          <div className={`${styles.actions} ${transition.actions}`}>
            <button
              type="button"
              className={styles.aidRow}
              onClick={() => setSheet('opening')}
              disabled={busy}
              aria-haspopup="dialog"
            >
              <OrnamentIcon index={0} />
              <span>不知道怎么开头？</span>
              <span aria-hidden="true" className={styles.chevron}>
                ›
              </span>
            </button>
            <button
              type="button"
              className={styles.aidRow}
              onClick={() => setSheet('feelings')}
              disabled={busy}
              aria-haspopup="dialog"
            >
              <OrnamentIcon index={1} />
              <span>
                添加此刻的感受 <small>（可选）</small>
              </span>
              <span aria-hidden="true" className={styles.chevron}>
                ›
              </span>
            </button>
            <button
              type="button"
              className={styles.begin}
              onClick={() => {
                if (canSubmit) onSend();
              }}
              disabled={!canSubmit}
            >
              {mode === 'manual'
                ? selectedSpread
                  ? '使用此牌阵，开始洗牌'
                  : '下一步，选择牌阵'
                : '开始解读'}
            </button>
            <p id="question-send-hint" className={styles.hint}>
              {mode === 'manual'
                ? selectedSpread
                  ? '写下问题，再亲自洗牌与抽牌'
                  : '先写下问题，再亲自选阵与抽牌'
                : unavailable
                  ? 'AI 服务暂不可用，请稍后重试'
                  : '自动推荐牌阵并解读'}
            </p>
            <Image
              src="/brand/hero-divider.webp"
              alt=""
              width={600}
              height={48}
              className={styles.divider}
            />
          </div>
        </main>
        <div
          ref={composerRef}
          className={styles.nav}
          data-keyboard-open={keyboardInset > 0}
          style={{ bottom: keyboardInset }}
        >
          <MainNav activePath={mode === 'manual' ? '/reading' : '/agent'} />
        </div>
      </div>
      {sheet && (
        <DraftSheet
          kind={sheet}
          openings={scene?.openings ?? OPENINGS}
          pageRef={pageRef}
          keyboardInset={keyboardInset}
          onClose={() => setSheet(null)}
          onFill={(text) => {
            filledRef.current = true;
            onPick(text);
            setSheet(null);
          }}
        />
      )}
    </>
  );
}

function DraftSheet({
  kind,
  openings,
  onClose,
  onFill,
  pageRef,
  keyboardInset,
}: {
  kind: SheetKind;
  openings: readonly { title: string; text: string; icon: number }[];
  onClose: () => void;
  onFill: (text: string) => void;
  pageRef: RefObject<HTMLDivElement | null>;
  keyboardInset: number;
}) {
  const [opening, setOpening] = useState<number | null>(null);
  const [feelings, setFeelings] = useState<string[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const page = pageRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    page?.setAttribute('inert', '');
    page?.setAttribute('aria-hidden', 'true');
    // 保留显式焦点循环，以兼容不支持 inert 的旧版 WebView。
    const focusable = () => {
      const elements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, input, textarea, [tabindex="0"]',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('disabled'));
      // 原生单选组只有已选项（未选时为首项）参与 Tab 顺序。
      const radios = elements.filter(
        (element): element is HTMLInputElement =>
          element instanceof HTMLInputElement && element.type === 'radio',
      );
      const activeRadio = radios.find((element) => element.checked) ?? radios[0];
      return elements.filter(
        (element) => !radios.includes(element as HTMLInputElement) || element === activeRadio,
      );
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      page?.removeAttribute('inert');
      page?.removeAttribute('aria-hidden');
      opener?.focus({ preventScroll: true });
    };
  }, [pageRef]);

  useEffect(() => {
    if (showCustom) customRef.current?.focus();
  }, [showCustom]);

  const chosenFeelings = [
    ...FEELINGS.filter((value) => feelings.includes(value)),
    ...(showCustom && custom.trim() ? [custom.trim()] : []),
  ];
  const text =
    kind === 'opening'
      ? opening === null
        ? ''
        : openings[opening].text
      : chosenFeelings.length
        ? `我此刻的感受：${chosenFeelings.join('、')}。`
        : '';

  return createPortal(
    <div
      className={styles.overlay}
      style={{ bottom: keyboardInset }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-sheet-title"
        aria-describedby="draft-sheet-description"
        tabIndex={-1}
        className={styles.sheet}
      >
        <OrnamentIcon index={1} className={styles.sheetMoon} />
        <div className={styles.sheetScroll}>
          <div className={styles.handle} aria-hidden="true" />
          <div className={styles.sheetHeader}>
            <OrnamentIcon index={kind === 'opening' ? 0 : 1} />
            <h2 id="draft-sheet-title">{kind === 'opening' ? '帮你开个头' : '此刻的感受'}</h2>
            <button
              data-small-action="icon"
              data-small-icon="close"
              type="button"
              onClick={onClose}
              aria-label="关闭弹窗"
              className={styles.close}
            >
              ×
            </button>
          </div>
          <p id="draft-sheet-description" className={styles.sheetDescription}>
            {kind === 'opening' ? '选一句，填入后再慢慢补充。' : '可以多选，也可以先不选。'}
          </p>
          {kind === 'opening' ? (
            <fieldset className={styles.openings}>
              <legend className="sr-only">选择一个开头</legend>
              {openings.map((item, index) => (
                <label
                  key={item.title}
                  className={styles.opening}
                  data-selected={opening === index}
                >
                  <OrnamentIcon index={item.icon} />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.text}</small>
                  </span>
                  <input
                    type="radio"
                    name="opening"
                    value={index}
                    checked={opening === index}
                    onChange={() => setOpening(index)}
                  />
                </label>
              ))}
            </fieldset>
          ) : (
            <>
              <fieldset className={styles.feelings}>
                <legend className="sr-only">选择此刻的感受，可多选</legend>
                {FEELINGS.map((feeling) => (
                  <label
                    data-small-action="text"
                    key={feeling}
                    className={styles.feeling}
                    data-selected={feelings.includes(feeling)}
                  >
                    <input
                      type="checkbox"
                      checked={feelings.includes(feeling)}
                      onChange={(event) =>
                        setFeelings((values) =>
                          event.target.checked
                            ? [...values, feeling]
                            : values.filter((value) => value !== feeling),
                        )
                      }
                    />
                    <span>{feeling}</span>
                  </label>
                ))}
                <button
                  data-small-action="text"
                  type="button"
                  className={`${styles.feeling} ${styles.other}`}
                  aria-expanded={showCustom}
                  aria-controls="other-feelings"
                  onClick={() => setShowCustom((value) => !value)}
                >
                  <span aria-hidden="true">{showCustom ? '−' : '+'}</span>其他感受
                </button>
              </fieldset>
              {showCustom && (
                <div id="other-feelings" className={styles.custom}>
                  <label htmlFor="custom-feelings">用自己的话说说</label>
                  <textarea
                    id="custom-feelings"
                    ref={customRef}
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    placeholder="比如：有点期待，但又担心失望"
                    rows={2}
                  />
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className={styles.goldButton}
            disabled={!text}
            onClick={() => onFill(text)}
          >
            填入输入框
          </button>
          <p className={styles.hint}>只填入草稿，不会直接发送</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
