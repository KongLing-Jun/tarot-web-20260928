import { isDeepStrictEqual } from 'node:util';
import type { ReadingActionCalibrationV2Case } from '../tests/fixtures/reading-action-calibration-v2';
import type {
  ReadingActionDimension,
  ReadingActionScores,
} from '../tests/fixtures/reading-action-calibration';

const dimensions: ReadingActionDimension[] = [
  'goalAlignment',
  'executability',
  'groundedConditions',
];
type Expectation = Pick<
  ReadingActionCalibrationV2Case,
  'expectedJointScores' | 'expectedFailure' | 'severeErrors' | 'actionNeed'
>;
interface ReviewedAnswer {
  scores: ReadingActionScores;
  actionNeed: string;
  severeErrors: { quote: string; reason: string }[];
}
interface Review {
  answerA: ReviewedAnswer;
  answerB: ReviewedAnswer;
  winner: string;
}

/** Validate authored labels and frozen material before spending any request budget. */
export function validateActionV2Case(value: unknown) {
  const entry = value as ReadingActionCalibrationV2Case;
  if (
    !entry ||
    !entry.id ||
    !['revised-development', 'new-development'].includes(entry.source) ||
    !entry.annotation?.trim() ||
    !entry.goodAnswer?.trim() ||
    !entry.badAnswer?.trim() ||
    !['required', 'not-required'].includes(entry.actionNeed) ||
    !dimensions.includes(entry.expectedFailure?.dimension) ||
    !entry.expectedFailure.quote?.trim() ||
    !entry.badAnswer.includes(entry.expectedFailure.quote) ||
    !entry.expectedFailure.reason?.trim()
  )
    throw new Error('v2 校准标签格式无效');
  for (const side of ['good', 'bad'] as const) {
    const alternatives = entry.expectedJointScores?.[side];
    if (
      !Array.isArray(alternatives) ||
      !alternatives.length ||
      alternatives.some(
        (scores) =>
          !scores ||
          Object.keys(scores).length !== dimensions.length ||
          dimensions.some((key) =>
            key === 'executability' && entry.actionNeed === 'not-required'
              ? scores[key] !== null
              : !Number.isInteger(scores[key]) || scores[key]! < 0 || scores[key]! > 2,
          ),
      )
    )
      throw new Error('v2 联合分值无效');
  }
  const key = entry.expectedFailure.dimension;
  if (
    entry.expectedJointScores.bad.some((bad) =>
      entry.expectedJointScores.good.some(
        (good) => bad[key] === null || good[key] === null || bad[key]! >= good[key]!,
      ),
    )
  )
    throw new Error('v2 主错误分值必须低于合理回答');
  const lines = entry.badAnswer.split(/\r\n|\n|\r/);
  if (
    !Array.isArray(entry.severeErrors) ||
    new Set(entry.severeErrors.map((error) => error?.id)).size !== entry.severeErrors.length ||
    entry.severeErrors.some(
      (error) =>
        !error?.id?.trim() ||
        !Array.isArray(error.locations) ||
        !error.locations.length ||
        error.locations.some((line) => !line?.trim() || !lines.includes(line)),
    )
  )
    throw new Error('v2 必需错误及合法原文位置无效');
  if (
    entry.expectedJointScores.bad.some(
      (scores) => (scores.groundedConditions === 0) !== entry.severeErrors.length > 0,
    )
  )
    throw new Error('v2 严重错误与事实分值不一致');
}

/** Literal evidence and authored joint-score matching only; reasons still require human review. */
export function assessActionV2Calibration(
  review: Review,
  expected: Expectation & { goodSide: 'A' | 'B' },
) {
  const good = review[expected.goodSide === 'A' ? 'answerA' : 'answerB'];
  const bad = review[expected.goodSide === 'A' ? 'answerB' : 'answerA'];
  const preferenceRecognized = review.winner === expected.goodSide;
  const requiredErrorsRecognized = expected.severeErrors.every((error) =>
    bad.severeErrors.some((evidence) => error.locations.includes(evidence.quote)),
  );
  const unexpectedSevereError = bad.severeErrors.some(
    (evidence) => !expected.severeErrors.some((error) => error.locations.includes(evidence.quote)),
  );
  const dimension = expected.expectedFailure.dimension;
  const errorRecognized =
    bad.scores[dimension] !== null &&
    good.scores[dimension] !== null &&
    bad.scores[dimension]! < good.scores[dimension]! &&
    requiredErrorsRecognized;
  const absoluteScoreRecognized =
    expected.expectedJointScores.good.some((scores) => isDeepStrictEqual(scores, good.scores)) &&
    expected.expectedJointScores.bad.some((scores) => isDeepStrictEqual(scores, bad.scores));
  const actionNeedRecognized =
    good.actionNeed === expected.actionNeed && bad.actionNeed === expected.actionNeed;
  const goodAnswerFalsePositive = good.severeErrors.length > 0;
  const goodAnswerScoreFalsePositive = dimensions.some((key) => {
    const floor = expected.expectedJointScores.good
      .map((scores) => scores[key])
      .filter((value): value is number => value !== null);
    return (
      floor.length > 0 && (good.scores[key] === null || good.scores[key]! < Math.min(...floor))
    );
  });
  return {
    preferenceRecognized,
    errorRecognized,
    requiredErrorsRecognized,
    unexpectedSevereError,
    absoluteScoreRecognized,
    actionNeedRecognized,
    goodAnswerFalsePositive,
    goodAnswerScoreFalsePositive,
    passed:
      preferenceRecognized &&
      errorRecognized &&
      !unexpectedSevereError &&
      absoluteScoreRecognized &&
      actionNeedRecognized &&
      !goodAnswerFalsePositive,
  };
}
