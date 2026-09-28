import { parseReadingContent } from '@/lib/interpretation';
import { hasValidAnswer } from '@/lib/api/generation-result';
import { allCards } from '@/lib/tarot/cards';
import type { DrawnCard } from '@/lib/tarot/types';

export interface InterpretationQualityContext {
  mode: 'initial' | 'follow-up' | 'supplementary' | 'daily';
  drawnCards: DrawnCard[];
  additionalCards?: DrawnCard[];
  historyCards?: DrawnCard[];
}

export interface InterpretationQualityIssue {
  code:
    | 'empty-answer'
    | 'structure'
    | 'missing-card'
    | 'unknown-card'
    | 'orientation-mismatch'
    | 'position-mismatch';
  severity: 'warning' | 'error';
  message: string;
}

export interface InterpretationQualityResult {
  issues: InterpretationQualityIssue[];
  needsRetry: boolean;
}

/**
 * 确定性检查只覆盖输出结构和明确的牌面声明；不判断建议质量、现实事实或他人心理。
 * 未识别的排版只警告。牌面冲突也保留原文，由用户选择重新生成，绝不修改实际抽牌。
 */
export function validateInterpretationQuality(
  content: string,
  context: InterpretationQualityContext,
): InterpretationQualityResult {
  const { answer, sections } = parseReadingContent(content);
  const issues: InterpretationQualityIssue[] = [];
  const add = (
    code: InterpretationQualityIssue['code'],
    severity: InterpretationQualityIssue['severity'],
    message: string,
  ) => {
    if (!issues.some((issue) => issue.code === code && issue.message === message))
      issues.push({ code, severity, message });
  };
  if (!hasValidAnswer(content)) add('empty-answer', 'error', '尚未收到有效解读正文，请重新生成。');

  const requiresCards = context.mode === 'initial' || context.mode === 'supplementary';
  const isDirectAnswer =
    context.mode === 'follow-up' && !sections && !/^ {0,3}##[ \t]+/m.test(answer);
  if (
    context.mode !== 'daily' &&
    !isDirectAnswer &&
    (!sections?.core.trim() || (requiresCards && !sections.cards?.trim()))
  ) {
    add('structure', 'warning', '解读章节不完整，已保留原文供查看。');
  }

  const available = [
    ...context.drawnCards,
    ...(context.historyCards ?? []),
    ...(context.additionalCards ?? []),
  ];
  const required =
    context.mode === 'initial'
      ? context.drawnCards
      : context.mode === 'supplementary'
        ? (context.additionalCards ?? [])
        : [];
  const seen = new Set<DrawnCard>();
  const headings = [
    ...(sections?.cards ?? (context.mode === 'daily' ? '' : answer)).matchAll(
      /^ {0,3}###[ \t]+(.+)$/gm,
    ),
  ].map((match) => match[1].replace(/\*\*/g, ''));
  // 每日无强制标题协议，只检查明确的「牌名（正/逆位）」声明。
  if (context.mode === 'daily') {
    for (const card of allCards) {
      for (const match of answer.matchAll(new RegExp(`${card.nameCn}[（(](正位|逆位)[）)]`, 'g')))
        headings.push(match[0]);
    }
  }
  for (const heading of headings) {
    const mentioned = allCards.filter((card) => heading.includes(card.nameCn));
    if (mentioned.length !== 1) continue; // 模糊/比较式标题不足以证明牌面冲突。
    const card = mentioned[0];
    const matches = available.filter((drawn) => drawn.card.id === card.id);
    if (!matches.length) {
      add('unknown-card', 'error', `专业说明出现未抽到的「${card.nameCn}」，请保留原牌重新生成。`);
      continue;
    }
    const namedPositions = available.filter((drawn) => heading.includes(drawn.position.nameCn));
    const atPosition = matches.filter((drawn) => heading.includes(drawn.position.nameCn));
    if (namedPositions.length && !atPosition.length)
      add(
        'position-mismatch',
        'error',
        `「${card.nameCn}」的牌位与抽牌记录不一致，请保留原牌重新生成。`,
      );
    const candidates = atPosition.length ? atPosition : matches;
    const orientations = heading.match(/正位|逆位/g) ?? [];
    if (context.mode !== 'daily' && (!atPosition.length || orientations.length !== 1)) {
      add('structure', 'warning', '部分牌位标题未写清牌位或正逆位，已保留原文供核对。');
    }
    if (
      orientations.length === 1 &&
      !candidates.some((drawn) => drawn.isReversed === (orientations[0] === '逆位'))
    ) {
      add(
        'orientation-mismatch',
        'error',
        `「${card.nameCn}」的正逆位与抽牌记录不一致，请保留原牌重新生成。`,
      );
    }
    for (const drawn of candidates) seen.add(drawn);
  }
  if (required.some((drawn) => !seen.has(drawn)))
    add('missing-card', 'warning', '部分牌位说明未能识别，请结合实际牌面核对原文。');
  return { issues, needsRetry: issues.some((issue) => issue.severity === 'error') };
}
