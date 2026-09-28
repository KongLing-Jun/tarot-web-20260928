import { describe, expect, it } from 'vitest';
import { buildFollowUpHistory, isFollowUpHistory } from '@/lib/followUpHistory';
import { drawCardsForSpread } from '@/lib/tarot/draw';
import { getSpreadById } from '@/lib/tarot/spreads';
import { parseFollowUps } from '@/lib/server/readings';

const entry = (id: string, status = 'done') => ({
  id,
  status,
  question: `问题 ${id}`,
  interpretation: `<think>内部推理</think>回答 ${id}`,
  additionalCards: [],
  error: null,
});

describe('追问历史范围', () => {
  it('统一终态允许格式提示进入上下文，截断及空标题仅保留用户补充', () => {
    expect(
      buildFollowUpHistory([
        { ...entry('1'), generationStatus: 'completed', notice: '格式不完整，已保留原文' },
        { ...entry('2'), generationStatus: 'truncated' },
        {
          ...entry('3'),
          generationStatus: 'completed',
          interpretation: '## 核心解读\n## 可采取的行动',
        },
      ]),
    ).toEqual([
      { question: '问题 1', interpretation: '回答 1', additionalCards: [] },
      { question: '问题 2', interpretation: '', additionalCards: [] },
      { question: '问题 3', interpretation: '', additionalCards: [] },
    ]);
  });
  it('包含目标之前的用户补充，清除无效回答与思考并保持顺序', () => {
    const first = entry('1');
    expect(
      buildFollowUpHistory(
        [first, entry('2', 'error'), entry('3', 'running'), entry('4'), entry('5')],
        '4',
      ),
    ).toEqual([
      { question: first.question, interpretation: '回答 1', additionalCards: [] },
      { question: '问题 2', interpretation: '', additionalCards: [] },
      { question: '问题 3', interpretation: '', additionalCards: [] },
    ]);
  });

  it('新追问获取全部用户历史，空正文及带错误的完成状态不提供模型回答', () => {
    expect(
      buildFollowUpHistory([
        entry('1'),
        { ...entry('2'), interpretation: '<think>只有思考</think>' },
        { ...entry('3'), error: '流中断' },
      ]),
    ).toEqual([
      { question: '问题 1', interpretation: '回答 1', additionalCards: [] },
      { question: '问题 2', interpretation: '', additionalCards: [] },
      { question: '问题 3', interpretation: '', additionalCards: [] },
    ]);
  });

  it('目标不存在时不误用未来历史', () => {
    expect(buildFollowUpHistory([entry('1')], 'missing')).toEqual([]);
  });

  it('旧记录没有统一终态时仍排除带提示的回答，保留补充和已抽牌', () => {
    const cards = drawCardsForSpread(getSpreadById('single')!);
    expect(
      buildFollowUpHistory([
        { ...entry('1'), additionalCards: cards },
        { ...entry('2'), additionalCards: cards, notice: '回复被截断' },
      ]),
    ).toEqual([
      { question: '问题 1', interpretation: '回答 1', additionalCards: cards },
      { question: '问题 2', interpretation: '', additionalCards: cards },
    ]);
  });

  it.each(['cancelled', 'truncated', 'interrupted', 'no-valid-answer'] as const)(
    '%s 后的用户目标纠正与实际补牌在刷新往返后仍保留',
    (generationStatus) => {
      const additionalCards = drawCardsForSpread(getSpreadById('single')!);
      const original = [
        {
          ...entry('1', 'error'),
          generationStatus,
          question: '我不想复合，只想把东西拿回来',
          additionalCards,
        },
      ];
      const restored = parseFollowUps(JSON.parse(JSON.stringify(original)));
      const history = buildFollowUpHistory(restored);
      expect(history).toEqual([
        { question: original[0].question, interpretation: '', additionalCards },
      ]);
      expect(isFollowUpHistory(history)).toBe(true);
      expect(original[0].interpretation).toContain('回答 1');
    },
  );

  it('重试相同 ID 只更新原回合，目标与未来回合不会回灌进自身历史', () => {
    const turns = [entry('1', 'error'), entry('2'), entry('3')];
    expect(buildFollowUpHistory(turns, '1')).toEqual([]);
    turns[0] = entry('1');
    expect(buildFollowUpHistory(turns, '2')).toEqual([
      { question: '问题 1', interpretation: '回答 1', additionalCards: [] },
    ]);
    expect(buildFollowUpHistory(turns)).toHaveLength(3);
  });

  it('同样措辞的独立补充保持各自顺序，不能按文本去重', () => {
    expect(
      buildFollowUpHistory([
        { ...entry('1', 'error'), question: '已经试过了' },
        { ...entry('2'), question: '已经试过了' },
      ]),
    ).toEqual([
      { question: '已经试过了', interpretation: '', additionalCards: [] },
      { question: '已经试过了', interpretation: '回答 2', additionalCards: [] },
    ]);
  });
});
