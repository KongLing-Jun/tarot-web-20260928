// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assessActionV2Calibration,
  validateActionV2Case,
} from '../scripts/reading-action-v2-assessment';

const scores = (goalAlignment = 2, executability: number | null = 2, groundedConditions = 2) => ({
  goalAlignment,
  executability,
  groundedConditions,
});
function fixture() {
  return {
    id: 'synthetic-v2',
    source: 'new-development' as const,
    annotation: '同一编造前提在两行出现。',
    scenario: {
      question: '审批还未出结果，怎么推进？',
      knownFacts: ['尚未收到结果'],
      goal: '确认状态',
      review: [],
      cards: [] as [],
    },
    goodAnswer: '询问审批状态。',
    badAnswer: '已经审批通过。\n请确认获批后的时间。\n可以发消息询问。',
    expectedFailure: {
      dimension: 'groundedConditions' as const,
      quote: '已经审批通过',
      reason: '没有审批通过的来源',
    },
    actionNeed: 'required' as const,
    expectedJointScores: { good: [scores()], bad: [scores(1, 2, 0), scores(2, 1, 0)] },
    severeErrors: [
      { id: 'invented-approval', locations: ['已经审批通过。', '请确认获批后的时间。'] },
    ],
  };
}
function review(bad = scores(1, 2, 0), quotes = ['已经审批通过。']) {
  return {
    answerA: { scores: scores(), actionNeed: 'required', severeErrors: [] },
    answerB: {
      scores: bad,
      actionNeed: 'required',
      severeErrors: quotes.map((quote) => ({ quote, reason: '未确认的审批状态' })),
    },
    winner: 'A',
    winnerReason: '来源更准确',
  };
}

describe('v2 joint score and evidence gates', () => {
  it.each([
    ['已经审批通过。'],
    ['请确认获批后的时间。'],
    ['已经审批通过。', '请确认获批后的时间。'],
  ])('accepts any registered occurrence of the required error: %j', (...quotes) => {
    expect(
      assessActionV2Calibration(review(scores(1, 2, 0), quotes), { ...fixture(), goodSide: 'A' }),
    ).toMatchObject({ passed: true, requiredErrorsRecognized: true, unexpectedSevereError: false });
  });

  it('requires all independent errors instead of one convenient quote', () => {
    const data = fixture();
    data.badAnswer += '\n你也已经预约好了。';
    data.severeErrors.push({ id: 'invented-booking', locations: ['你也已经预约好了。'] });
    expect(assessActionV2Calibration(review(), { ...data, goodSide: 'A' })).toMatchObject({
      passed: false,
      requiredErrorsRecognized: false,
    });
  });

  it('rejects invented-fact accusations against a normal line even if a required error is also found', () => {
    expect(
      assessActionV2Calibration(review(scores(1, 2, 0), ['已经审批通过。', '可以发消息询问。']), {
        ...fixture(),
        goodSide: 'A',
      }),
    ).toMatchObject({ passed: false, unexpectedSevereError: true });
  });

  it('accepts only frozen joint combinations, not the Cartesian product of per-dimension ranges', () => {
    expect(
      assessActionV2Calibration(review(scores(2, 1, 0)), { ...fixture(), goodSide: 'A' }).passed,
    ).toBe(true);
    expect(
      assessActionV2Calibration(review(scores(2, 2, 0)), { ...fixture(), goodSide: 'A' }),
    ).toMatchObject({ passed: false, absoluteScoreRecognized: false });
  });

  it('keeps ambiguity at 1 distinct from severe invented facts and rejects false alarms', () => {
    const data = fixture();
    data.expectedJointScores.bad = [scores(2, 2, 1)];
    data.severeErrors = [];
    expect(
      assessActionV2Calibration(review(scores(2, 2, 1), []), { ...data, goodSide: 'A' }).passed,
    ).toBe(true);
    expect(
      assessActionV2Calibration(review(scores(2, 2, 1)), { ...data, goodSide: 'A' }),
    ).toMatchObject({ passed: false, unexpectedSevereError: true });
  });

  it('does not mask a downgraded good answer with correct preference', () => {
    const result = review();
    result.answerA.scores.executability = 1;
    expect(assessActionV2Calibration(result, { ...fixture(), goodSide: 'A' })).toMatchObject({
      passed: false,
      goodAnswerScoreFalsePositive: true,
    });
  });

  it('requires a matched evidence line rather than a whole-answer quote containing an allowed excerpt', () => {
    expect(
      assessActionV2Calibration(review(scores(1, 2, 0), [fixture().badAnswer]), {
        ...fixture(),
        goodSide: 'A',
      }),
    ).toMatchObject({ passed: false, unexpectedSevereError: true });
  });

  it('validates labels and exact evidence locations before freezing', () => {
    expect(() => validateActionV2Case(fixture())).not.toThrow();
    const unknownLine = fixture();
    unknownLine.severeErrors[0].locations.push('不存在的原文');
    expect(() => validateActionV2Case(unknownLine)).toThrow();
    const invalidScore = fixture();
    invalidScore.expectedJointScores.bad[0].executability = 3;
    expect(() => validateActionV2Case(invalidScore)).toThrow();
    const wrongNull = fixture();
    wrongNull.expectedJointScores.good[0].executability = null;
    expect(() => validateActionV2Case(wrongNull)).toThrow();
    const empty = fixture();
    empty.expectedJointScores.bad = [];
    expect(() => validateActionV2Case(empty)).toThrow();
  });
});
