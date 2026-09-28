// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readingReviewCalibrationCases } from './fixtures/reading-review-calibration';

const callApi = vi.hoisted(() => vi.fn());
vi.mock('../scripts/reading-review-provider.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scripts/reading-review-provider.mjs')>();
  return {
    ...actual,
    default: class {
      callApi = callApi;
    },
  };
});
const dimensions = ['directAnswer', 'consistency', 'efficiency', 'cardConnection', 'faithfulness'];
let directory: string;
const args = () => [
  '--model',
  'fixture-reviewer',
  '--timeout-ms',
  '1000',
  '--max-output-tokens',
  '2000',
  '--max-requests',
  '12',
  '--output',
  directory,
];

function goodReview(material: { answerA: string; answerB: string }) {
  const fixture = readingReviewCalibrationCases.find(
    (item) => item.goodAnswer === material.answerA || item.goodAnswer === material.answerB,
  )!;
  const good = material.answerA === fixture.goodAnswer ? 'A' : 'B';
  const answer = (side: 'A' | 'B') => ({
    scores: Object.fromEntries(dimensions.map((dimension) => [dimension, side === good ? 2 : 0])),
    firstTwoSentencesAnswer: side === good,
    evidence: dimensions.map((dimension) => ({
      dimension,
      quote: material[`answer${side}`],
      reason: 'fixture evidence',
    })),
    severeErrors:
      side === good || fixture.expectedFailure.dimension !== 'faithfulness'
        ? []
        : [{ quote: fixture.expectedFailure.quote, reason: fixture.expectedFailure.reason }],
  });
  return {
    answerA: answer('A'),
    answerB: answer('B'),
    winner: good,
    winnerReason: 'fixture preference',
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'reading-calibration-'));
  callApi.mockReset().mockImplementation(async (prompt: string) => ({
    output: JSON.stringify(goodReview(JSON.parse(prompt))),
    metadata: { usage: { total_tokens: 30 } },
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('offline reading reviewer calibration', () => {
  it('prepares twelve frozen swapped pairs without calling the model or exposing expected labels in inputs', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    expect(manifest.pairs).toHaveLength(12);
    for (let index = 0; index < 12; index += 2) {
      const first = manifest.pairs[index];
      const second = manifest.pairs[index + 1];
      expect(first.input.answerA).toBe(second.input.answerB);
      expect(first.input.answerB).toBe(second.input.answerA);
      expect(JSON.stringify(first.input)).not.toMatch(
        /expectedFailure|goodAnswer|badAnswer|goodSide/,
      );
    }
    expect(callApi).not.toHaveBeenCalled();
    expect(manifest.rubricHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires explicit budgets and rejects insufficient or invalid limits before preparation', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await expect(calibrateReadingReview(['--output', directory])).rejects.toThrow();
    await expect(
      calibrateReadingReview(args().map((value) => (value === '12' ? '11' : value))),
    ).rejects.toThrow('上限');
    await expect(calibrateReadingReview([...args(), '--concurrency', '0'])).rejects.toThrow();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('runs each pair exactly once, saves usage, and reports calibration separately from candidate wins', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    await calibrateReadingReview([...args(), '--run']);
    expect(callApi).toHaveBeenCalledTimes(12);
    for (const [prompt] of callApi.mock.calls)
      expect(prompt).not.toMatch(/expectedFailure|goodAnswer|badAnswer|goodSide/);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      kind: 'reviewer-calibration',
      total: 12,
      valid: 12,
      validityRate: 1,
      preferenceRecognition: 12,
      errorRecognition: 12,
      passed: 12,
      allPassed: true,
    });
    const results = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
    expect(results[0].metadata.usage.total_tokens).toBe(30);
    await expect(calibrateReadingReview([...args(), '--run'])).rejects.toThrow('已有');
    expect(callApi).toHaveBeenCalledTimes(12);
  });

  it('keeps invalid reviews, missed bad evidence and false positives as separate failures without retrying', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    callApi.mockImplementationOnce(async () => ({
      error: '盲评结果校验未通过',
      metadata: { usage: { total_tokens: 17 } },
    }));
    callApi.mockImplementationOnce(async (prompt: string) => {
      const material = JSON.parse(prompt);
      const reviewed = goodReview(material);
      reviewed.answerA.severeErrors = [];
      reviewed.answerB.severeErrors = [{ quote: material.answerB, reason: '错误惩罚正常象征倾向' }];
      return { output: JSON.stringify(reviewed) };
    });
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      total: 12,
      valid: 11,
      preferenceRecognition: 11,
      errorRecognition: 10,
      goodAnswerFalsePositives: 1,
      passed: 10,
      allPassed: false,
    });
    expect(callApi).toHaveBeenCalledTimes(12);
  });

  it('refuses changed frozen materials and a changed run policy without sending a request', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    await expect(
      calibrateReadingReview([
        ...args().map((value) => (value === 'fixture-reviewer' ? 'different-model' : value)),
        '--run',
      ]),
    ).rejects.toThrow('配置');
    const location = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(location, 'utf8'));
    manifest.pairs[0].input.answerA += 'changed';
    await writeFile(location, JSON.stringify(manifest));
    await expect(calibrateReadingReview([...args(), '--run'])).rejects.toThrow('冻结');
    expect(callApi).not.toHaveBeenCalled();
  });

  it('bounds parallel calls and records a thrown failure without retrying or losing other pairs', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    const options = [...args(), '--concurrency', '3'];
    await calibrateReadingReview(options);
    let active = 0;
    let maximum = 0;
    let requests = 0;
    callApi.mockImplementation(async (prompt: string) => {
      active++;
      maximum = Math.max(maximum, active);
      requests++;
      const request = requests;
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      if (request === 1) throw new Error('secret transport detail');
      return { output: JSON.stringify(goodReview(JSON.parse(prompt))) };
    });
    await calibrateReadingReview([...options, '--run']);
    expect(maximum).toBe(3);
    expect(callApi).toHaveBeenCalledTimes(12);
    const results = await readFile(path.join(directory, 'results.json'), 'utf8');
    expect(results).not.toContain('secret transport detail');
    expect(JSON.parse(results)).toHaveLength(12);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({ valid: 11, invalid: 1, passed: 11, allPassed: false });
  });

  it('accepts full source-line severe evidence containing the expected failure and counts a tie separately', async () => {
    const { calibrateReadingReview } = await import('../scripts/calibrate-reading-review');
    await calibrateReadingReview(args());
    callApi.mockImplementationOnce(async (prompt: string) => {
      const material = JSON.parse(prompt);
      const reviewed = goodReview(material);
      reviewed.answerB.severeErrors = [{ quote: material.answerB, reason: '完整原行包含预期错误' }];
      return { output: JSON.stringify({ ...reviewed, winner: 'tie' }) };
    });
    await calibrateReadingReview([...args(), '--run']);
    const summary = JSON.parse(await readFile(path.join(directory, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({
      valid: 12,
      preferenceRecognition: 11,
      errorRecognition: 12,
      passed: 11,
      allPassed: false,
    });
  });
});
