import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { READING_REVIEW_RUBRIC, READING_REVIEW_RUBRIC_HASH } from './reading-review-provider.mjs';

type Scenario = Record<string, unknown> & { id: string; category?: string };
interface Result {
  id: string;
  status: string;
}
interface Run {
  directory: string;
  scenarios: Map<string, Scenario>;
  results: Map<string, Result>;
  manifest: Record<string, unknown>;
}
interface Pair {
  id: string;
  scenarioId: string;
  attempt: number;
  category: string;
  scenario: Record<string, unknown>;
  answerA: string;
  answerB: string;
  aIsLeft: boolean;
}
interface Failure {
  scenarioId: string;
  attempt: number;
  reason: string;
  leftStatus?: string;
  rightStatus?: string;
}
export interface ReviewScope {
  version: 1;
  basis: 'frozen-plan' | 'observed-results';
  entries: {
    scenarioId: string;
    attempt: number;
    leftStatus: string;
    rightStatus: string;
    reason: string | null;
    reviewPairId?: string;
  }[];
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const positive = (value: string | undefined) =>
  value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) > 0;

async function readRun(directory: string): Promise<Run> {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const results = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
  if (!Array.isArray(manifest.cases) || !Array.isArray(results))
    throw new Error('评测记录结构无效。');
  if (
    manifest.attempts !== undefined &&
    (!Number.isSafeInteger(manifest.attempts) || manifest.attempts <= 0)
  )
    throw new Error('冻结尝试次数无效。');
  const scenarios = new Map<string, Scenario>();
  for (const entry of manifest.cases) {
    const scenario = entry?.scenario;
    if (!scenario || !/^[a-z0-9-]+$/.test(scenario.id) || scenarios.has(scenario.id))
      throw new Error('评测场景无效或重复。');
    scenarios.set(scenario.id, scenario);
  }
  const resultMap = new Map<string, Result>();
  for (const result of results) {
    if (
      !result ||
      typeof result.id !== 'string' ||
      !/^[a-z0-9-]+-[1-9]\d*$/.test(result.id) ||
      typeof result.status !== 'string' ||
      resultMap.has(result.id)
    )
      throw new Error('评测结果无效或重复。');
    const scenarioId = result.id.slice(0, result.id.lastIndexOf('-'));
    if (!scenarios.has(scenarioId)) throw new Error('评测结果缺少对应冻结场景。');
    if (
      manifest.attempts !== undefined &&
      Number(result.id.slice(result.id.lastIndexOf('-') + 1)) > manifest.attempts
    )
      throw new Error('结果尝试次数超出冻结计划。');
    resultMap.set(result.id, result);
  }
  return { directory, scenarios, results: resultMap, manifest };
}

/** Only task facts enter judging context; experiment labels and expected winners never do. */
function reviewContext(scenario: Scenario): Record<string, unknown> {
  const keys = [
    'category',
    'mode',
    'question',
    'spreadId',
    'drawnCards',
    'additionalCards',
    'previousInterpretation',
    'followUpQuestion',
    'history',
    'date',
    'knownFacts',
    'goal',
    'rejectedGoals',
    'review',
  ];
  return Object.fromEntries(
    keys.filter((key) => scenario[key] !== undefined).map((key) => [key, scenario[key]]),
  );
}

function renderPair(pair: Pair): string {
  const context = pair.scenario;
  const cards = (value: unknown): string =>
    Array.isArray(value)
      ? value
          .map(
            (item) =>
              `${item.position?.nameCn ?? item.position?.id ?? '牌位'}：${item.card?.nameCn ?? item.card?.id ?? '牌'}（${item.isReversed ? '逆位' : '正位'}）`,
          )
          .join('；')
      : '';
  return [
    `## ${pair.id}`,
    `类型：${pair.category}`,
    `用户问题：${context.question ?? ''}`,
    context.followUpQuestion ? `本轮追问：${context.followUpQuestion}` : '',
    context.knownFacts ? `已知背景：${JSON.stringify(context.knownFacts)}` : '',
    context.goal ? `用户目标：${context.goal}` : '',
    context.rejectedGoals ? `用户不需要：${JSON.stringify(context.rejectedGoals)}` : '',
    context.date ? `日期：${context.date}` : '',
    `牌阵：${context.spreadId ?? ''}；${cards(context.drawnCards)}`,
    context.additionalCards ? `补充牌：${cards(context.additionalCards)}` : '',
    context.previousInterpretation ? `此前解读：\n\n${context.previousInterpretation}` : '',
    context.history ? `追问历史：\n\n${JSON.stringify(context.history, null, 2)}` : '',
    `### 回答 A\n\n${pair.answerA}`,
    `### 回答 B\n\n${pair.answerB}`,
    '### 你的判断\n\n- 更偏好：A / B / 相当\n- 哪个读完知道答案：A / B / 两个都知道 / 两个都不知道\n- 是否有武断、编造背景或违背诉求：\n- 最影响体验的一句话：',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function representativePairs(pairs: Pair[]): Pair[] {
  const selected: Pair[] = [];
  const categories = new Set<string>();
  for (const pair of pairs) {
    if (!categories.has(pair.category)) {
      selected.push(pair);
      categories.add(pair.category);
    }
  }
  // Ten is the user-calibration sample size accepted in the P1 plan.
  return [...selected, ...pairs.filter((pair) => !selected.includes(pair))].slice(0, 10);
}

/** Prepares frozen answer comparisons only; this script never calls a model. */
export async function prepareReadingReview(args: string[]): Promise<void> {
  const allowed = new Set([
    '--left',
    '--right',
    '--output',
    '--model',
    '--timeout-ms',
    '--max-output-tokens',
    '--max-requests',
    '--seed',
    '--scenarios',
    '--attempt',
    '--limit',
    '--swap',
  ]);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.has(key) || options.has(key)) throw new Error('盲评参数无效或重复。');
    if (key === '--swap') {
      options.set(key, 'true');
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error('盲评参数缺少值。');
    options.set(key, value);
  }
  for (const key of ['--left', '--right', '--output', '--model'])
    if (!options.get(key)?.trim()) throw new Error('必须显式提供输入目录、输出目录和裁判模型。');
  for (const key of ['--timeout-ms', '--max-output-tokens', '--max-requests'])
    if (!positive(options.get(key))) throw new Error('必须显式提供正整数裁判预算参数。');
  for (const key of ['--attempt', '--limit'])
    if (options.has(key) && !positive(options.get(key))) throw new Error('筛选参数必须是正整数。');
  const output = path.resolve(options.get('--output')!);
  if (
    existsSync(path.join(output, 'blind-key.json')) ||
    existsSync(path.join(output, 'promptfoo.json'))
  )
    throw new Error('输出目录已有盲评材料，请使用新目录。');
  const [left, right] = await Promise.all([
    readRun(path.resolve(options.get('--left')!)),
    readRun(path.resolve(options.get('--right')!)),
  ]);
  const selectedIds = options.get('--scenarios')?.split(',');
  const scenarioIds = [...new Set([...left.scenarios.keys(), ...right.scenarios.keys()])];
  if (selectedIds?.some((id) => !scenarioIds.includes(id))) throw new Error('未知筛选场景。');
  const failures: Failure[] = [];
  const pairs: Pair[] = [];
  const seed = options.get('--seed') ?? randomBytes(32).toString('hex');
  const onlyAttempt = options.has('--attempt') ? Number(options.get('--attempt')) : undefined;
  const scope: ReviewScope = {
    version: 1,
    basis:
      left.manifest.attempts !== undefined && right.manifest.attempts !== undefined
        ? 'frozen-plan'
        : 'observed-results',
    entries: [],
  };
  for (const scenarioId of scenarioIds.filter((id) => !selectedIds || selectedIds.includes(id))) {
    const plannedAttempts = Math.max(
      ...[left, right].map((run) =>
        run.scenarios.has(scenarioId) ? Number(run.manifest.attempts ?? 0) : 0,
      ),
    );
    const observedAttempts = [...left.results.keys(), ...right.results.keys()]
      .filter((id) => id.slice(0, id.lastIndexOf('-')) === scenarioId)
      .map((id) => Number(id.slice(id.lastIndexOf('-') + 1)));
    const attempts = [
      ...new Set([
        ...Array.from({ length: plannedAttempts }, (_, index) => index + 1),
        ...observedAttempts,
      ]),
    ];
    if (onlyAttempt && scope.basis === 'frozen-plan' && !attempts.includes(onlyAttempt))
      throw new Error('筛选尝试次数超出冻结计划。');
    for (const attempt of onlyAttempt ? [onlyAttempt] : attempts.length ? attempts : [1]) {
      const resultId = `${scenarioId}-${attempt}`;
      const l = left.results.get(resultId);
      const r = right.results.get(resultId);
      const failure = { scenarioId, attempt, leftStatus: l?.status, rightStatus: r?.status };
      if (!l || !r) {
        failures.push({ ...failure, reason: 'missing-result' });
        continue;
      }
      if (l.status !== 'success' || r.status !== 'success') {
        failures.push({ ...failure, reason: 'non-success' });
        continue;
      }
      const scenario = left.scenarios.get(scenarioId);
      if (!scenario || !isDeepStrictEqual(scenario, right.scenarios.get(scenarioId))) {
        failures.push({ ...failure, reason: 'scenario-mismatch' });
        continue;
      }
      let answers: string[];
      try {
        answers = await Promise.all(
          [left, right].map((run) => readFile(path.join(run.directory, `${resultId}.md`), 'utf8')),
        );
      } catch {
        failures.push({ ...failure, reason: 'missing-answer' });
        continue;
      }
      if (answers.some((answer) => !answer.trim())) {
        failures.push({ ...failure, reason: 'empty-answer' });
        continue;
      }
      const aIsLeft =
        (parseInt(digest(`${seed}:side:${resultId}`).slice(0, 2), 16) % 2 === 0) !==
        options.has('--swap');
      pairs.push({
        id: resultId,
        scenarioId,
        attempt,
        category: typeof scenario.category === 'string' ? scenario.category : '未分类',
        scenario: reviewContext(scenario),
        answerA: answers[aIsLeft ? 0 : 1],
        answerB: answers[aIsLeft ? 1 : 0],
        aIsLeft,
      });
    }
  }
  pairs.sort((a, b) =>
    digest(`${seed}:order:${a.id}`).localeCompare(digest(`${seed}:order:${b.id}`)),
  );
  const included = pairs
    .slice(0, options.has('--limit') ? Number(options.get('--limit')) : undefined)
    .map((pair, index) => ({ ...pair, id: `pair-${String(index + 1).padStart(3, '0')}` }));
  const reviewIds = new Map(
    included.map((pair) => [`${pair.scenarioId}-${pair.attempt}`, pair.id]),
  );
  scope.entries = [
    ...pairs.map((pair) => ({
      scenarioId: pair.scenarioId,
      attempt: pair.attempt,
      leftStatus: 'success',
      rightStatus: 'success',
      reason: null,
      ...(reviewIds.has(`${pair.scenarioId}-${pair.attempt}`)
        ? { reviewPairId: reviewIds.get(`${pair.scenarioId}-${pair.attempt}`)! }
        : {}),
    })),
    ...failures.map((failure) => ({
      ...failure,
      leftStatus: failure.leftStatus ?? 'missing',
      rightStatus: failure.rightStatus ?? 'missing',
    })),
  ];
  if (included.length > Number(options.get('--max-requests')))
    throw new Error('裁判请求数超过调用上限。');
  const providerPath = path
    .join(path.dirname(fileURLToPath(import.meta.url)), 'reading-review-provider.mjs')
    .replaceAll('\\', '/');
  const config = {
    description: '匿名塔罗解读成对质量评审。程序成功不等于质量通过，须结合裁判证据与人工判断。',
    sharing: false,
    writeLatestResults: false,
    prompts: ['请依据场景事实和回答甲、乙进行盲评。'],
    providers: [
      {
        id: `file://${providerPath}`,
        label: '匿名质量评审',
        config: {
          model: options.get('--model'),
          timeoutMs: Number(options.get('--timeout-ms')),
          maxOutputTokens: Number(options.get('--max-output-tokens')),
          maxRequests: Number(options.get('--max-requests')),
          rubricHash: READING_REVIEW_RUBRIC_HASH,
        },
      },
    ],
    evaluateOptions: { maxConcurrency: 1, repeat: 1, cache: false },
    tests: included.map((pair) => ({
      description: pair.id,
      vars: {
        scenario: JSON.stringify(pair.scenario),
        answerA: pair.answerA,
        answerB: pair.answerB,
      },
      options: { disableVarExpansion: true },
    })),
  };
  const introduction =
    '# 解读质量盲评\n\n请先独立阅读，不查看 blind-key.json。评价是否回答了问题、前后是否一致、是否重复、是否结合具体牌位、是否忠于已知事实；不因武断承诺而加分。倾诉题尊重不需要建议的诉求。\n\n';
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(path.join(output, 'promptfoo.json'), JSON.stringify(config, null, 2), 'utf8'),
    writeFile(path.join(output, 'review-rubric.md'), READING_REVIEW_RUBRIC, 'utf8'),
    writeFile(
      path.join(output, 'blind.md'),
      introduction + included.map(renderPair).join('\n\n---\n\n'),
      'utf8',
    ),
    writeFile(
      path.join(output, 'human-review.md'),
      introduction + representativePairs(included).map(renderPair).join('\n\n---\n\n'),
      'utf8',
    ),
    writeFile(path.join(output, 'failures.json'), JSON.stringify(failures, null, 2), 'utf8'),
    writeFile(
      path.join(output, 'blind-key.json'),
      JSON.stringify(
        {
          seed,
          swapped: options.has('--swap'),
          left: left.directory,
          right: right.directory,
          pairs: included.map(({ id, scenarioId, attempt, category, aIsLeft }) => ({
            id,
            scenarioId,
            attempt,
            category,
            A: aIsLeft ? 'left' : 'right',
            B: aIsLeft ? 'right' : 'left',
          })),
          eligiblePairs: pairs.length,
          selectedPairs: included.length,
          failures: failures.length,
          scope,
        },
        null,
        2,
      ),
      'utf8',
    ),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareReadingReview(process.argv.slice(2)).catch(() => {
    console.error('盲评准备失败：请检查参数、输入记录和输出目录。未发起模型请求。');
    process.exitCode = 1;
  });
}
