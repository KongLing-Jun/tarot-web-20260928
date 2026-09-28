import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseReadingReview, REVIEW_DIMENSIONS } from './reading-review-provider.mjs';
import type { ReviewScope } from './prepare-reading-review';

type Side = 'left' | 'right';
interface Pair {
  id: string;
  scenarioId: string;
  attempt: number;
  category: string;
  A: Side;
  B: Side;
}
interface ReviewKey {
  pairs: Pair[];
  scope?: ReviewScope;
}
interface ReviewRow {
  testCase?: { description?: string };
  error?: string;
  response?: { output?: string; error?: string };
  vars?: { scenario?: string | Record<string, unknown>; answerA?: string; answerB?: string };
}
interface Export {
  results: { results: ReviewRow[] };
}

const fraction = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  rate: denominator ? numerator / denominator : null,
});

/** Invalid reviews stay in the conservative denominator, but never become losses or ties. */
export function summarizeReadingReview(exported: Export, key: ReviewKey) {
  if (!Array.isArray(exported.results?.results) || !Array.isArray(key.pairs))
    throw new Error('评审记录格式错误');
  const pairIds = new Set(key.pairs.map((pair) => pair.id));
  if (
    pairIds.size !== key.pairs.length ||
    key.pairs.some(
      (pair) =>
        !['left', 'right'].includes(pair.A) ||
        !['left', 'right'].includes(pair.B) ||
        pair.A === pair.B,
    )
  )
    throw new Error('匿名映射无效');
  if (key.scope) {
    const scope = key.scope;
    if (
      scope.version !== 1 ||
      !['frozen-plan', 'observed-results'].includes(scope.basis) ||
      !Array.isArray(scope.entries)
    )
      throw new Error('评审范围无效');
    const attempts = new Set<string>();
    const selected = new Set<string>();
    for (const entry of scope.entries) {
      const id = `${entry.scenarioId}-${entry.attempt}`;
      if (
        !entry.scenarioId ||
        !Number.isSafeInteger(entry.attempt) ||
        entry.attempt <= 0 ||
        attempts.has(id) ||
        typeof entry.leftStatus !== 'string' ||
        typeof entry.rightStatus !== 'string' ||
        (entry.reason !== null && (typeof entry.reason !== 'string' || !entry.reason)) ||
        (entry.reason === null &&
          (entry.leftStatus !== 'success' || entry.rightStatus !== 'success'))
      )
        throw new Error('范围尝试记录无效');
      attempts.add(id);
      if (entry.reviewPairId !== undefined) {
        const pair = key.pairs.find((pair) => pair.id === entry.reviewPairId);
        if (
          !pair ||
          entry.reason !== null ||
          selected.has(pair.id) ||
          pair.scenarioId !== entry.scenarioId ||
          pair.attempt !== entry.attempt
        )
          throw new Error('范围与匿名映射不一致');
        selected.add(pair.id);
      }
    }
    if (selected.size !== key.pairs.length) throw new Error('评审范围缺少已选配对');
  }
  const rows = new Map<string, ReviewRow>();
  for (const row of exported.results.results) {
    const id = row.testCase?.description;
    if (!id || !pairIds.has(id) || rows.has(id)) throw new Error('评审编号缺失、未知或重复');
    rows.set(id, row);
  }
  const arm = () => ({
    wins: 0,
    directInFirstTwo: 0,
    answersWithSevereErrors: 0,
    scores: Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, 0])),
  });
  const sides = { left: arm(), right: arm() };
  const failures: { pair: string; reason: string }[] = [];
  const evidence: {
    pair: string;
    scenarioId: string;
    attempt: number;
    category: string;
    winner: Side | 'tie';
    winnerReason: string;
    severeErrors: { side: Side; quote: string; reason: string }[];
  }[] = [];
  let ties = 0;
  for (const pair of key.pairs) {
    const row = rows.get(pair.id);
    if (!row?.response?.output || row.error || row.response.error) {
      failures.push({ pair: pair.id, reason: row ? 'review-error' : 'missing-review' });
      continue;
    }
    try {
      const vars = row.vars;
      const input = {
        scenario: typeof vars?.scenario === 'string' ? JSON.parse(vars.scenario) : vars?.scenario,
        answerA: vars?.answerA,
        answerB: vars?.answerB,
      };
      const review = parseReadingReview(row.response.output, input);
      const winner = review.winner === 'tie' ? 'tie' : pair[review.winner as 'A' | 'B'];
      if (winner === 'tie') ties++;
      else sides[winner].wins++;
      const severeErrors: { side: Side; quote: string; reason: string }[] = [];
      for (const label of ['A', 'B'] as const) {
        const answer = review[`answer${label}`];
        const side = sides[pair[label]];
        if (answer.scores.directAnswer === 2 && answer.firstTwoSentencesAnswer)
          side.directInFirstTwo++;
        if (answer.severeErrors.length) side.answersWithSevereErrors++;
        for (const dimension of REVIEW_DIMENSIONS)
          side.scores[dimension] += answer.scores[dimension];
        severeErrors.push(
          ...answer.severeErrors.map((entry: { quote: string; reason: string }) => ({
            side: pair[label],
            ...entry,
          })),
        );
      }
      evidence.push({
        pair: pair.id,
        scenarioId: pair.scenarioId,
        attempt: pair.attempt,
        category: pair.category,
        winner,
        winnerReason: review.winnerReason,
        severeErrors,
      });
    } catch {
      failures.push({ pair: pair.id, reason: 'invalid-review' });
    }
  }
  const valid = evidence.length;
  const total = key.pairs.length;
  const invalid = failures.length;
  const scopeTotal = key.scope?.entries.length ?? 0;
  const eligible = key.scope?.entries.filter((entry) => entry.reason === null).length ?? 0;
  return {
    totalPairs: total,
    validReviews: valid,
    invalidReviews: invalid,
    ties,
    failures,
    formatValidity: fraction(valid, total),
    sides: Object.fromEntries(
      (['left', 'right'] as const).map((side) => [
        side,
        {
          ...sides[side],
          losses: sides[side === 'left' ? 'right' : 'left'].wins,
          ties,
          invalid,
          conservativeWinsAllPairs: fraction(sides[side].wins, total),
          validOnlyWins: fraction(sides[side].wins, valid),
          winRateAllPairs: fraction(sides[side].wins, total).rate,
          directRateValidReviews: valid ? sides[side].directInFirstTwo / valid : null,
          averageScores: Object.fromEntries(
            REVIEW_DIMENSIONS.map((dimension) => [
              dimension,
              valid ? sides[side].scores[dimension] / valid : null,
            ]),
          ),
        },
      ]),
    ),
    evidence,
    scope: key.scope
      ? {
          basis: key.scope.basis,
          totalAttempts: scopeTotal,
          eligiblePairs: eligible,
          unpairableAttempts: scopeTotal - eligible,
          unselectedEligiblePairs: eligible - total,
          pairingRate: fraction(eligible, scopeTotal),
          reviewCoverage: fraction(valid, scopeTotal),
          sides: Object.fromEntries(
            (['left', 'right'] as const).map((side) => [
              side,
              {
                generationSuccess: fraction(
                  key.scope!.entries.filter((entry) => entry[`${side}Status`] === 'success').length,
                  scopeTotal,
                ),
                missingResults: key.scope!.entries.filter(
                  (entry) => entry[`${side}Status`] === 'missing',
                ).length,
                observedWinsInScope: fraction(sides[side].wins, scopeTotal),
                observedWinsInPlannedAttempts:
                  key.scope!.basis === 'frozen-plan'
                    ? fraction(sides[side].wins, scopeTotal)
                    : null,
              },
            ]),
          ),
          failures: key.scope.entries.filter((entry) => entry.reason !== null),
        }
      : null,
    metricDefinitions: {
      formatValidity: '通过格式及引用核验的评审数 / 全部配对数；不表示裁判语义判断正确。',
      conservativeWinsAllPairs:
        '本方获胜数 / 已选入评审的配对数；平局与无效评审均保留在分母，无效不计为落败。与旧字段 winRateAllPairs 相同，不含生成失败或 --limit 未选中的配对。',
      validOnlyWins:
        '本方获胜数 / 有效评审数；保留平局，仅排除无效评审，不能单独用于隐去裁判失败。',
      losses: '有效评审中明确判定另一方获胜的次数。wins + losses + ties + invalid = totalPairs。',
      scope:
        '场景与 attempt 筛选后的比较范围，在 --limit 前冻结；frozen-plan 来自双方冻结尝试次数，observed-results 仅是历史记录可观察范围，可能遗漏双方都缺失的尝试。旧 blind-key 没有范围时为 null。',
      generationSuccess:
        '本方 status=success 的生成记录数 / 范围尝试数；不表示语义质量通过，也不保证回答文件存在或可配对。',
      pairingRate: '回答非空且冻结场景一致的成功配对数 / 范围尝试数。',
      reviewCoverage: '有效评审数 / 范围尝试数；未选入、生成失败和裁判失败均降低覆盖率。',
      observedWinsInScope:
        '已观察到的本方胜出数 / 范围尝试数；包含生成失败、缺失和未选评审，是胜出占比下界，不是抽样估计的全量胜率。',
      observedWinsInPlannedAttempts:
        '仅 frozen-plan 范围提供计划分母的已观察胜出占比；历史计划不明时为 null，筛选范围不代表整套题集。',
    },
    warning:
      '模型裁判结果，需要人工校准；裁判失败不算落败、平局或胜出。未获胜的配对可能是落败、平局或无效，未评审回答不代表没有严重错误。此汇总不是上线许可。',
  };
}

async function main() {
  const [results, key, output, ...extra] = process.argv.slice(2);
  if (!results || !key || !output || extra.length)
    throw new Error(
      '用法：tsx scripts/summarize-reading-review.ts <review-results.json> <blind-key.json> <summary.json>',
    );
  const [data, mapping] = await Promise.all(
    [results, key].map((file) => readFile(file, 'utf8').then(JSON.parse)),
  );
  await writeFile(output, JSON.stringify(summarizeReadingReview(data, mapping), null, 2), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('评审汇总失败，请检查输入记录与匿名映射。');
    process.exitCode = 1;
  });
}
