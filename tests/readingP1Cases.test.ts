// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';
import { readingP1Cases, type ReadingP1Category } from './fixtures/reading-p1-cases';

const quotas: Record<ReadingP1Category, [number, number]> = {
  judgment: [12, 6],
  trend: [12, 6],
  other: [10, 5],
  choice: [10, 5],
  method: [10, 5],
  listening: [6, 3],
};

describe('P1 synthetic evaluation corpus', () => {
  it('has the predeclared category quotas and twelve development screening cases', () => {
    expect(readingP1Cases).toHaveLength(90);
    expect(new Set(readingP1Cases.map((item) => item.id)).size).toBe(90);
    for (const [category, counts] of Object.entries(quotas)) {
      for (const [index, split] of ['development', 'holdout'].entries()) {
        expect(
          readingP1Cases.filter((item) => item.category === category && item.split === split),
        ).toHaveLength(counts[index]);
      }
      expect(
        readingP1Cases.filter((item) => item.category === category && item.screen),
      ).toHaveLength(2);
    }
    expect(
      readingP1Cases.filter((item) => item.screen).every((item) => item.split === 'development'),
    ).toBe(true);
  });

  it('uses actual cards and complete positions with no repeated draws within a reading', () => {
    const cardIds = new Set(allCards.map((card) => card.id));
    for (const item of readingP1Cases) {
      const spread = spreads.find((candidate) => candidate.id === item.spreadId)!;
      expect(spread).toBeDefined();
      expect(item.drawnCards.map((drawn) => drawn.position)).toEqual(spread.positions);
      const draws = [
        ...item.drawnCards,
        ...(item.additionalCards ?? []),
        ...(item.history ?? []).flatMap((turn) => turn.additionalCards),
      ];
      expect(draws.every((drawn) => cardIds.has(drawn.card.id))).toBe(true);
      expect(new Set(draws.map((drawn) => drawn.card.id)).size).toBe(draws.length);
      expect(item.source).toBe('synthetic');
      expect(item.knownFacts.length).toBeGreaterThan(0);
      expect(item.goal.trim()).not.toBe('');
      expect(item.review.length).toBeGreaterThanOrEqual(2);
      expect(item.rejectedGoals.length).toBeGreaterThan(0);
      if (item.mode === 'direct' || item.mode === 'extras') {
        expect(item.followUpQuestion).toBeTruthy();
        expect(item.previousInterpretation).toBeTruthy();
      }
      if (item.mode === 'extras') expect(item.additionalCards?.length).toBeGreaterThan(0);
      if (item.mode === 'daily') expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it.each(['development', 'holdout'])(
    'covers entry points, every spread and card variety in %s',
    (split) => {
      const cases = readingP1Cases.filter((item) => item.split === split);
      expect(new Set(cases.map((item) => item.spreadId))).toEqual(
        new Set(spreads.map((spread) => spread.id)),
      );
      expect(new Set(cases.map((item) => item.mode))).toEqual(
        new Set(['initial', 'direct', 'extras', 'daily']),
      );
      const draws = cases.flatMap((item) => [...item.drawnCards, ...(item.additionalCards ?? [])]);
      expect(new Set(draws.map((drawn) => drawn.card.suit).filter(Boolean))).toEqual(
        new Set(['wands', 'cups', 'swords', 'pentacles']),
      );
      expect(draws.some((drawn) => drawn.card.type === 'major')).toBe(true);
      expect(draws.some((drawn) => drawn.card.type === 'minor' && drawn.card.number >= 11)).toBe(
        true,
      );
      expect(new Set(draws.map((drawn) => drawn.isReversed))).toEqual(new Set([true, false]));
      expect(cases.some((item) => item.tags.includes('fact-correction'))).toBe(true);
      expect(cases.some((item) => item.tags.includes('missing-context'))).toBe(true);
    },
  );

  it('keeps paired groups within one split and checks the claimed control variable', () => {
    const groups = Map.groupBy(readingP1Cases, (item) => item.groupId);
    for (const group of groups.values()) {
      expect(new Set(group.map((item) => item.split)).size).toBe(1);
      if (group[0].pairKind === 'none') {
        expect(group).toHaveLength(1);
        continue;
      }
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(new Set(group.map((item) => item.pairKind)).size).toBe(1);
      expect(new Set(group.map((item) => item.spreadId)).size).toBe(1);
      const cardSets = group.map((item) =>
        JSON.stringify(item.drawnCards.map((drawn) => [drawn.card.id, drawn.isReversed])),
      );
      if (group[0].pairKind === 'same-cards') {
        expect(new Set(cardSets).size).toBe(1);
        expect(
          new Set(
            group.map((item) =>
              JSON.stringify([item.question, item.followUpQuestion, item.knownFacts]),
            ),
          ).size,
        ).toBe(group.length);
      } else {
        expect(new Set(group.map((item) => item.question)).size).toBe(1);
        expect(new Set(group.map((item) => JSON.stringify(item.knownFacts))).size).toBe(1);
        expect(new Set(cardSets).size).toBe(group.length);
      }
    }
    for (const split of ['development', 'holdout']) {
      const cases = readingP1Cases.filter((item) => item.split === split);
      expect(cases.some((item) => item.pairKind === 'same-cards')).toBe(true);
      expect(cases.some((item) => item.pairKind === 'same-question')).toBe(true);
    }
    // 每日入口本来就没有问题文本；其输入身份由日期和固定当日牌决定。
    const inputIdentity = (item: (typeof readingP1Cases)[number]) =>
      JSON.stringify(
        item.mode === 'daily'
          ? [
              item.mode,
              item.date,
              item.drawnCards.map((drawn) => [drawn.card.id, drawn.isReversed]),
            ]
          : [item.question, item.followUpQuestion],
      );
    const developmentInputs = new Set(
      readingP1Cases.filter((item) => item.split === 'development').map(inputIdentity),
    );
    expect(
      readingP1Cases
        .filter((item) => item.split === 'holdout')
        .every((item) => !developmentInputs.has(inputIdentity(item))),
    ).toBe(true);
  });
});
