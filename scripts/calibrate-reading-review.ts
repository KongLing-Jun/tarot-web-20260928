import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ReadingReviewProvider, {
  buildReadingReviewPrompt,
  parseReadingReview,
  parseReadingActionReview,
  READING_REVIEW_RUBRIC,
  READING_REVIEW_RUBRIC_HASH,
} from './reading-review-provider.mjs';
import {
  ACTION_REVIEW_DIMENSIONS,
  ACTION_REVIEW_RUBRIC,
  ACTION_REVIEW_RUBRIC_HASH,
} from './reading-action-rubric.mjs';
import type { ReadingReviewCalibrationCase } from '../tests/fixtures/reading-review-calibration';
import type { ReadingActionCalibrationCase } from '../tests/fixtures/reading-action-calibration';
import type { ReadingActionCalibrationV2Case } from '../tests/fixtures/reading-action-calibration-v2';
import {
  ACTION_V2_REVIEW_RUBRIC,
  ACTION_V2_REVIEW_RUBRIC_HASH,
} from './reading-action-v2-rubric.mjs';
import { assessActionV2Calibration, validateActionV2Case } from './reading-action-v2-assessment';

type ReviewProfile = 'general' | 'action-v1' | 'action-v2';
interface Policy {
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  maxRequests: number;
  concurrency: number;
  reviewProfile?: 'action-v1' | 'action-v2';
}
interface Pair {
  id: string;
  input: {
    scenario: ReadingReviewCalibrationCase['scenario'] | ReadingActionCalibrationCase['scenario'];
    answerA: string;
    answerB: string;
  };
  goodSide: 'A' | 'B';
  expectedFailure:
    | ReadingReviewCalibrationCase['expectedFailure']
    | ReadingActionCalibrationCase['expectedFailure'];
  expectedScores?: ReadingActionCalibrationCase['expectedScores'];
  actionNeed?: ReadingActionCalibrationCase['actionNeed'];
  caseId?: string;
  source?: ReadingActionCalibrationV2Case['source'];
  annotation?: string;
  expectedJointScores?: ReadingActionCalibrationV2Case['expectedJointScores'];
  severeErrors?: ReadingActionCalibrationV2Case['severeErrors'];
}
interface Frozen {
  kind: 'reviewer-calibration' | 'action-reviewer-calibration' | 'action-reviewer-materials';
  schemaVersion: 1;
  config: Policy | null;
  rubric: string;
  rubricHash: string;
  pairs: Pair[];
  reviewProfile?: 'action-v2';
  datasetRole?: 'development-calibration';
}
interface Assessment {
  preferenceRecognized: boolean;
  errorRecognized: boolean;
  goodAnswerFalsePositive: boolean;
  passed: boolean;
  absoluteScoreRecognized?: boolean;
  actionNeedRecognized?: boolean;
  goodAnswerScoreFalsePositive?: boolean;
  unexpectedSevereError?: boolean;
}
interface Result {
  id: string;
  status: 'valid' | 'invalid';
  error?: string;
  review?: ReturnType<typeof parseReadingReview>;
  assessment?: Assessment;
  metadata?: Record<string, unknown>;
  tokenUsage?: Record<string, number>;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save = (location: string, value: unknown) =>
  writeFile(location, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

function parseOptions(args: string[]): {
  config: Policy | null;
  output: string;
  run: boolean;
  profile: ReviewProfile;
} {
  const allowed = new Set([
    '--model',
    '--timeout-ms',
    '--max-output-tokens',
    '--max-requests',
    '--output',
    '--concurrency',
    '--run',
    '--rubric',
    '--materials-only',
  ]);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.has(key) || options.has(key)) throw new Error('校准参数无效或重复。');
    if (key === '--run' || key === '--materials-only') {
      options.set(key, 'true');
      continue;
    }
    const value = args[++index];
    if (!value?.trim() || value.startsWith('--')) throw new Error('校准参数缺少值。');
    options.set(key, value);
  }
  const profile = options.get('--rubric') ?? 'general';
  if (profile !== 'general' && profile !== 'action-v1' && profile !== 'action-v2')
    throw new Error('未知裁判评分规范。');
  if (options.has('--materials-only')) {
    if (
      profile !== 'action-v2' ||
      !options.has('--output') ||
      [...options.keys()].some((key) => !['--rubric', '--materials-only', '--output'].includes(key))
    )
      throw new Error('仅准备 v2 材料时不能指定运行或调用预算。');
    return { config: null, output: path.resolve(options.get('--output')!), run: false, profile };
  }
  if (!options.has('--model') || !options.has('--output'))
    throw new Error('必须显式提供裁判模型与输出目录。');
  const number = (key: string, fallback?: number) => {
    const value = options.has(key) ? Number(options.get(key)) : fallback;
    if (!Number.isSafeInteger(value) || value! < 1)
      throw new Error('必须显式提供正整数裁判预算，concurrency 也须为正整数。');
    return value!;
  };
  const config: Policy = {
    model: options.get('--model')!.trim(),
    timeoutMs: number('--timeout-ms'),
    maxOutputTokens: number('--max-output-tokens'),
    maxRequests: number('--max-requests'),
    concurrency: number('--concurrency', 2),
    ...(profile === 'general' ? {} : { reviewProfile: profile }),
  };
  if (config.timeoutMs > 2_147_483_647) throw new Error('timeout-ms 超出定时器范围。');
  return {
    config,
    output: path.resolve(options.get('--output')!),
    run: options.has('--run'),
    profile,
  };
}

async function makePairs(profile: ReviewProfile): Promise<Pair[]> {
  // Do not load the legacy mixed development/holdout module for action-only calibration.
  const cases =
    profile === 'action-v2'
      ? (await import('../tests/fixtures/reading-action-calibration-v2'))
          .readingActionCalibrationV2Cases
      : profile === 'action-v1'
        ? (await import('../tests/fixtures/reading-action-calibration'))
            .readingActionCalibrationCases
        : (await import('../tests/fixtures/reading-review-calibration'))
            .readingReviewCalibrationCases;
  if (profile === 'action-v2') {
    if (new Set(cases.map((entry) => entry.id)).size !== cases.length)
      throw new Error('v2 校准场景 ID 重复');
    cases.forEach(validateActionV2Case);
  }
  return cases.flatMap((entry, index) =>
    ([false, true] as const).map((swapped) => ({
      id: `calibration-${String(index + 1).padStart(3, '0')}-${swapped ? 'ba' : 'ab'}`,
      input: {
        scenario: entry.scenario,
        answerA: swapped ? entry.badAnswer : entry.goodAnswer,
        answerB: swapped ? entry.goodAnswer : entry.badAnswer,
      },
      goodSide: swapped ? ('B' as const) : ('A' as const),
      expectedFailure: entry.expectedFailure,
      ...('expectedScores' in entry
        ? { expectedScores: entry.expectedScores, actionNeed: entry.actionNeed }
        : {}),
      ...('expectedJointScores' in entry
        ? {
            expectedJointScores: entry.expectedJointScores,
            severeErrors: entry.severeErrors,
            actionNeed: entry.actionNeed,
            caseId: entry.id,
            source: entry.source,
            annotation: entry.annotation,
          }
        : {}),
    })),
  );
}

function assess(review: ReturnType<typeof parseReadingReview>, pair: Pair): Assessment {
  if (pair.expectedJointScores && pair.severeErrors && pair.actionNeed) {
    return assessActionV2Calibration(review, {
      expectedJointScores: pair.expectedJointScores,
      severeErrors: pair.severeErrors,
      expectedFailure: pair.expectedFailure as ReadingActionCalibrationV2Case['expectedFailure'],
      actionNeed: pair.actionNeed,
      goodSide: pair.goodSide,
    });
  }
  const good = review[`answer${pair.goodSide}`];
  const bad = review[pair.goodSide === 'A' ? 'answerB' : 'answerA'];
  const preferenceRecognized = review.winner === pair.goodSide;
  const goodAnswerFalsePositive = good.severeErrors.length > 0;
  const errorRecognized =
    bad.scores[pair.expectedFailure.dimension] < good.scores[pair.expectedFailure.dimension] &&
    (!['faithfulness', 'groundedConditions'].includes(pair.expectedFailure.dimension) ||
      bad.severeErrors.some((entry: { quote: string }) =>
        entry.quote.includes(pair.expectedFailure.quote),
      ));
  if (pair.expectedScores) {
    const absoluteScoreRecognized =
      isDeepStrictEqual(good.scores, pair.expectedScores.good) &&
      isDeepStrictEqual(bad.scores, pair.expectedScores.bad);
    const actionNeedRecognized =
      good.actionNeed === pair.actionNeed && bad.actionNeed === pair.actionNeed;
    const unexpectedSevereError = bad.severeErrors.some(
      (entry: { quote: string }) =>
        pair.expectedFailure.dimension !== 'groundedConditions' ||
        !entry.quote.includes(pair.expectedFailure.quote),
    );
    const goodAnswerScoreFalsePositive = ACTION_REVIEW_DIMENSIONS.some((dimension) => {
      const expected =
        pair.expectedScores!.good[
          dimension as keyof ReadingActionCalibrationCase['expectedScores']['good']
        ];
      return (
        expected !== null && (good.scores[dimension] === null || good.scores[dimension] < expected)
      );
    });
    return {
      preferenceRecognized,
      errorRecognized,
      goodAnswerFalsePositive,
      absoluteScoreRecognized,
      actionNeedRecognized,
      goodAnswerScoreFalsePositive,
      unexpectedSevereError,
      passed:
        preferenceRecognized &&
        errorRecognized &&
        !goodAnswerFalsePositive &&
        !unexpectedSevereError &&
        absoluteScoreRecognized &&
        actionNeedRecognized,
    };
  }
  return {
    preferenceRecognized,
    errorRecognized,
    goodAnswerFalsePositive,
    passed: preferenceRecognized && errorRecognized && !goodAnswerFalsePositive,
  };
}

function summarize(results: Result[], pairs: Pair[], profile: ReviewProfile) {
  const action = profile !== 'general';
  const total = results.length;
  const valid = results.filter((result) => result.status === 'valid').length;
  const count = (key: keyof Assessment) =>
    results.filter((result) => result.assessment?.[key]).length;
  const preferenceRecognition = count('preferenceRecognized');
  const errorRecognition = count('errorRecognized');
  const passed = count('passed');
  const base = {
    kind: action ? 'action-reviewer-calibration' : 'reviewer-calibration',
    total,
    valid,
    invalid: total - valid,
    validityRate: valid / total,
    preferenceRecognition,
    preferenceRecognitionRate: preferenceRecognition / total,
    preferenceRecognitionRateAmongValid: valid ? preferenceRecognition / valid : null,
    errorRecognition,
    errorRecognitionRate: errorRecognition / total,
    errorRecognitionRateAmongValid: valid ? errorRecognition / valid : null,
    goodAnswerFalsePositives: count('goodAnswerFalsePositive'),
    passed,
    allPassed: passed === total,
    note: '手写裁判校准；比例分别衡量格式有效、正确偏好和错误识别，不是 P1 候选胜率。全部请求保留在总分母中。',
  };
  if (!action) return base;
  let scenariosPassed = 0,
    swapConsistentScenarios = 0;
  for (let index = 0; index < pairs.length; index += 2) {
    const first = results[index],
      second = results[index + 1];
    if (first.assessment?.passed && second.assessment?.passed) scenariosPassed++;
    if (
      first.review &&
      second.review &&
      first.review.winner ===
        (second.review.winner === 'A' ? 'B' : second.review.winner === 'B' ? 'A' : 'tie') &&
      (['A', 'B'] as const).every((side) => {
        const a = first.review![`answer${side}`],
          b = second.review![side === 'A' ? 'answerB' : 'answerA'];
        return (
          isDeepStrictEqual(a.scores, b.scores) &&
          a.actionNeed === b.actionNeed &&
          isDeepStrictEqual(
            a.severeErrors.map((item: { quote: string }) => item.quote).sort(),
            b.severeErrors.map((item: { quote: string }) => item.quote).sort(),
          )
        );
      })
    )
      swapConsistentScenarios++;
  }
  return {
    ...base,
    absoluteScoreRecognition: count('absoluteScoreRecognized'),
    actionNeedRecognition: count('actionNeedRecognized'),
    ...(profile === 'action-v2'
      ? {
          reviewProfile: profile,
          datasetRole: 'development-calibration',
          automaticChecksPassed: base.allPassed,
          manualReviewRequired: true,
          candidateComparisonReady: false,
          sources: Object.fromEntries(
            ['revised-development', 'new-development'].map((source) => {
              const selected = results.filter((_, index) => pairs[index].source === source);
              return [
                source,
                {
                  total: selected.length,
                  passed: selected.filter((result) => result.assessment?.passed).length,
                },
              ];
            }),
          ),
        }
      : {}),
    unexpectedSevereErrors: count('unexpectedSevereError'),
    goodAnswerScoreFalsePositives: count('goodAnswerScoreFalsePositive'),
    scenarioCount: pairs.length / 2,
    scenariosPassed,
    swapConsistentScenarios,
    dimensions: Object.fromEntries(
      ACTION_REVIEW_DIMENSIONS.map((dimension) => {
        const relevant = results.filter(
          (_, index) => pairs[index].expectedFailure.dimension === dimension,
        );
        return [
          dimension,
          {
            total: relevant.length,
            passed: relevant.filter((result) => result.assessment?.passed).length,
          },
        ];
      }),
    ),
    note: `行动建议裁判开发校准；${pairs.length / 2} 个场景的换位请求不是${pairs.length}个独立样本。预先冻结的分值、错误证据、合理回答误报与换位一致性分别报告；不适用执行分为null，不计作满分。程序不验证理由语义，仍须人工复核；不是候选胜率或实际解读准确率。`,
  };
}

/** Default prepares frozen synthetic cases. Only --run can spend the explicit request budget. */
export async function calibrateReadingReview(args: string[]) {
  const { config, output, run, profile } = parseOptions(args);
  const action = profile !== 'general';
  const kind = action ? 'action-reviewer-calibration' : 'reviewer-calibration';
  const rubric =
    profile === 'action-v2'
      ? ACTION_V2_REVIEW_RUBRIC
      : action
        ? ACTION_REVIEW_RUBRIC
        : READING_REVIEW_RUBRIC;
  const rubricHash =
    profile === 'action-v2'
      ? ACTION_V2_REVIEW_RUBRIC_HASH
      : action
        ? ACTION_REVIEW_RUBRIC_HASH
        : READING_REVIEW_RUBRIC_HASH;
  const parse = action ? parseReadingActionReview : parseReadingReview;
  const manifestPath = path.join(output, 'manifest.json');
  if (!run) {
    const pairs = await makePairs(profile);
    if (config && pairs.length > config.maxRequests) throw new Error('校准请求数超过调用上限。');
    if (existsSync(manifestPath)) throw new Error('输出目录已有冻结校准材料，请使用新目录。');
    const frozen: Frozen = {
      kind: config ? kind : 'action-reviewer-materials',
      schemaVersion: 1,
      config,
      rubric,
      rubricHash,
      pairs,
      ...(profile === 'action-v2'
        ? ({ reviewProfile: 'action-v2', datasetRole: 'development-calibration' } as const)
        : {}),
    };
    for (const pair of pairs) buildReadingReviewPrompt(pair.input);
    await mkdir(output, { recursive: true });
    await save(manifestPath, {
      ...frozen,
      createdAt: new Date().toISOString(),
      materialHash: digest(frozen),
    });
    await writeFile(path.join(output, 'rubric.md'), frozen.rubric, { flag: 'wx' });
    return;
  }
  if (!config) throw new Error('材料准备不授权真实调用。');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const materialHash = manifest.materialHash;
  const frozen = { ...manifest };
  delete frozen.createdAt;
  delete frozen.materialHash;
  if (
    frozen.kind !== kind ||
    frozen.schemaVersion !== 1 ||
    materialHash !== digest(frozen) ||
    frozen.rubric !== rubric ||
    frozen.rubricHash !== rubricHash
  )
    throw new Error('冻结校准材料或裁判规范已改变，请重新准备。');
  if (!isDeepStrictEqual(frozen.config, config)) throw new Error('运行配置必须与冻结配置一致。');
  const pairs: Pair[] = frozen.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > config.maxRequests)
    throw new Error('校准请求数无效或超过调用上限。');
  for (const pair of pairs) {
    if (!/^calibration-\d+-(ab|ba)$/.test(pair.id) || !['A', 'B'].includes(pair.goodSide))
      throw new Error('冻结校准场景格式无效。');
    buildReadingReviewPrompt(pair.input);
    if (profile === 'action-v2')
      validateActionV2Case({
        ...pair,
        id: pair.caseId,
        goodAnswer: pair.input[pair.goodSide === 'A' ? 'answerA' : 'answerB'],
        badAnswer: pair.input[pair.goodSide === 'A' ? 'answerB' : 'answerA'],
      });
  }
  const provider = new ReadingReviewProvider({
    config: { ...config, rubricHash: frozen.rubricHash },
  });
  const startedPath = path.join(output, 'run-started.json');
  if (existsSync(startedPath)) throw new Error('已有校准运行记录；不自动重试，请保留失败结果。');
  await save(startedPath, { startedAt: new Date().toISOString(), materialHash });
  const results: Result[] = new Array(pairs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, pairs.length) }, async () => {
      while (next < pairs.length) {
        const index = next++;
        const pair = pairs[index];
        const response: Awaited<ReturnType<ReadingReviewProvider['callApi']>> = await provider
          .callApi(JSON.stringify(pair.input))
          .catch(() => ({ error: '校准调用失败；未自动重试' }));
        const result: Result = {
          id: pair.id,
          status: 'invalid',
          metadata: response.metadata,
          tokenUsage: response.tokenUsage,
        };
        if (response.error || !response.output) result.error = response.error ?? '裁判未返回结果';
        else {
          try {
            result.review = parse(response.output, pair.input);
            result.assessment = assess(result.review, pair);
            result.status = 'valid';
          } catch {
            result.error = '校准结果校验未通过';
          }
        }
        results[index] = result;
        await save(path.join(output, `${pair.id}.json`), result);
      }
    }),
  );
  const summary = summarize(results, pairs, profile);
  await save(path.join(output, 'results.json'), results);
  await save(path.join(output, 'summary.json'), summary);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  calibrateReadingReview(process.argv.slice(2))
    .then((summary) => {
      if (summary) {
        console.log(JSON.stringify(summary, null, 2));
        if (!summary.allPassed) process.exitCode = 1;
      } else
        console.log(
          process.argv.includes('--materials-only')
            ? 'v2 开发校准材料已冻结；未指定模型或调用预算，不能直接运行。'
            : '校准材料已冻结；尚未调用模型。使用相同参数加 --run 执行。',
        );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : '校准失败');
      process.exitCode = 1;
    });
}
