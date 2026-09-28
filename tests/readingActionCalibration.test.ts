// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readingActionCalibrationCases } from './fixtures/reading-action-calibration';

const callApi = vi.hoisted(() => vi.fn());
vi.mock('../scripts/reading-review-provider.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scripts/reading-review-provider.mjs')>()),
  default: class {
    callApi = callApi;
  },
}));
let directory: string;
const args = () => [
  '--rubric',
  'action-v1',
  '--model',
  'fixture-reviewer',
  '--timeout-ms',
  '1000',
  '--max-output-tokens',
  '2000',
  '--max-requests',
  '24',
  '--output',
  directory,
];

function correctReview(material: { answerA: string; answerB: string }) {
  const fixture = readingActionCalibrationCases.find(
    (item) => item.goodAnswer === material.answerA || item.goodAnswer === material.answerB,
  )!;
  const good = material.answerA === fixture.goodAnswer ? 'A' : 'B';
  const answer = (side: 'A' | 'B') => ({
    actionNeed: fixture.actionNeed,
    scores: { ...fixture.expectedScores[side === good ? 'good' : 'bad'] },
    evidence: Object.keys(fixture.expectedScores.good).map((dimension) => ({
      dimension,
      quote: material[`answer${side}`],
      reason: '合成测试评分依据',
    })),
    severeErrors:
      side !== good && fixture.expectedFailure.dimension === 'groundedConditions'
        ? [{ quote: fixture.expectedFailure.quote, reason: fixture.expectedFailure.reason }]
        : [],
  });
  return {
    answerA: answer('A'),
    answerB: answer('B'),
    winner: good,
    winnerReason: '合成测试正确偏好',
  };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'action-calibration-'));
  callApi.mockReset().mockImplementation(async (prompt: string) => ({
    output: JSON.stringify(correctReview(JSON.parse(prompt))),
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('action reviewer calibration gates', () => {
  it('freezes 12 independent scenes and 24 swapped requests without leaking score labels or making calls', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    expect(manifest.kind).toBe('action-reviewer-calibration');
    expect(manifest.pairs).toHaveLength(24);
    for (const pair of manifest.pairs) {
      expect(pair.expectedScores).toBeDefined();
      expect(JSON.stringify(pair.input)).not.toMatch(
        /expectedScores|expectedFailure|goodSide|goodAnswer|badAnswer/,
      );
    }
    expect(callApi).not.toHaveBeenCalled();
    expect(readingActionCalibrationCases).toHaveLength(12);
    expect(new Set(readingActionCalibrationCases.map((entry) => entry.id)).size).toBe(12);
  });

  it('reports absolute anchors, no-action cases and swapped scenes separately from candidate win rates', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      kind: 'action-reviewer-calibration',
      total: 24,
      valid: 24,
      passed: 24,
      allPassed: true,
      absoluteScoreRecognition: 24,
      actionNeedRecognition: 24,
      scenarioCount: 12,
      scenariosPassed: 12,
      swapConsistentScenarios: 12,
    });
    expect(summary.dimensions.goalAlignment).toMatchObject({ total: 8, passed: 8 });
    expect(summary.dimensions.executability).toMatchObject({ total: 8, passed: 8 });
    expect(summary.dimensions.groundedConditions).toMatchObject({ total: 8, passed: 8 });
    expect(callApi).toHaveBeenCalledTimes(24);
    await expect(calibrateReadingReview([...args(), '--run'])).rejects.toThrow('已有');
  });

  it('does not pass merely because the bad answer scores below an incorrectly downgraded good answer', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    callApi.mockImplementationOnce(async (prompt: string) => {
      const result = correctReview(JSON.parse(prompt));
      result.answerA.scores.goalAlignment = 1;
      return { output: JSON.stringify(result) };
    });
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      valid: 24,
      preferenceRecognition: 24,
      passed: 23,
      absoluteScoreRecognition: 23,
      allPassed: false,
      goodAnswerScoreFalsePositives: 1,
      scenariosPassed: 11,
      swapConsistentScenarios: 11,
    });
  });

  it('keeps failed requests in the denominator and requires evidence for invented conditions', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    callApi
      .mockImplementation(async (prompt: string) => {
        const result = correctReview(JSON.parse(prompt));
        result.answerA.severeErrors = [];
        result.answerB.severeErrors = [];
        return { output: JSON.stringify(result) };
      })
      .mockRejectedValueOnce(new Error('private transport detail'));
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      total: 24,
      valid: 23,
      invalid: 1,
      passed: 15,
      errorRecognition: 15,
      allPassed: false,
    });
    expect(await readFile(path.join(directory, 'results.json'), 'utf8')).not.toContain(
      'private transport detail',
    );
    expect(callApi).toHaveBeenCalledTimes(24);
  });

  it('requires the full request budget before preparation and rejects changing rubric at run time', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await expect(
      calibrateReadingReview(args().map((value) => (value === '24' ? '23' : value))),
    ).rejects.toThrow('上限');
    await calibrateReadingReview(args());
    await expect(
      calibrateReadingReview([
        ...args().map((value) => (value === 'action-v1' ? 'general' : value)),
        '--run',
      ]),
    ).rejects.toThrow('冻结');
    expect(callApi).not.toHaveBeenCalled();
  });

  it('does not count a different action line as locating the fabricated premise', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    callApi.mockImplementation(async (prompt: string) => {
      const material = JSON.parse(prompt);
      const result = correctReview(material);
      for (const side of ['A', 'B'] as const) {
        if (result[`answer${side}`].severeErrors.length) {
          result[`answer${side}`].severeErrors = [
            {
              quote: material[`answer${side}`].split('\n').at(-1),
              reason: '指到另一行，未定位编造条件',
            },
          ];
        }
      }
      return { output: JSON.stringify(result) };
    });
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      total: 24,
      valid: 24,
      errorRecognition: 16,
      passed: 16,
      allPassed: false,
    });
  });

  it('rejects treating an execution or goal error as an invented fact despite otherwise correct scores', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    callApi.mockImplementationOnce(async (prompt: string) => {
      const material = JSON.parse(prompt);
      const result = correctReview(material);
      result.answerB.severeErrors = [
        { quote: material.answerB, reason: '误把目标偏离算成虚构事实' },
      ];
      return { output: JSON.stringify(result) };
    });
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      total: 24,
      valid: 24,
      absoluteScoreRecognition: 24,
      passed: 23,
      unexpectedSevereErrors: 1,
      allPassed: false,
    });
  });
});
