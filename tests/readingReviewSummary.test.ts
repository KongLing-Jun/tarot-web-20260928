// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeReadingReview } from '../scripts/summarize-reading-review';

const dimensions = ['directAnswer', 'consistency', 'efficiency', 'cardConnection', 'faithfulness'];
const answer = {
  scores: Object.fromEntries(dimensions.map((dimension) => [dimension, 2])),
  firstTwoSentencesAnswer: true,
  evidence: dimensions.map((dimension) => ({
    dimension,
    quote: '有效回答',
    reason: '合成评分证据',
  })),
  severeErrors: [],
};
const pair = (id: string, reversed = false) => ({
  id,
  scenarioId: `case-${id}`,
  attempt: 1,
  category: 'judgment',
  A: reversed ? ('right' as const) : ('left' as const),
  B: reversed ? ('left' as const) : ('right' as const),
});
const row = (id: string, winner = 'B') => ({
  testCase: { description: id },
  response: {
    output: JSON.stringify({ answerA: answer, answerB: answer, winner, winnerReason: '比较理由' }),
  },
  vars: {
    scenario: JSON.stringify({
      question: '问题',
      knownFacts: [],
      goal: '目标',
      review: [],
      cards: [],
    }),
    answerA: '有效回答甲',
    answerB: '有效回答乙',
  },
});

describe('semantic review summary', () => {
  it('reports scoped denominators independently of selected review wins and generation failures', () => {
    const key = {
      pairs: [pair('1')],
      scope: {
        version: 1 as const,
        basis: 'frozen-plan' as const,
        entries: [
          {
            scenarioId: 'case-1',
            attempt: 1,
            leftStatus: 'success',
            rightStatus: 'success',
            reason: null,
            reviewPairId: '1',
          },
          {
            scenarioId: 'case-2',
            attempt: 1,
            leftStatus: 'success',
            rightStatus: 'success',
            reason: null,
          },
          {
            scenarioId: 'case-3',
            attempt: 1,
            leftStatus: 'success',
            rightStatus: 'timeout',
            reason: 'non-success',
          },
          {
            scenarioId: 'case-4',
            attempt: 1,
            leftStatus: 'missing',
            rightStatus: 'missing',
            reason: 'missing-result',
          },
        ],
      },
    };
    const summary = summarizeReadingReview({ results: { results: [row('1')] } }, key);
    expect(summary.sides.right.winRateAllPairs).toBe(1);
    expect(summary.scope).toMatchObject({
      totalAttempts: 4,
      eligiblePairs: 2,
      unselectedEligiblePairs: 1,
      unpairableAttempts: 2,
      pairingRate: { numerator: 2, denominator: 4, rate: 0.5 },
      reviewCoverage: { numerator: 1, denominator: 4, rate: 0.25 },
      sides: {
        right: {
          generationSuccess: { numerator: 2, denominator: 4, rate: 0.5 },
          observedWinsInScope: { numerator: 1, denominator: 4, rate: 0.25 },
        },
      },
    });
  });
  it('does not invent a planned denominator for an old blind key', () => {
    const summary = summarizeReadingReview(
      { results: { results: [row('1')] } },
      { pairs: [pair('1')] },
    );
    expect(summary.scope).toBeNull();
  });
  it('does not turn an observed historical scope into a planned win rate', () => {
    const summary = summarizeReadingReview(
      { results: { results: [row('1')] } },
      {
        pairs: [pair('1')],
        scope: {
          version: 1,
          basis: 'observed-results',
          entries: [
            {
              scenarioId: 'case-1',
              attempt: 1,
              leftStatus: 'success',
              rightStatus: 'success',
              reason: null,
              reviewPairId: '1',
            },
          ],
        },
      },
    );
    expect(summary.scope?.sides.right.observedWinsInPlannedAttempts).toBeNull();
  });
  it('keeps both generation failures even when no pair can be reviewed', () => {
    const summary = summarizeReadingReview(
      { results: { results: [] } },
      {
        pairs: [],
        scope: {
          version: 1,
          basis: 'frozen-plan',
          entries: [
            {
              scenarioId: 'case-1',
              attempt: 1,
              leftStatus: 'timeout',
              rightStatus: 'http-429',
              reason: 'non-success',
            },
          ],
        },
      },
    );
    expect(summary.sides.right.winRateAllPairs).toBeNull();
    expect(summary.scope).toMatchObject({
      totalAttempts: 1,
      eligiblePairs: 0,
      unpairableAttempts: 1,
      reviewCoverage: { numerator: 0, denominator: 1, rate: 0 },
      sides: {
        right: { observedWinsInPlannedAttempts: { numerator: 0, denominator: 1, rate: 0 } },
      },
      failures: [{ leftStatus: 'timeout', rightStatus: 'http-429' }],
    });
  });
  it.each(['duplicate-attempt', 'wrong-pair', 'failed-pair', 'missing-selected'])(
    'rejects inconsistent scope evidence: %s',
    (mutation) => {
      const entry = {
        scenarioId: 'case-1',
        attempt: 1,
        leftStatus: 'success',
        rightStatus: 'success',
        reason: null as string | null,
        reviewPairId: '1',
      };
      const entries = mutation === 'missing-selected' ? [] : [entry];
      if (mutation === 'duplicate-attempt') entries.push({ ...entry });
      if (mutation === 'wrong-pair') entry.scenarioId = 'other';
      if (mutation === 'failed-pair') entry.reason = 'missing-answer';
      expect(() =>
        summarizeReadingReview(
          { results: { results: [row('1')] } },
          { pairs: [pair('1')], scope: { version: 1, basis: 'frozen-plan', entries } },
        ),
      ).toThrow();
    },
  );
  it('unblinds by identifier and side rather than completion order, retaining ties and missing reviews', () => {
    const summary = summarizeReadingReview(
      { results: { results: [row('2', 'A'), row('1'), row('3', 'tie')] } },
      { pairs: [pair('1'), pair('2', true), pair('3'), pair('4')] },
    );
    expect(summary).toMatchObject({
      totalPairs: 4,
      validReviews: 3,
      ties: 1,
      sides: { right: { wins: 2, winRateAllPairs: 0.5 } },
      failures: [{ pair: '4', reason: 'missing-review' }],
    });
  });
  it('does not count invalid quotations or transport errors as quality passes', () => {
    const bad = row('1');
    bad.vars.answerA = '引用不在本文';
    const summary = summarizeReadingReview(
      { results: { results: [bad, { ...row('2'), error: 'upstream error' }] } },
      { pairs: [pair('1'), pair('2')] },
    );
    expect(summary.validReviews).toBe(0);
    expect(summary.failures).toHaveLength(2);
    expect(summary.sides.right.directRateValidReviews).toBeNull();
  });
  it('keeps factual errors and directness as separate dimensions', () => {
    const value = row('1');
    const review = JSON.parse(value.response.output);
    review.answerB.severeErrors = [{ quote: '有效回答', reason: '合成错误例' }];
    value.response.output = JSON.stringify(review);
    const summary = summarizeReadingReview(
      { results: { results: [value] } },
      { pairs: [pair('1')] },
    );
    expect(summary.sides.right).toMatchObject({ directInFirstTwo: 1, answersWithSevereErrors: 1 });
    expect(summary.evidence[0].severeErrors[0].side).toBe('right');
  });
  it('rejects duplicate and unmapped reviews', () => {
    expect(() =>
      summarizeReadingReview(
        { results: { results: [row('1'), row('1')] } },
        { pairs: [pair('1')] },
      ),
    ).toThrow();
    expect(() =>
      summarizeReadingReview({ results: { results: [row('2')] } }, { pairs: [pair('1')] }),
    ).toThrow();
  });
  it('separates wins, losses, ties and invalid reviews with explicit all-pair and valid-only denominators', () => {
    const pairs = Array.from({ length: 24 }, (_, index) => pair(String(index + 1)));
    const results = [
      ...pairs.slice(0, 3).map((value) => row(value.id, 'B')),
      ...pairs.slice(3, 5).map((value) => row(value.id, 'A')),
      ...pairs.slice(5, 16).map((value) => row(value.id, 'tie')),
      { ...row('17'), error: '裁判调用失败' },
    ];
    const summary = summarizeReadingReview({ results: { results } }, { pairs });
    expect(summary).toMatchObject({
      totalPairs: 24,
      validReviews: 16,
      invalidReviews: 8,
      ties: 11,
      formatValidity: { numerator: 16, denominator: 24, rate: 16 / 24 },
      sides: {
        right: {
          wins: 3,
          losses: 2,
          ties: 11,
          invalid: 8,
          winRateAllPairs: 3 / 24,
          conservativeWinsAllPairs: { numerator: 3, denominator: 24, rate: 3 / 24 },
          validOnlyWins: { numerator: 3, denominator: 16, rate: 3 / 16 },
        },
        left: { wins: 2, losses: 3, ties: 11, invalid: 8 },
      },
    });
    expect(summary.warning).toContain('不算落败');
    expect(
      summary.sides.right.wins +
        summary.sides.right.losses +
        summary.sides.right.ties +
        summary.sides.right.invalid,
    ).toBe(24);
  });

  it('does not turn an entirely invalid evaluation into losses and uses null for undefined rates', () => {
    const summary = summarizeReadingReview({ results: { results: [] } }, { pairs: [pair('1')] });
    expect(summary.sides.right).toMatchObject({
      wins: 0,
      losses: 0,
      ties: 0,
      invalid: 1,
      conservativeWinsAllPairs: { numerator: 0, denominator: 1, rate: 0 },
      validOnlyWins: { numerator: 0, denominator: 0, rate: null },
    });
    const empty = summarizeReadingReview({ results: { results: [] } }, { pairs: [] });
    expect(empty.formatValidity).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(empty.sides.right.conservativeWinsAllPairs.rate).toBeNull();
    expect(empty.sides.right.winRateAllPairs).toBeNull();
  });
});
