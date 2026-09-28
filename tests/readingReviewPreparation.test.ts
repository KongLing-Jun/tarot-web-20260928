// @vitest-environment node
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareReadingReview } from '../scripts/prepare-reading-review';
import {
  buildReadingReviewPrompt,
  READING_REVIEW_RUBRIC,
  READING_REVIEW_RUBRIC_HASH,
} from '../scripts/reading-review-provider.mjs';

describe('reading review preparation', () => {
  let root: string;
  const args = () => [
    '--left',
    path.join(root, 'private-p0'),
    '--right',
    path.join(root, 'private-p1'),
    '--output',
    path.join(root, 'review'),
    '--model',
    'judge-model',
    '--timeout-ms',
    '1000',
    '--max-output-tokens',
    '2000',
    '--max-requests',
    '20',
    '--seed',
    'fixture-seed',
  ];
  const scenario = (id: string, category = 'judgment') => ({
    id,
    source: 'synthetic',
    category,
    question: `问题 ${id}`,
    drawnCards: [{ card: { id: 'pentacles-07' }, isReversed: false, position: { id: 'present' } }],
    goal: '回答问题',
    knownFacts: ['已发送消息'],
    review: ['不可编造事实'],
  });
  async function fixture(side: string, cases = [scenario('case-1')], status = 'success') {
    const dir = path.join(root, side);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        model: side,
        profile: side,
        revision: side,
        cases: cases.map((item) => ({ scenario: item })),
      }),
    );
    await writeFile(
      path.join(dir, 'results.json'),
      JSON.stringify(cases.map((item) => ({ id: `${item.id}-1`, status }))),
    );
    for (const item of cases)
      await writeFile(
        path.join(dir, `${item.id}-1.md`),
        side === 'private-p0' ? '先关注你自己的感受。' : '目前更倾向等不到明确回复。',
      );
  }
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'reading-review-'));
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });
  it('prepares anonymous pairs and explicit provider limits without networking', async () => {
    await fixture('private-p0');
    await fixture('private-p1');
    await prepareReadingReview(args());
    const dir = path.join(root, 'review');
    const configText = await readFile(path.join(dir, 'promptfoo.json'), 'utf8');
    const config = JSON.parse(configText);
    expect(config.providers[0].config).toEqual({
      model: 'judge-model',
      timeoutMs: 1000,
      maxOutputTokens: 2000,
      maxRequests: 20,
      rubricHash: READING_REVIEW_RUBRIC_HASH,
    });
    expect(await readFile(path.join(dir, 'review-rubric.md'), 'utf8')).toBe(READING_REVIEW_RUBRIC);
    expect(config.tests).toHaveLength(1);
    // Promptfoo treats a slash in a plain prompt string as a file-path candidate.
    expect(config.prompts).toEqual(['请依据场景事实和回答甲、乙进行盲评。']);
    expect(config.prompts[0]).not.toMatch(/[\\/]/);
    const reviewInput = {
      ...config.tests[0].vars,
      scenario: JSON.parse(config.tests[0].vars.scenario),
    };
    expect(JSON.parse(buildReadingReviewPrompt(reviewInput)).case.cards).toEqual(
      scenario('case-1').drawnCards,
    );
    expect(new Set([config.tests[0].vars.answerA, config.tests[0].vars.answerB])).toEqual(
      new Set(['先关注你自己的感受。', '目前更倾向等不到明确回复。']),
    );
    const blind = await readFile(path.join(dir, 'blind.md'), 'utf8');
    for (const value of ['private-p0', 'private-p1', root]) {
      expect(configText).not.toContain(value);
      expect(blind).not.toContain(value);
    }
    expect(blind).toContain('问题 case-1');
    expect(blind).toContain('已发送消息');
    expect(JSON.parse(await readFile(path.join(dir, 'blind-key.json'), 'utf8')).pairs).toHaveLength(
      1,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains failed and mismatched pairs instead of presenting them as scored successes', async () => {
    const cases = [scenario('case-1'), scenario('case-2'), scenario('case-3')];
    await fixture('private-p0', cases);
    await fixture('private-p1', [{ ...cases[0], goal: '另一目标' }, cases[1], cases[2]]);
    await writeFile(
      path.join(root, 'private-p1', 'results.json'),
      JSON.stringify([
        { id: 'case-1-1', status: 'success' },
        { id: 'case-2-1', status: 'http-429' },
      ]),
    );
    await prepareReadingReview(args());
    const config = JSON.parse(await readFile(path.join(root, 'review', 'promptfoo.json'), 'utf8'));
    expect(config.tests).toHaveLength(0);
    const failures = JSON.parse(await readFile(path.join(root, 'review', 'failures.json'), 'utf8'));
    expect(failures).toHaveLength(3);
    expect(failures.map((item: { reason: string }) => item.reason)).toEqual(
      expect.arrayContaining(['scenario-mismatch', 'non-success', 'missing-result']),
    );
  });
  it('samples ten human pairs with all categories covered and deterministic A/B for a seed', async () => {
    const cases = Array.from({ length: 12 }, (_, i) =>
      scenario(`case-${i + 1}`, `category-${i % 6}`),
    );
    await fixture('private-p0', cases);
    await fixture('private-p1', cases);
    await prepareReadingReview(args());
    const second = args();
    second[second.indexOf('--output') + 1] = path.join(root, 'again');
    await prepareReadingReview(second);
    const firstBlind = await readFile(path.join(root, 'review', 'blind.md'), 'utf8');
    expect(await readFile(path.join(root, 'again', 'blind.md'), 'utf8')).toBe(firstBlind);
    const human = await readFile(path.join(root, 'review', 'human-review.md'), 'utf8');
    expect(human.match(/## pair-/g)).toHaveLength(10);
    for (let i = 0; i < 6; i++) expect(human).toContain(`category-${i}`);
  });
  it('swaps every A/B answer for order-bias checks without changing pairs or exposing expected winners', async () => {
    const cases = [{ ...scenario('case-1'), expectedWinner: 'private-p1' }];
    await fixture('private-p0', cases);
    await fixture('private-p1', cases);
    await prepareReadingReview(args());
    const second = args();
    second[second.indexOf('--output') + 1] = path.join(root, 'swapped');
    await prepareReadingReview([...second, '--swap']);
    const config = JSON.parse(await readFile(path.join(root, 'review', 'promptfoo.json'), 'utf8'));
    const swapped = JSON.parse(
      await readFile(path.join(root, 'swapped', 'promptfoo.json'), 'utf8'),
    );
    expect(swapped.tests[0].description).toBe(config.tests[0].description);
    expect(swapped.tests[0].vars.answerA).toBe(config.tests[0].vars.answerB);
    expect(swapped.tests[0].vars.answerB).toBe(config.tests[0].vars.answerA);
    expect(config.tests[0].vars.scenario).not.toContain('expectedWinner');
    expect(config.tests[0].vars.scenario).not.toContain('private-p1');
  });
  it.each([
    ['--model', ' '],
    ['--max-requests', '0'],
    ['--timeout-ms', 'NaN'],
    ['--attempt', '0'],
  ])('rejects invalid %s without requests', async (flag, value) => {
    const input = args();
    const index = input.indexOf(flag);
    if (index < 0) input.push(flag, value);
    else input[index + 1] = value;
    await expect(prepareReadingReview(input)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preflights judge budget and refuses overwriting prepared evidence', async () => {
    await fixture('private-p0', [scenario('case-1'), scenario('case-2')]);
    await fixture('private-p1', [scenario('case-1'), scenario('case-2')]);
    const input = args();
    input[input.indexOf('--max-requests') + 1] = '1';
    await expect(prepareReadingReview(input)).rejects.toThrow('上限');
    await prepareReadingReview(args());
    await expect(prepareReadingReview(args())).rejects.toThrow('已有');
  });
  it('filters selected scenario and attempt before applying the pair limit', async () => {
    await fixture('private-p0', [scenario('case-1'), scenario('case-2')]);
    await fixture('private-p1', [scenario('case-1'), scenario('case-2')]);
    await prepareReadingReview([
      ...args(),
      '--scenarios',
      'case-2',
      '--attempt',
      '1',
      '--limit',
      '1',
    ]);
    const key = JSON.parse(await readFile(path.join(root, 'review', 'blind-key.json'), 'utf8'));
    expect(key.pairs).toHaveLength(1);
    expect(key.pairs[0].scenarioId).toBe('case-2');
  });
  it('keeps planned missing attempts and generation failures in scope when limiting reviews', async () => {
    const cases = [scenario('case-1'), scenario('case-2')];
    for (const side of ['private-p0', 'private-p1']) {
      await fixture(side, cases);
      await writeFile(
        path.join(root, side, 'manifest.json'),
        JSON.stringify({ attempts: 2, cases: cases.map((item) => ({ scenario: item })) }),
      );
    }
    await writeFile(
      path.join(root, 'private-p1', 'results.json'),
      JSON.stringify([
        { id: 'case-1-1', status: 'success' },
        { id: 'case-2-1', status: 'timeout' },
      ]),
    );
    await prepareReadingReview([...args(), '--limit', '1']);
    const key = JSON.parse(await readFile(path.join(root, 'review', 'blind-key.json'), 'utf8'));
    expect(key.scope.basis).toBe('frozen-plan');
    expect(key.scope.entries).toHaveLength(4);
    expect(key.scope.entries).toContainEqual(
      expect.objectContaining({
        scenarioId: 'case-2',
        attempt: 1,
        leftStatus: 'success',
        rightStatus: 'timeout',
        reason: 'non-success',
      }),
    );
    expect(key.scope.entries.filter((entry: { attempt: number }) => entry.attempt === 2)).toEqual([
      expect.objectContaining({
        leftStatus: 'missing',
        rightStatus: 'missing',
        reason: 'missing-result',
      }),
      expect.objectContaining({
        leftStatus: 'missing',
        rightStatus: 'missing',
        reason: 'missing-result',
      }),
    ]);
    expect(key.failures).toBe(3);
  });
  it('marks legacy scope as observed and keeps eligible pairs excluded by the review limit', async () => {
    for (const side of ['private-p0', 'private-p1'])
      await fixture(side, [scenario('case-1'), scenario('case-2')]);
    await prepareReadingReview([...args(), '--limit', '1']);
    const key = JSON.parse(await readFile(path.join(root, 'review', 'blind-key.json'), 'utf8'));
    expect(key.scope.basis).toBe('observed-results');
    expect(key.scope.entries).toHaveLength(2);
    expect(
      key.scope.entries.filter((entry: { reviewPairId?: string }) => entry.reviewPairId),
    ).toHaveLength(1);
    expect(key.eligiblePairs).toBe(2);
  });
  it('applies explicit scope filters to frozen attempts before sampling', async () => {
    const cases = [scenario('case-1'), scenario('case-2')];
    for (const side of ['private-p0', 'private-p1']) {
      await fixture(side, cases);
      await writeFile(
        path.join(root, side, 'manifest.json'),
        JSON.stringify({ attempts: 2, cases: cases.map((item) => ({ scenario: item })) }),
      );
    }
    await prepareReadingReview([...args(), '--scenarios', 'case-2', '--attempt', '2']);
    const key = JSON.parse(await readFile(path.join(root, 'review', 'blind-key.json'), 'utf8'));
    expect(key.scope.entries).toEqual([
      {
        scenarioId: 'case-2',
        attempt: 2,
        leftStatus: 'missing',
        rightStatus: 'missing',
        reason: 'missing-result',
      },
    ]);
    expect(key.pairs).toEqual([]);
  });
  it('rejects results outside their frozen attempt plan', async () => {
    for (const side of ['private-p0', 'private-p1']) {
      await fixture(side);
      await writeFile(
        path.join(root, side, 'manifest.json'),
        JSON.stringify({ attempts: 1, cases: [{ scenario: scenario('case-1') }] }),
      );
    }
    await writeFile(
      path.join(root, 'private-p0', 'results.json'),
      JSON.stringify([{ id: 'case-1-2', status: 'success' }]),
    );
    await expect(prepareReadingReview(args())).rejects.toThrow('冻结计划');
  });
});
