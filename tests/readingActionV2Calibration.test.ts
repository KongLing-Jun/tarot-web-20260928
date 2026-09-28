// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readingActionCalibrationV2Cases } from './fixtures/reading-action-calibration-v2';

const callApi = vi.hoisted(() => vi.fn());
vi.mock('../scripts/reading-review-provider.mjs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scripts/reading-review-provider.mjs')>()),
  default: class {
    callApi = callApi;
  },
}));
let directory: string;
const materialArgs = () => ['--rubric', 'action-v2', '--materials-only', '--output', directory];
const budgetArgs = () => [
  '--rubric',
  'action-v2',
  '--model',
  'fixture-judge',
  '--timeout-ms',
  '1000',
  '--max-output-tokens',
  '2000',
  '--max-requests',
  '32',
  '--output',
  directory,
];
function correctReview(input: { answerA: string; answerB: string }) {
  const entry = readingActionCalibrationV2Cases.find(
    (item) => item.goodAnswer === input.answerA || item.goodAnswer === input.answerB,
  )!;
  const goodSide = entry.goodAnswer === input.answerA ? 'A' : 'B';
  const answer = (side: 'A' | 'B') => ({
    actionNeed: entry.actionNeed,
    scores: entry.expectedJointScores[side === goodSide ? 'good' : 'bad'][0],
    evidence: ['goalAlignment', 'executability', 'groundedConditions'].map((dimension) => ({
      dimension,
      quote: input[`answer${side}`],
      reason: '离线合成裁判响应',
    })),
    severeErrors:
      side === goodSide
        ? []
        : entry.severeErrors.map((error) => ({
            quote: error.locations[0],
            reason: '对应原文位置',
          })),
  });
  return {
    answerA: answer('A'),
    answerB: answer('B'),
    winner: goodSide,
    winnerReason: '离线正确偏好',
  };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'action-v2-'));
  callApi.mockReset();
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('unbudgeted v2 action calibration materials', () => {
  it('freezes development materials without a model, credentials, call budget or paid requests', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(materialArgs());
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      kind: 'action-reviewer-materials',
      config: null,
      reviewProfile: 'action-v2',
      datasetRole: 'development-calibration',
    });
    expect(manifest.pairs).toHaveLength(32);
    expect(manifest.rubricHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      manifest.pairs.filter((pair: { source: string }) => pair.source === 'new-development'),
    ).toHaveLength(8);
    for (const pair of manifest.pairs) {
      expect(pair.expectedJointScores.good.length).toBeGreaterThan(0);
      expect(Array.isArray(pair.severeErrors)).toBe(true);
      expect(JSON.stringify(pair.input)).not.toMatch(
        /expectedJointScores|annotation|revised-development|new-development|goodSide|expectedFailure|severeErrors/,
      );
    }
    expect(callApi).not.toHaveBeenCalled();
    await expect(calibrateReadingReview(materialArgs())).rejects.toThrow('已有');
  });

  it('cannot turn materials-only into a live run or silently assign a budget', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await expect(calibrateReadingReview([...materialArgs(), '--run'])).rejects.toThrow();
    await expect(
      calibrateReadingReview([...materialArgs(), '--max-requests', '32']),
    ).rejects.toThrow();
    await expect(
      calibrateReadingReview(
        materialArgs().map((value) => (value === 'action-v2' ? 'action-v1' : value)),
      ),
    ).rejects.toThrow();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('refuses running unbudgeted material even when later CLI arguments include a budget', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(materialArgs());
    await expect(calibrateReadingReview([...budgetArgs(), '--run'])).rejects.toThrow('冻结');
    expect(callApi).not.toHaveBeenCalled();
  });

  it('reports automatic checks separately from manual semantic review and candidate readiness', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    callApi.mockImplementation(async (prompt: string) => ({
      output: JSON.stringify(correctReview(JSON.parse(prompt))),
    }));
    await calibrateReadingReview(budgetArgs());
    await calibrateReadingReview([...budgetArgs(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      total: 32,
      valid: 32,
      passed: 32,
      scenarioCount: 16,
      scenariosPassed: 16,
      automaticChecksPassed: true,
      manualReviewRequired: true,
      candidateComparisonReady: false,
      datasetRole: 'development-calibration',
      sources: {
        'revised-development': { total: 24, passed: 24 },
        'new-development': { total: 8, passed: 8 },
      },
    });
    expect(summary.note).not.toContain('12 个场景');
    expect(callApi).toHaveBeenCalledTimes(32);
    for (const [prompt] of callApi.mock.calls)
      expect(prompt).not.toMatch(/expectedJointScores|annotation|new-development|severeErrors/);
  });

  it('retains a failed call in the total and source denominator without retrying', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    callApi
      .mockImplementation(async (prompt: string) => ({
        output: JSON.stringify(correctReview(JSON.parse(prompt))),
      }))
      .mockRejectedValueOnce(new Error('private error'));
    await calibrateReadingReview(budgetArgs());
    await calibrateReadingReview([...budgetArgs(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      total: 32,
      valid: 31,
      invalid: 1,
      passed: 31,
      automaticChecksPassed: false,
      sources: {
        'revised-development': { total: 24, passed: 23 },
        'new-development': { total: 8, passed: 8 },
      },
    });
    expect(callApi).toHaveBeenCalledTimes(32);
  });
});
