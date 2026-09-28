import { describe, expect, it } from 'vitest';
import { validateInterpretationQuality } from '@/lib/interpretation-quality';
import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { DrawnCard } from '@/lib/tarot/types';
import { presentGeneration } from '@/lib/api/generation-presentation';

const spread = getSpreadById('three-card')!;
const cards: DrawnCard[] = spread.positions.map((position, i) => ({
  position,
  card: allCards[i],
  isReversed: false,
}));
const body = (heading: string) =>
  `## 核心解读\n先观察事实。\n## 可采取的行动\n可以先确认一个问题。\n## 各牌说明\n${heading}\n牌面只是一个理解角度。`;
describe('输出质量检查的模式与边界', () => {
  it('首轮完整牌义允许省略行动章节', () => {
    const content = `## 核心解读\n先看与你的问题相关的事实。\n## 各牌说明\n${cards.map((card) => `### ${card.position.nameCn} ${card.card.nameCn}（正位）\n这是一个理解角度。`).join('\n')}`;
    expect(
      validateInterpretationQuality(content, { mode: 'initial', drawnCards: cards }).issues,
    ).toEqual([]);
  });
  it.each(['## 核心解读\n这次按你明确不想复合的目标继续。', '这次按你明确不想复合的目标继续。'])(
    '直接追问允许简短回应：%s',
    (content) => {
      expect(
        validateInterpretationQuality(content, { mode: 'follow-up', drawnCards: cards }).issues,
      ).toEqual([]);
    },
  );
  it('补牌允许省略行动，但仍检查本轮全部补牌', () => {
    const content =
      '## 核心解读\n承接这次的问题。\n## 各牌说明\n### 过去 愚者（正位）\n这是补充的理解角度。';
    expect(
      validateInterpretationQuality(content, {
        mode: 'supplementary',
        drawnCards: [],
        additionalCards: [cards[0]],
      }).issues,
    ).toEqual([]);
    expect(
      validateInterpretationQuality('## 核心解读\n承接这次的问题。', {
        mode: 'supplementary',
        drawnCards: [],
        additionalCards: [cards[0]],
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'structure' }),
        expect.objectContaining({ code: 'missing-card' }),
      ]),
    );
  });
  it.each([
    '## 核心解读\n\n## 可采取的行动\n行动',
    '## 核心解读\n事情\n## 未知章节\n内容',
    '## 核心解读\n事情\n## 核心解读\n重复',
    '## 各牌说明\n牌义\n## 核心解读\n事情',
  ])('追问异常章节仍保留结构警告：%s', (content) => {
    expect(
      validateInterpretationQuality(content, { mode: 'follow-up', drawnCards: cards }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'structure' }));
  });
  it.each(['cancelled', 'truncated', 'interrupted', 'running', 'no-valid-answer'] as const)(
    '合法简答不覆盖生成状态：%s',
    (generationStatus) => {
      const content = '你已经澄清不想复合，本轮就以这个目标为准。';
      const quality = validateInterpretationQuality(content, {
        mode: 'follow-up',
        drawnCards: cards,
      });
      expect(presentGeneration({ generationStatus, quality }, content)).toMatchObject({
        generationStatus,
        status: 'error',
      });
    },
  );
  it.each(['……！？', '✨🌙', '---\n***'])('只有符号时与流结果判定一致：%s', (text) => {
    expect(
      validateInterpretationQuality(text, { mode: 'daily', drawnCards: [cards[0]] }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'empty-answer' }));
  });
  it('只有空标题或思考不算有效正文', () => {
    expect(
      validateInterpretationQuality(
        '<think>分析</think>## 核心解读\n## 可采取的行动\n## 各牌说明',
        { mode: 'initial', drawnCards: cards },
      ).needsRetry,
    ).toBe(true);
  });
  it('格式异常只警告，保留可读正文', () => {
    expect(
      validateInterpretationQuality('你可以先确认对方是否愿意沟通。', {
        mode: 'initial',
        drawnCards: cards,
      }),
    ).toMatchObject({
      needsRetry: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'structure', severity: 'warning' }),
      ]),
    });
  });
  it('明确的相反方向要求重新生成', () => {
    expect(
      validateInterpretationQuality(body('### 过去 愚者（逆位）'), {
        mode: 'initial',
        drawnCards: cards,
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'orientation-mismatch', severity: 'error' }));
  });
  it('明确牌位对应错误不因牌确实抽过而放行', () => {
    expect(
      validateInterpretationQuality(body('### 现在 愚者（正位）'), {
        mode: 'initial',
        drawnCards: cards,
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'position-mismatch', severity: 'error' }));
  });
  it('没有抽到的专业说明牌报错', () => {
    expect(
      validateInterpretationQuality(body(`### 过去 ${allCards[3].nameCn}（正位）`), {
        mode: 'initial',
        drawnCards: cards,
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: 'unknown-card', severity: 'error' }));
  });
  it('追问不要求重新覆盖全部原牌', () => {
    expect(
      validateInterpretationQuality(body('### 过去 愚者（正位）'), {
        mode: 'follow-up',
        drawnCards: cards,
      }).issues,
    ).toEqual([]);
  });
  it('牌名出现但没有牌位或方向时只警告排版，不能当作已完整核对', () => {
    expect(
      validateInterpretationQuality(body('### 愚者'), { mode: 'follow-up', drawnCards: cards }),
    ).toMatchObject({
      needsRetry: false,
      issues: [expect.objectContaining({ code: 'structure' })],
    });
  });
  it('历史补牌可用于追问且不要求全部重述', () => {
    const historical = {
      ...cards[0],
      card: allCards[4],
      isReversed: true,
      position: { ...cards[0].position, id: 'extra-1', nameCn: '补充指引 1' },
    };
    expect(
      validateInterpretationQuality(body('### 补充指引 1 皇帝（逆位）'), {
        mode: 'follow-up',
        drawnCards: cards,
        historyCards: [historical],
      }).issues,
    ).toEqual([]);
  });
  it('每日明确声明错误方向也能检出', () => {
    expect(
      validateInterpretationQuality('今日愚者（逆位）提醒你先看清当前安排。', {
        mode: 'daily',
        drawnCards: [cards[0]],
      }).needsRetry,
    ).toBe(true);
  });
  it('補牌只要求本轮补牌覆盖，容许历史补牌', () => {
    const extra = {
      ...cards[0],
      card: allCards[4],
      position: { ...cards[0].position, id: 'extra-1', nameCn: '补充指引 1' },
    };
    expect(
      validateInterpretationQuality(body('### 补充指引 1 皇帝（正位）'), {
        mode: 'supplementary',
        drawnCards: cards,
        additionalCards: [extra],
      }).issues,
    ).toEqual([]);
  });
  it('每日自由段落不套用首轮三章节协议', () => {
    expect(
      validateInterpretationQuality('今天可以从一件小事开始，留意真实反馈。', {
        mode: 'daily',
        drawnCards: [cards[0]],
      }).issues,
    ).toEqual([]);
  });
  it('不将普通语境的牌名或条件式逆位讨论当成牌面冲突', () => {
    expect(
      validateInterpretationQuality(
        body('### 过去 愚者（正位）') + '\n逆位时会有另一种理解；太阳下散步也是选择。',
        { mode: 'follow-up', drawnCards: cards },
      ).needsRetry,
    ).toBe(false);
  });
});
