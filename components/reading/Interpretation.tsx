'use client';

import { Fragment, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { RetryState } from '@/lib/api/stream-client';
import { parseReadingContent } from '@/lib/interpretation';
import styles from './Interpretation.module.css';

interface InterpretationProps {
  content: string;
  isLoading: boolean;
  error: string | null;
  /**
   * 非致命警示（如输出被截断）。
   * 与 error 不同：正文照常显示，仅在底部附加提示条。
   */
  notice?: string | null;
  /**
   * 是否在首次加载时应用逐段揭幕动画。
   * 历史详情页：true。
   * 实时解读（已经有流式动画）：false。
   */
  staggerOnMount?: boolean;
  /**
   * 需要高亮为金色描边小标签的牌名。
   * 传入后，文中出现的 nameCn / name 会被识别并装饰。
   */
  cardTerms?: string[];
  /**
   * 需要高亮为月雾色阵位标签的阵位名。
   */
  positionTerms?: string[];
  /**
   * 自动重试的瞬时状态。非空时在加载态显示「正在重试 N/M」。
   */
  retry?: RetryState | null;
  loadingLabel?: string;
  onDetailInteraction?: () => void;
}

/**
 * Markdown 渲染映射 —
 * 标题用 Cinzel · 正文用 Cormorant Garamond ·
 * 强调用金叶色 · 引用用金线左缀
 */
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="font-heading text-2xl text-bone mt-12 mb-6 first:mt-0 tracking-[0.18em] pb-4 hairline-bottom">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-heading text-xl text-bone mt-10 mb-5 first:mt-0 tracking-[0.16em]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-heading text-lg text-bone mt-8 mb-4 first:mt-0 tracking-[0.14em]">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="font-heading text-base text-bone mt-6 mb-3 first:mt-0 tracking-[0.12em]">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="font-body text-bone-dim text-lg leading-[1.95] mb-6 last:mb-0 font-light">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="font-body list-none text-bone-dim text-lg leading-[1.95] my-6 space-y-3 pl-0 font-light">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="font-body list-decimal list-inside text-bone-dim text-lg leading-[1.95] my-6 space-y-3 pl-2 font-light">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-bone-dim leading-[1.95] pl-6 relative before:content-['◇'] before:absolute before:left-0 before:text-gold-dim before:text-sm before:top-2">
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="text-gold font-medium tracking-wide">{children}</strong>
  ),
  em: ({ children }) => <em className="font-body italic text-bone">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="font-body border-l border-[var(--gold-dim)] pl-6 my-8 italic-soft text-bone-faint text-lg leading-[1.95]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-0 rule-h-fade" />,
};

/* ─── 关键词装饰 · 在 markdown 渲染前用 HTML span 包裹 ───
   ReactMarkdown 默认不走原生 HTML，这里用零宽零室 placeholder 还原，
   以避免依赖 rehype-raw 这样的额外 deps。
   策略：在 Markdown AST 处理之后、渲染为 React 节点之前，用一个 text 重写器。
   由于我们控制了 paragraph / heading / li 等几个容器，在它们内部运行拆分。 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTermRegex(terms: string[]): RegExp | null {
  const cleaned = terms.filter((t) => t && t.trim().length > 1);
  if (cleaned.length === 0) return null;
  // 按长度降序，避免“圣杯骑士”被 “圣杯” 先吃掉
  const sorted = [...cleaned].sort((a, b) => b.length - a.length);
  return new RegExp(sorted.map(escapeRegExp).join('|'), 'g');
}

function renderWithGlyphs(
  text: string,
  cardRe: RegExp | null,
  positionRe: RegExp | null,
): ReactNode {
  if (!cardRe && !positionRe) return text;

  // 先按牌名拆，再在未装饰片段按阵位名拆
  const parts: Array<{ text: string; kind: 'plain' | 'card' | 'position' }> = [
    { text, kind: 'plain' },
  ];

  const splitBy = (re: RegExp, kind: 'card' | 'position'): void => {
    for (let i = parts.length - 1; i >= 0; i--) {
      const seg = parts[i];
      if (seg.kind !== 'plain') continue;
      const matches = [...seg.text.matchAll(re)];
      if (matches.length === 0) continue;

      const replacement: typeof parts = [];
      let cursor = 0;
      for (const m of matches) {
        const idx = m.index ?? 0;
        if (idx > cursor) {
          replacement.push({ text: seg.text.slice(cursor, idx), kind: 'plain' });
        }
        replacement.push({ text: m[0], kind });
        cursor = idx + m[0].length;
      }
      if (cursor < seg.text.length) {
        replacement.push({ text: seg.text.slice(cursor), kind: 'plain' });
      }
      parts.splice(i, 1, ...replacement);
    }
  };

  if (cardRe) splitBy(cardRe, 'card');
  if (positionRe) splitBy(positionRe, 'position');

  return parts.map((seg, i) => {
    if (seg.kind === 'card')
      return (
        <span key={i} className="glyph-card">
          {seg.text}
        </span>
      );
    if (seg.kind === 'position')
      return (
        <span key={i} className="glyph-position">
          {seg.text}
        </span>
      );
    return seg.text;
  });
}

/** 递归遍历 ReactMarkdown 的 children，仅处理字符串叶节点 */
function decorateChildren(
  children: ReactNode,
  cardRe: RegExp | null,
  positionRe: RegExp | null,
): ReactNode {
  if (!cardRe && !positionRe) return children;
  if (typeof children === 'string') {
    return renderWithGlyphs(children, cardRe, positionRe);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        return <Fragment key={i}>{renderWithGlyphs(child, cardRe, positionRe)}</Fragment>;
      }
      return child;
    });
  }
  return children;
}

export function Interpretation({
  content,
  isLoading,
  error,
  notice,
  staggerOnMount = false,
  cardTerms,
  positionTerms,
  retry,
  loadingLabel = '正在生成解读',
  onDetailInteraction,
}: InterpretationProps) {
  /* ─── 错误态 ─── */
  if (error && !content) {
    return (
      <div className="w-full max-w-4xl p-5 md:p-12 ink-panel-quiet anim-veil-rise">
        <div className="flex items-center gap-4 mb-5">
          <span className="text-gold-dim text-lg">◇</span>
          <h3 className="font-heading text-xl text-bone tracking-[0.18em]">解读暂未完成</h3>
        </div>
        <div className="rule-h-gold w-20 mb-6" />
        <p className="font-body text-bone-dim text-base leading-relaxed mb-4 italic-soft">
          {error}
        </p>
        <p className="cn-label text-bone-dim">可以使用下方按钮重试。</p>
      </div>
    );
  }

  // 流式过程中追加金色光标
  const isStreamingActive = isLoading && content.length > 0;

  // 仅在历史重现时启用逐段揭幕；实时解读依赖 LLM 流式自然逐词显现
  const useStaggerReveal = staggerOnMount && !isLoading && content.length > 0;

  return (
    <div className={`w-full max-w-4xl ${styles.result}`}>
      {/* ─── 内容容器 ─── */}
      <div
        className={`relative ink-panel-quiet transition-all duration-1000 ${
          isLoading && !content ? 'min-h-[320px]' : 'min-h-[120px]'
        }`}
        style={{ transitionTimingFunction: 'var(--ease-veil)' }}
      >
        {isLoading && content && (
          <p role="status" className="px-5 pt-4 text-sm text-gold-dim">
            {loadingLabel}
          </p>
        )}
        <div className="p-5 md:p-12 relative">
          {content ? (
            <>
              <InterpretationBody
                content={content}
                streaming={isStreamingActive}
                stagger={useStaggerReveal}
                cardTerms={cardTerms}
                positionTerms={positionTerms}
                showSigil={!isLoading && !error && !notice}
                onDetailInteraction={onDetailInteraction}
              />
              {error && (
                <p
                  role="alert"
                  className="mt-6 border-l border-[var(--gold-dim)] pl-4 text-bone-dim"
                >
                  {error}。已保留生成的内容，可以重新解读。
                </p>
              )}
              {/* 非致命警示 · 正文之下的安静提示条 */}
              {notice && !isLoading && (
                <div className="mt-10 px-5 py-4 border-l border-[var(--gold-dim)] anim-fade-in">
                  <p className="font-body italic-soft text-bone-faint text-sm leading-relaxed">
                    <span className="text-gold-dim mr-2">◇</span>
                    {notice}
                  </p>
                </div>
              )}
            </>
          ) : isLoading ? (
            // ─── 加载态 · 通灵中 ───
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-7">
              <div className="relative">
                <span className="text-gold text-4xl anim-whisper">✦</span>
                <span className="absolute inset-0 anim-glow-pulse rounded-full" aria-hidden />
              </div>
              <p className="cn-label text-bone-dim">{retry ? '正在重新连接' : loadingLabel}</p>
              <div className="flex gap-2.5">
                <span
                  className="w-1 h-1 bg-[var(--gold-dim)] rounded-full anim-whisper"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1 h-1 bg-[var(--gold-dim)] rounded-full anim-whisper"
                  style={{ animationDelay: '400ms' }}
                />
                <span
                  className="w-1 h-1 bg-[var(--gold-dim)] rounded-full anim-whisper"
                  style={{ animationDelay: '800ms' }}
                />
              </div>
              <p className="font-body italic-soft text-bone-faint text-sm mt-2">
                {retry
                  ? `连接中断，正在重试（第 ${retry.attempt} / ${retry.max} 次）`
                  : '请稍候，结果将逐步显示'}
              </p>
            </div>
          ) : notice ? (
            <p role="status" className="font-body text-bone-dim leading-relaxed">
              {notice}
            </p>
          ) : (
            // ─── 空态 ───
            <div className="flex flex-col items-center justify-center py-14 gap-5">
              <span className="text-bone-whisper text-2xl">◇</span>
              <p className="cn-label text-bone-faint">等 待 牌 面</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 无外框的 markdown 解读正文：解析 thinking 段并渲染。
 * 供主解读区与 FollowUpPanel 共用。
 */
interface InterpretationBodyProps {
  content: string;
  streaming?: boolean;
  stagger?: boolean;
  cardTerms?: string[];
  positionTerms?: string[];
  /**
   * 是否在正文后面盖一个金色封印。
   * 仅在解读完成（非流式中）且有正文时应该为 true。
   */
  showSigil?: boolean;
  onDetailInteraction?: () => void;
}

export function InterpretationBody({
  content,
  streaming = false,
  stagger = false,
  cardTerms,
  positionTerms,
  showSigil = false,
  onDetailInteraction,
}: InterpretationBodyProps) {
  const { thinking, answer, sections } = parseReadingContent(content, streaming);
  const showWaitingHint = streaming && !answer;
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [wasStreaming, setWasStreaming] = useState(streaming);
  // 同一个回复重新生成时重置；流式追加和完成不改变用户的选择。
  if (wasStreaming !== streaming) {
    setWasStreaming(streaming);
    if (streaming) {
      setThinkingOpen(false);
      setCardsOpen(false);
    }
  }

  // 关键词正则 · useMemo 避免每个 paragraph 重建
  const cardRe = useMemo(() => buildTermRegex(cardTerms ?? []), [cardTerms]);
  const positionRe = useMemo(() => buildTermRegex(positionTerms ?? []), [positionTerms]);

  const components: Components = useMemo(() => {
    if (!cardRe && !positionRe) return MARKDOWN_COMPONENTS;
    // 包装 paragraph / heading / li / strong / em 使其子元素被装饰
    const wrap = <T extends keyof typeof MARKDOWN_COMPONENTS>(
      key: T,
    ): (typeof MARKDOWN_COMPONENTS)[T] => {
      const original = MARKDOWN_COMPONENTS[key];
      if (!original) return original;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((props: any) => {
        const decorated = decorateChildren(props.children, cardRe, positionRe);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (original as any)({ ...props, children: decorated });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    };
    return {
      ...MARKDOWN_COMPONENTS,
      p: wrap('p'),
      h1: wrap('h1'),
      h2: wrap('h2'),
      h3: wrap('h3'),
      h4: wrap('h4'),
      li: wrap('li'),
      em: wrap('em'),
      strong: wrap('strong'),
      blockquote: wrap('blockquote'),
    };
  }, [cardRe, positionRe]);

  // 流式中的正文：超过一定长度时跳过关键词装饰，降低每帧开销
  const answerComponents = streaming && answer.length > 4_000 ? MARKDOWN_COMPONENTS : components;

  return (
    <div
      className={`interpretation-content ${styles.body} ${sections ? styles.structured : ''} ${
        stagger ? 'interpretation-reveal' : streaming ? 'interpretation-streaming' : ''
      }`}
    >
      {/* 思考已经在动但正文还未出现 · 给一个轻量等候提示 */}
      {showWaitingHint && (
        <div className="flex items-center gap-4 py-3">
          <span className="text-gold-dim anim-whisper">✦</span>
          <span className="cn-hint text-bone-faint">正在整理与你的问题有关的解读</span>
        </div>
      )}

      {sections ? (
        <>
          {sections.core.trim() && (
            <ReactMarkdown
              components={answerComponents}
            >{`## 事情怎么看\n${sections.core}`}</ReactMarkdown>
          )}
          {sections.actions?.trim() && (
            <ReactMarkdown
              components={answerComponents}
            >{`## 可以怎么做\n${sections.actions}`}</ReactMarkdown>
          )}
          {sections.cards?.trim() && (
            <ReadingDisclosure
              title="牌义依据"
              open={cardsOpen}
              onChange={setCardsOpen}
              onDetailInteraction={onDetailInteraction}
              status={streaming ? '解析正在补充' : undefined}
            >
              <ReactMarkdown components={answerComponents}>{sections.cards}</ReactMarkdown>
            </ReadingDisclosure>
          )}
        </>
      ) : answer ? (
        <ReactMarkdown components={answerComponents}>{answer}</ReactMarkdown>
      ) : null}

      {streaming && answer && (!sections?.cards || cardsOpen) && (
        <span className="streaming-cursor" aria-hidden />
      )}

      {/* 仪式封印 · 解读完成后盖在正文底部 */}
      {showSigil && answer && !streaming && <SigilSeal />}

      {streaming && thinking && (
        <ReadingDisclosure
          title="模型思考"
          open={thinkingOpen}
          onChange={setThinkingOpen}
          onDetailInteraction={onDetailInteraction}
          status={!answer ? '正在思考' : undefined}
          secondary
        >
          <pre className="font-body text-bone-dim text-base leading-[1.9] whitespace-pre-wrap break-words font-light m-0">
            {thinking}
          </pre>
        </ReadingDisclosure>
      )}
    </div>
  );
}

function ReadingDisclosure({
  title,
  open,
  onChange,
  onDetailInteraction,
  status,
  secondary,
  children,
}: {
  title: string;
  open: boolean;
  onChange: (open: boolean) => void;
  onDetailInteraction?: () => void;
  status?: string;
  secondary?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={`${styles.disclosure} ${secondary ? styles.secondary : ''}`} open={open}>
      <summary
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          if (!open) onDetailInteraction?.();
          onChange(!open);
        }}
      >
        <span>
          <span className={styles.disclosureTitle}>{title}</span>
          {status && (
            <span role="status" className={styles.disclosureStatus}>
              {status}
            </span>
          )}
        </span>
        <span className={styles.toggleLabel}>
          {open ? '收起' : '展开'} <span aria-hidden>{open ? '⌃' : '⌄'}</span>
        </span>
      </summary>
      {open && <div className={styles.detailContent}>{children}</div>}
    </details>
  );
}

/** 金色仪式封印 · 解读完成的“盖印”动作 */
function SigilSeal(): ReactElement {
  // 上下左右四道小到许 · 表示四象限定
  const ticks = [0, 90, 180, 270];
  return (
    <div className="sigil-seal" aria-hidden>
      {ticks.map((deg) => (
        <span
          key={deg}
          className="sigil-ring-tick"
          style={{ transform: `rotate(${deg}deg) translateX(28px)` }}
        />
      ))}
      <span className="sigil-glyph">✦</span>
    </div>
  );
}
