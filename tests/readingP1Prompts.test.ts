import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildInterpretationPrompt,
  buildFollowUpDirectPrompt,
  buildFollowUpWithExtrasPrompt,
  buildDailyInterpretationPrompt,
  buildFollowUpDecidePrompt,
  buildReadingMessages,
} from '@/lib/api/prompts';
import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';

const spread = getSpreadById('single')!;
const cards = [{ card: allCards[0], position: spread.positions[0], isReversed: true }];
const args = ['问题', spread, cards, '原答', '追问'] as const;

describe('versioned reading prompts', () => {
  it('keeps frozen P0 prompts unchanged for rollback and fair comparisons', () => {
    const prompts = [
      buildInterpretationPrompt('问题', spread, cards, 'p0'),
      buildFollowUpDirectPrompt(...args, undefined, 'p0'),
      buildFollowUpWithExtrasPrompt(...args, cards, undefined, 'p0'),
      buildDailyInterpretationPrompt(
        'The Fool',
        '愚者',
        true,
        ['审慎'],
        '留意下一步',
        '2026-09-19',
        'p0',
      ),
    ];
    expect(prompts.map((text) => createHash('sha256').update(text).digest('hex'))).toEqual([
      '31b9c288d31ba8263ddcaeaae1f769dbe02f1f5f1ed8acf573787833e12acbc5',
      '1b9d83ce42b05274000ce25ff017c96418b9afdf95c51b832d800c0317bdbafe',
      '628b5ae9efea7cca67794b4c88e7f892cd28bf027aac77bc90e20bf56a89eb5d',
      '5e7fee195d26eb22c5e95e77a6edbaf6976fa3f031faa43592f83b6f222e1a7e',
    ]);
  });

  it('uses the answer-first profile across modes without swallowing user data or leaking reasoning', () => {
    const history = [
      {
        question: '已说清：不要复合',
        interpretation: '<think>秘密思考</think>旧建议',
        additionalCards: cards,
      },
    ];
    for (const prompt of [
      buildInterpretationPrompt('我已说清，不要再问领域。', spread, cards, 'p1'),
      buildFollowUpDirectPrompt(...args, history, 'p1'),
      buildFollowUpWithExtrasPrompt(...args, cards, history, 'p1'),
      buildDailyInterpretationPrompt(
        'The Fool',
        '愚者',
        true,
        ['审慎'],
        '留意下一步',
        '2026-09-19',
        'p1',
      ),
    ]) {
      const messages = buildReadingMessages(prompt);
      expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
      expect(messages[0].content).toContain('前两句');
      expect(messages[0].content).toContain('不要把判断题改答成行动建议');
      expect(messages[0].content).toContain('只倾诉');
      expect(messages[1].content).toContain('愚者');
      expect(prompt).not.toContain('秘密思考');
    }
    expect(buildFollowUpDirectPrompt(...args, history, 'p1')).toContain('已说清：不要复合');
    expect(buildReadingMessages(buildFollowUpDecidePrompt(...args))).toHaveLength(1);
  });

  it('keeps knowledge enrichment isolated from the response-only experiment', () => {
    const baseline = buildInterpretationPrompt('现在如何？', spread, cards, 'p1');
    const enriched = buildInterpretationPrompt('现在如何？', spread, cards, 'p1-knowledge');
    expect(buildReadingMessages(enriched)[0]).toEqual(buildReadingMessages(baseline)[0]);
    expect(baseline).not.toContain('知识参考版本');
    expect(enriched).toContain('知识参考版本');
    expect(enriched).toContain('愚者（逆位）');
  });

  it('keeps assertive dictionary prose out of P1 daily inputs as well as spread inputs', () => {
    const unsupported = '你即将获得确定成功，已经准备好一切。';
    const daily = (profile: 'p0' | 'p1') =>
      buildDailyInterpretationPrompt(
        'The Fool',
        '愚者',
        true,
        ['审慎'],
        unsupported,
        '2026-09-19',
        profile,
      );
    expect(daily('p0')).toContain(unsupported);
    expect(daily('p1')).not.toContain(unsupported);
    expect(daily('p1')).toContain('审慎');
    const injectedCards = [
      {
        ...cards[0],
        card: { ...cards[0].card, meaning: { upright: unsupported, reversed: unsupported } },
      },
    ];
    expect(buildInterpretationPrompt('当前问题', spread, injectedCards, 'p1')).not.toContain(
      unsupported,
    );
  });

  it('preserves card positions without treating descriptive position prose as evidence in P1', () => {
    const positionedCards = [
      {
        ...cards[0],
        position: {
          ...cards[0].position,
          nameCn: '外部影响',
          description: '周围的人已经对你形成的态度',
        },
      },
    ];
    const p1 = buildInterpretationPrompt('当前问题', spread, positionedCards, 'p1');
    expect(p1).toContain('【外部影响】愚者（逆位）');
    expect(p1).not.toContain('周围的人已经对你形成的态度');
    expect(buildInterpretationPrompt('当前问题', spread, positionedCards, 'p0')).toContain(
      '周围的人已经对你形成的态度',
    );
  });

  it('allows necessary explanation without requiring every judgment to be exactly two sentences', () => {
    const prompt = buildInterpretationPrompt('当前问题', spread, cards, 'p1');
    expect(buildReadingMessages(prompt)[0].content).not.toContain('只写两句');
    expect(prompt).toContain('用户原话');
    expect(prompt).toContain('象征解释');
  });
});
