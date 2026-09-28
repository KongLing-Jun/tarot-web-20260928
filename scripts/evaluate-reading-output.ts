import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getModelConfig, getServerNumber } from '../lib/api/server-config';
import {
  buildInterpretationPrompt,
  buildFollowUpDirectPrompt,
  buildFollowUpWithExtrasPrompt,
  buildDailyInterpretationPrompt,
  buildReadingMessages,
  READING_PROMPT_VERSIONS,
  type ReadingPromptProfile,
} from '../lib/api/prompts';
import { mergeSegments, parseInterpretationSegments } from '../lib/interpretation';
import { classifyGeneration, hasValidAnswer } from '../lib/api/generation-result';
import { validateInterpretationQuality } from '../lib/interpretation-quality';
import { getSpreadById } from '../lib/tarot/spreads';
import { createSseDecoder, parseSseChunk } from '../lib/tarot/sseUtils';
import { readingOutputScenarios } from '../tests/fixtures/reading-output-scenarios';
import {
  interpretationEmpathyCases,
  type InterpretationEmpathyCase,
} from '../tests/fixtures/interpretation-empathy-cases';
import { readingContextCases } from '../tests/fixtures/reading-context-cases';
import { GroundedReadingDecoder, type ReadingEvidenceContext } from '../lib/api/reading-grounding';
import { createGroundedReadingStream } from '../lib/api/grounded-reading-stream';

type Scenario = Omit<
  InterpretationEmpathyCase,
  'knownFacts' | 'goal' | 'rejectedGoals' | 'review'
> &
  Partial<Pick<InterpretationEmpathyCase, 'knownFacts' | 'goal' | 'rejectedGoals' | 'review'>> & {
    split?: 'development' | 'holdout';
    category?: string;
    screen?: boolean;
  };
type ReadingMessages = ReturnType<typeof buildReadingMessages>;
interface FrozenCase {
  scenario: Scenario;
  promptFile: string;
  promptHash: string;
  messages?: ReadingMessages;
  messagesHash?: string;
}
interface Manifest {
  version: 1;
  source: 'synthetic';
  suite: string;
  revision: string;
  dirty: boolean;
  preparedAt: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  cases: FrozenCase[];
  stream?: boolean;
  thinking?: 'provider' | 'disabled' | 'enabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  profile?: ReadingPromptProfile;
  promptVersion?: string;
  requestedModel?: string;
  split?: 'development' | 'holdout' | 'screen';
  attempts?: number;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function readStreamingResponse(response: Response, started: number) {
  if (!response.body) throw new Error('模型流为空。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = createSseDecoder();
  let raw = '';
  let finishReason: string | undefined;
  let done = false;
  let interrupted = false;
  let usage: unknown = null;
  let responseModel: string | null = null;
  let firstTokenMs: number | null = null;
  let firstAnswerMs: number | null = null;
  const consume = (data: string) => {
    if (done) return;
    const chunk = parseSseChunk(data);
    if (chunk.error || chunk.malformed) interrupted = true;
    if (chunk.finishReason) finishReason = chunk.finishReason;
    if (chunk.isDone) {
      done = true;
      return;
    }
    if (!chunk.malformed) {
      const payload = JSON.parse(data);
      if (payload?.usage) usage = payload.usage;
      if (typeof payload?.model === 'string') responseModel = payload.model;
    }
    // Provider reasoning is deliberately neither timed as visible content nor persisted.
    raw += chunk.content;
    const answer = mergeSegments(parseInterpretationSegments(raw)).answer;
    if (firstTokenMs === null && answer.trim()) firstTokenMs = Date.now() - started;
    if (firstAnswerMs === null && hasValidAnswer(raw)) firstAnswerMs = Date.now() - started;
  };
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      events.push(decoder.decode(chunk.value, { stream: true })).forEach(consume);
    }
    [...events.push(decoder.decode()), ...events.finish()].forEach(consume);
    if (done) await reader.cancel();
  } finally {
    reader.releaseLock();
  }
  return {
    raw,
    finishReason,
    done,
    interrupted,
    usage,
    responseModel,
    firstTokenMs,
    firstAnswerMs,
  };
}

function promptFor(scenario: Scenario, profile: ReadingPromptProfile): string {
  const spread = getSpreadById(scenario.spreadId)!;
  if (scenario.mode === 'daily') {
    const { card, isReversed } = scenario.drawnCards[0];
    const orientation = isReversed ? 'reversed' : 'upright';
    return buildDailyInterpretationPrompt(
      card.name,
      card.nameCn,
      isReversed,
      card.keywords[orientation],
      card.meaning[orientation],
      scenario.date!,
      profile,
    );
  }
  if (scenario.mode === 'initial')
    return buildInterpretationPrompt(scenario.question, spread, scenario.drawnCards, profile);
  const context = [
    scenario.question,
    spread,
    scenario.drawnCards,
    scenario.previousInterpretation!,
    scenario.followUpQuestion!,
  ] as const;
  return scenario.mode === 'direct'
    ? buildFollowUpDirectPrompt(...context, scenario.history, profile)
    : buildFollowUpWithExtrasPrompt(
        ...context,
        scenario.additionalCards!,
        scenario.history,
        profile,
      );
}

/** --prepare 永不调用模型；--input 只使用已冻结且哈希校验通过的提示词。 */
export async function runReadingEvaluation(args: string[]): Promise<void> {
  const flags = new Set(['--run', '--prepare', '--stream']);
  const values = new Set([
    '--suite',
    '--timeout-ms',
    '--max-output-tokens',
    '--output',
    '--scenarios',
    '--input',
    '--attempts',
    '--thinking',
    '--reasoning-effort',
    '--profile',
    '--model',
    '--split',
    '--max-requests',
    '--concurrency',
  ]);
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if ((!flags.has(name) && !values.has(name)) || options.has(name))
      throw new Error('评估参数无效；未发起请求。');
    if (flags.has(name)) options.set(name, 'true');
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('评估参数缺少值；未发起请求。');
      options.set(name, value);
    }
  }
  if (options.has('--run') === options.has('--prepare') || !options.has('--output'))
    throw new Error('请指定 --prepare 或 --run，以及 --output。');
  if (options.has('--prepare') && options.has('--input')) throw new Error('--input 仅用于 --run。');
  if (
    options.has('--thinking') &&
    !['provider', 'disabled', 'enabled'].includes(options.get('--thinking')!)
  )
    throw new Error('思考模式无效。');
  if (
    options.has('--reasoning-effort') &&
    !['low', 'high', 'max'].includes(options.get('--reasoning-effort')!)
  )
    throw new Error('推理强度无效。');
  const suite = options.get('--suite') ?? 'reading';
  if (!['reading', 'empathy', 'p1', 'context'].includes(suite)) throw new Error('评估套件无效。');
  const profile = (options.get('--profile') ?? 'p0') as ReadingPromptProfile;
  if (!['p0', 'p1', 'p1-knowledge', 'p1-grounded', 'p2-context'].includes(profile))
    throw new Error('提示词版本无效。');
  const split = options.get('--split') as Manifest['split'];
  if (split && !['development', 'holdout', 'screen'].includes(split))
    throw new Error('评估分组无效。');
  if (split && !options.has('--input') && suite !== 'p1')
    throw new Error('评估分组仅支持 P1 套件。');
  if (options.has('--model') && !options.get('--model')!.trim())
    throw new Error('模型名称不能为空。');
  const positive = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  for (const key of [
    '--timeout-ms',
    '--max-output-tokens',
    '--attempts',
    '--max-requests',
    '--concurrency',
  ]) {
    if (options.has(key) && !positive(Number(options.get(key))))
      throw new Error('评估数值参数必须为正整数。');
  }
  const attempts = Number(options.get('--attempts') ?? 2);
  const concurrency = Number(options.get('--concurrency') ?? 2);
  const selectedIds = options.get('--scenarios')?.split(',');
  const outputDir = path.resolve(options.get('--output')!);
  if (
    existsSync(path.join(outputDir, 'manifest.json')) ||
    existsSync(path.join(outputDir, 'results.json'))
  )
    throw new Error('输出目录已有评估记录，请使用新目录。');
  let manifest: Manifest;
  const prompts = new Map<string, string>();
  if (options.has('--input')) {
    const inputDir = path.resolve(options.get('--input')!);
    manifest = JSON.parse(await readFile(path.join(inputDir, 'manifest.json'), 'utf8')) as Manifest;
    if (
      manifest.version !== 1 ||
      manifest.source !== 'synthetic' ||
      !Array.isArray(manifest.cases) ||
      !positive(manifest.timeoutMs) ||
      !positive(manifest.maxOutputTokens)
    )
      throw new Error('冻结清单无效。');
    if (
      typeof manifest.model !== 'string' ||
      !manifest.model.trim() ||
      !['reading', 'empathy', 'p1', 'context'].includes(manifest.suite) ||
      (manifest.requestedModel !== undefined && manifest.requestedModel !== manifest.model) ||
      (manifest.profile !== undefined &&
        !['p0', 'p1', 'p1-knowledge', 'p1-grounded', 'p2-context'].includes(manifest.profile)) ||
      (manifest.promptVersion !== undefined &&
        (typeof manifest.promptVersion !== 'string' || !manifest.promptVersion.trim())) ||
      (manifest.split !== undefined &&
        (!['development', 'holdout', 'screen'].includes(manifest.split) || manifest.suite !== 'p1'))
    )
      throw new Error('冻结模型或样本配置无效。');
    if (
      (options.has('--model') && options.get('--model') !== manifest.model) ||
      (options.has('--profile') && profile !== (manifest.profile ?? 'p0')) ||
      (options.has('--split') && split !== manifest.split)
    )
      throw new Error('请求参数与冻结清单不一致。');
    if (
      (manifest.stream !== undefined && typeof manifest.stream !== 'boolean') ||
      (manifest.thinking !== undefined &&
        !['provider', 'disabled', 'enabled'].includes(manifest.thinking)) ||
      (manifest.reasoningEffort !== undefined &&
        !['low', 'high', 'max'].includes(manifest.reasoningEffort))
    )
      throw new Error('冻结请求模式无效。');
    if (
      (options.has('--stream') && !manifest.stream) ||
      (options.has('--thinking') &&
        options.get('--thinking') !== (manifest.thinking ?? 'provider')) ||
      (options.has('--reasoning-effort') &&
        options.get('--reasoning-effort') !== manifest.reasoningEffort)
    )
      throw new Error('请求模式与冻结清单不一致。');
    if (options.has('--suite') && suite !== manifest.suite)
      throw new Error('套件与冻结清单不一致。');
    for (const entry of manifest.cases) {
      if (
        !/^[a-z0-9-]+$/.test(entry.scenario.id) ||
        entry.promptFile !== `${entry.scenario.id}.prompt.md`
      )
        throw new Error('冻结样本路径无效。');
      const prompt = await readFile(path.join(inputDir, entry.promptFile), 'utf8');
      if (hash(prompt) !== entry.promptHash) throw new Error('冻结提示词哈希不一致；未发起请求。');
      if (entry.messages !== undefined || entry.messagesHash !== undefined) {
        if (
          !Array.isArray(entry.messages) ||
          !entry.messages.length ||
          entry.messages.some(
            (message) =>
              !message ||
              !['system', 'user'].includes(message.role) ||
              typeof message.content !== 'string' ||
              !message.content.trim() ||
              Object.keys(message).some((key) => key !== 'role' && key !== 'content'),
          ) ||
          !['user', 'system,user'].includes(entry.messages.map((message) => message.role).join(','))
        )
          throw new Error('冻结消息结构无效；未发起请求。');
        if (hash(JSON.stringify(entry.messages)) !== entry.messagesHash)
          throw new Error('冻结消息哈希不一致；未发起请求。');
        if (entry.messages.map((message) => message.content).join('\n\n') !== prompt)
          throw new Error('冻结消息与提示词不一致；未发起请求。');
      }
      prompts.set(entry.scenario.id, prompt);
    }
    for (const [key, frozen] of [
      ['--timeout-ms', manifest.timeoutMs],
      ['--max-output-tokens', manifest.maxOutputTokens],
    ] as const) {
      if (options.has(key) && Number(options.get(key)) !== frozen)
        throw new Error('请求参数与冻结清单不一致。');
    }
  } else {
    const scenarios: Scenario[] = (
      suite === 'p1'
        ? (await import('../tests/fixtures/reading-p1-cases')).readingP1Cases
        : suite === 'context'
          ? readingContextCases
          : suite === 'empathy'
            ? interpretationEmpathyCases
            : readingOutputScenarios.map((scenario) => ({
                ...scenario,
                source: 'synthetic' as const,
              }))
    ).filter(
      (scenario: Scenario) =>
        !split || (split === 'screen' ? scenario.screen : scenario.split === split),
    );
    if (selectedIds?.some((id) => !scenarios.some((scenario) => scenario.id === id)))
      throw new Error('评估场景 ID 无效；未发起请求。');
    const config = getModelConfig();
    if (!config) throw new Error('真实模型配置不可用；未发起请求。');
    manifest = {
      version: 1,
      source: 'synthetic',
      suite,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
      preparedAt: new Date().toISOString(),
      model: options.get('--model') ?? config.model,
      requestedModel: options.get('--model') ?? config.model,
      profile,
      promptVersion: READING_PROMPT_VERSIONS[profile],
      ...(split ? { split } : {}),
      stream: options.has('--stream'),
      thinking: (options.get('--thinking') ?? 'provider') as Manifest['thinking'],
      ...(options.has('--reasoning-effort')
        ? { reasoningEffort: options.get('--reasoning-effort') as Manifest['reasoningEffort'] }
        : {}),
      timeoutMs: options.has('--timeout-ms')
        ? Number(options.get('--timeout-ms'))
        : getServerNumber('UPSTREAM_TIMEOUT_MS'),
      maxOutputTokens: options.has('--max-output-tokens')
        ? Number(options.get('--max-output-tokens'))
        : getServerNumber('MAX_OUTPUT_TOKENS'),
      cases: scenarios
        .filter((scenario) => !selectedIds || selectedIds.includes(scenario.id))
        .map((scenario) => {
          const prompt = promptFor(scenario, profile);
          const messages = buildReadingMessages(prompt);
          prompts.set(scenario.id, prompt);
          return {
            scenario,
            promptFile: `${scenario.id}.prompt.md`,
            promptHash: hash(prompt),
            messages,
            messagesHash: hash(JSON.stringify(messages)),
          };
        }),
    };
  }
  if (selectedIds?.some((id) => !manifest.cases.some((entry) => entry.scenario.id === id)))
    throw new Error('评估场景 ID 不在冻结清单内。');
  manifest = {
    ...manifest,
    attempts,
    cases: manifest.cases.filter(
      (entry) => !selectedIds || selectedIds.includes(entry.scenario.id),
    ),
  };
  if (!manifest.cases.length) throw new Error('没有待评估样本。');
  if (manifest.profile === 'p1-grounded' && !manifest.stream)
    throw new Error('依据协议评测需要流式模式。');
  const groundingContexts = new Map<string, ReadingEvidenceContext>();
  if (manifest.profile === 'p1-grounded')
    for (const entry of manifest.cases) {
      const context = JSON.parse(
        entry.messages?.find((message) => message.role === 'user')?.content ?? '{}',
      ).evidence;
      if (!context || !Array.isArray(context.users) || !Array.isArray(context.cards))
        throw new Error('冻结依据材料缺失。');
      groundingContexts.set(entry.scenario.id, context);
    }
  const requestCount = manifest.cases.length * attempts;
  if (
    !Number.isSafeInteger(requestCount) ||
    (options.has('--max-requests') && requestCount > Number(options.get('--max-requests')))
  )
    throw new Error('请求数量超过调用上限；未发起请求。');
  if (manifest.reasoningEffort && manifest.thinking !== 'enabled')
    throw new Error('推理强度要求显式启用思考模式。');
  const config = getModelConfig();
  if (
    !config ||
    !manifest.model.trim() ||
    (!manifest.requestedModel && !options.has('--model') && config.model !== manifest.model)
  )
    throw new Error('模型配置不可用或与冻结清单不一致；未发起请求。');
  if (
    manifest.thinking &&
    manifest.thinking !== 'provider' &&
    new URL(config.endpoint).hostname !== 'api.deepseek.com'
  )
    throw new Error('显式思考参数仅支持 DeepSeek 官方端点；未发起请求。');
  await mkdir(outputDir, { recursive: true });
  for (const entry of manifest.cases)
    await writeFile(
      path.join(outputDir, entry.promptFile),
      prompts.get(entry.scenario.id)!,
      'utf8',
    );
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (options.has('--prepare')) {
    console.log(`已冻结 ${manifest.cases.length} 个合成样本，未调用模型。`);
    return;
  }
  const requestUrl = config.endpoint.includes('/chat/completions')
    ? config.endpoint
    : `${config.endpoint}/chat/completions`;
  const jobs = manifest.cases.flatMap((entry) =>
    Array.from({ length: attempts }, (_, index) => ({ entry, attempt: index + 1 })),
  );
  const results: Record<string, unknown>[] = [];
  let next = 0;
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
    console.log('已停止调度；等待当前请求结束。');
  };
  process.on('SIGINT', stop);
  async function worker() {
    while (!stopRequested && !existsSync(path.join(outputDir, 'STOP')) && next < jobs.length) {
      const { entry, attempt } = jobs[next++];
      const { scenario } = entry;
      const id = `${scenario.id}-${attempt}`;
      const messages = entry.messages ?? [
        { role: 'user' as const, content: prompts.get(scenario.id)! },
      ];
      const started = Date.now();
      const result: Record<string, unknown> = {
        id,
        source: 'synthetic',
        promptHash: entry.promptHash,
        messagesHash: hash(JSON.stringify(messages)),
        revision: manifest.revision,
        model: manifest.model,
        profile: manifest.profile ?? 'p0',
        promptVersion: manifest.promptVersion ?? null,
        responseModel: null,
        firstTokenMs: null,
        firstAnswerMs: null,
        status: 'network-error',
      };
      try {
        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config!.apiKey}`,
          },
          body: JSON.stringify({
            model: manifest.model,
            messages,
            max_tokens: manifest.maxOutputTokens,
            stream: manifest.stream ?? false,
            ...(manifest.stream ? { stream_options: { include_usage: true } } : {}),
            ...(manifest.thinking && manifest.thinking !== 'provider'
              ? { thinking: { type: manifest.thinking } }
              : {}),
            ...(manifest.reasoningEffort ? { reasoning_effort: manifest.reasoningEffort } : {}),
          }),
          signal: AbortSignal.timeout(manifest.timeoutMs),
        });
        result.status = `http-${response.status}`;
        if (response.ok) {
          const evidence = groundingContexts.get(scenario.id);
          let protocol = '';
          const checkedResponse =
            evidence && response.body
              ? new Response(
                  createGroundedReadingStream(response.body, evidence, {
                    onProtocolText: (text) => {
                      protocol += text;
                    },
                  }),
                )
              : response;
          const payload = manifest.stream ? null : await response.json();
          const choice = payload?.choices?.[0];
          const streamed = manifest.stream
            ? await readStreamingResponse(checkedResponse, started)
            : null;
          const raw =
            streamed?.raw ??
            (typeof choice?.message?.content === 'string' ? choice.message.content : '');
          const answer = mergeSegments(parseInterpretationSegments(raw)).answer;
          const finishReason = streamed?.finishReason ?? choice?.finish_reason;
          const generationStatus = classifyGeneration({
            fullText: raw,
            finishReason,
            done: streamed?.done,
            interrupted: streamed?.interrupted,
          });
          Object.assign(result, {
            status: generationStatus === 'completed' ? 'success' : generationStatus,
            generationStatus,
            finishReason: finishReason ?? null,
            validAnswer: hasValidAnswer(raw),
            usage: streamed?.usage ?? payload?.usage ?? null,
            responseModel:
              streamed?.responseModel ??
              (typeof payload?.model === 'string' ? payload.model : null),
            firstTokenMs: streamed?.firstTokenMs ?? null,
            firstAnswerMs: streamed?.firstAnswerMs ?? null,
            quality: validateInterpretationQuality(raw, {
              mode:
                scenario.mode === 'direct'
                  ? 'follow-up'
                  : scenario.mode === 'extras'
                    ? 'supplementary'
                    : scenario.mode,
              drawnCards: scenario.drawnCards,
              additionalCards: scenario.additionalCards,
              historyCards: scenario.history?.flatMap((turn) => turn.additionalCards),
            }),
          });
          await writeFile(path.join(outputDir, `${id}.md`), answer, 'utf8');
          if (evidence) {
            const checked = new GroundedReadingDecoder(evidence);
            let referenceStatus = 'valid';
            try {
              for (const line of protocol.split(/(?<=\n)/u)) checked.push(line);
              checked.finish();
            } catch {
              referenceStatus = 'invalid';
            }
            result.grounding = {
              referenceStatus,
              recordCount: checked.records.length,
              cardCoverage: checked.cardCoverage,
              semanticStatus: 'not-assessed',
            };
            await writeFile(
              path.join(outputDir, `${id}.grounding.json`),
              JSON.stringify(
                {
                  context: evidence,
                  protocol,
                  records: checked.records,
                  referenceStatus,
                  cardCoverage: checked.cardCoverage,
                  semanticStatus: 'not-assessed',
                },
                null,
                2,
              ),
              'utf8',
            );
          }
        }
      } catch (error) {
        result.status =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout'
            : 'network-or-response-error';
      }
      result.durationMs = Date.now() - started;
      results.push(result);
      console.log(`${id}: ${result.status}`);
      await writeFile(path.join(outputDir, `${id}.json`), JSON.stringify(result, null, 2), 'utf8');
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  } finally {
    process.off('SIGINT', stop);
  }
  await writeFile(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  if (results.length !== jobs.length || results.some((result) => result.status !== 'success'))
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runReadingEvaluation(process.argv.slice(2)).catch(() => {
    console.log(
      '评估未完成：请检查参数、冻结清单、模型配置或本地读写权限。未输出连接信息或响应错误正文。',
    );
    process.exitCode = 1;
  });
}
