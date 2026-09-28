import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildReadingRevisionMessages,
  READING_REVISION_VERSION,
} from './reading-revision-guidance';

type Message = { role: 'system' | 'user'; content: string };
interface SourceCase {
  scenario: Record<string, unknown> & { id: string; split?: string };
  promptFile: string;
  promptHash: string;
  messages: Message[];
  messagesHash: string;
}
interface SourceManifest {
  version: number;
  source: string;
  suite: string;
  split?: string;
  model: string;
  requestedModel?: string;
  profile?: string;
  promptVersion?: string;
  revision: string;
  timeoutMs: number;
  maxOutputTokens: number;
  stream?: boolean;
  thinking?: string;
  reasoningEffort?: string;
  cases: SourceCase[];
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Prepares a second-pass experiment only; the existing evaluation runner owns all paid calls. */
export async function prepareReadingRevision(args: string[]) {
  const required = [
    '--input',
    '--attempt',
    '--output',
    '--model',
    '--timeout-ms',
    '--max-output-tokens',
    '--max-requests',
  ];
  const allowed = new Set([...required, '--thinking', '--reasoning-effort']);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[++index];
    if (!allowed.has(key) || options.has(key) || !value?.trim() || value.startsWith('--'))
      throw new Error('修订准备参数无效、重复或缺少值。');
    options.set(key, value);
  }
  for (const key of required)
    if (!options.has(key)) throw new Error('所有修订输入和预算参数必须显式提供。');
  const thinking = options.get('--thinking') ?? 'enabled';
  const reasoningEffort =
    options.get('--reasoning-effort') ?? (thinking === 'enabled' ? 'low' : undefined);
  if (
    !['enabled', 'disabled'].includes(thinking) ||
    (reasoningEffort !== undefined &&
      (thinking !== 'enabled' || !['low', 'high', 'max'].includes(reasoningEffort)))
  )
    throw new Error('修订思考模式与推理强度不一致或无效。');
  const attempt = Number(options.get('--attempt'));
  const timeoutMs = Number(options.get('--timeout-ms'));
  const maxOutputTokens = Number(options.get('--max-output-tokens'));
  const maxRequests = Number(options.get('--max-requests'));
  if (
    ![attempt, timeoutMs, maxOutputTokens, maxRequests].every(positive) ||
    timeoutMs > 2_147_483_647
  )
    throw new Error('修订次数和预算必须为有效正整数。');
  const sourceDirectory = path.resolve(options.get('--input')!);
  const outputDirectory = path.resolve(options.get('--output')!);
  if (existsSync(outputDirectory)) throw new Error('输出目录已有内容或记录，请使用新目录。');
  const rawManifest = await readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8');
  const source: SourceManifest = JSON.parse(rawManifest);
  if (
    source.version !== 1 ||
    source.source !== 'synthetic' ||
    source.suite !== 'p1' ||
    !Array.isArray(source.cases) ||
    !source.cases.length ||
    !['screen', 'development'].includes(source.split ?? '') ||
    source.cases.some((entry) => entry.scenario?.split !== 'development')
  )
    throw new Error('只允许明确标记的 P1 开发样本，拒绝留出或未知分组。');
  if (source.cases.length > maxRequests) throw new Error('修订样本数超过调用上限。');
  if (
    !nonempty(source.model) ||
    !positive(source.timeoutMs) ||
    !positive(source.maxOutputTokens) ||
    (source.requestedModel !== undefined && source.requestedModel !== source.model) ||
    (source.profile !== undefined && !['p0', 'p1', 'p1-knowledge'].includes(source.profile)) ||
    (source.promptVersion !== undefined && !nonempty(source.promptVersion)) ||
    (source.stream !== undefined && typeof source.stream !== 'boolean') ||
    (source.thinking !== undefined &&
      !['provider', 'disabled', 'enabled'].includes(source.thinking)) ||
    (source.reasoningEffort !== undefined &&
      (!['low', 'high', 'max'].includes(source.reasoningEffort) || source.thinking !== 'enabled'))
  )
    throw new Error('源冻结请求协议无效。');
  const sourceResults: Record<string, unknown>[] = JSON.parse(
    await readFile(path.join(sourceDirectory, 'results.json'), 'utf8'),
  );
  if (
    !Array.isArray(sourceResults) ||
    sourceResults.some((result) => !result || !nonempty(result.id))
  )
    throw new Error('源结果记录无效。');
  const resultsById = new Map(sourceResults.map((result) => [result.id, result]));
  if (
    resultsById.size !== sourceResults.length ||
    new Set(source.cases.map((entry) => entry.scenario.id)).size !== source.cases.length
  )
    throw new Error('源样本或结果编号重复。');
  const cases = [];
  const prompts = new Map<string, string>();
  for (const entry of source.cases) {
    if (
      !/^[a-z0-9-]+$/.test(entry.scenario.id) ||
      entry.promptFile !== `${entry.scenario.id}.prompt.md`
    )
      throw new Error('源冻结样本路径无效。');
    const originalPrompt = await readFile(path.join(sourceDirectory, entry.promptFile), 'utf8');
    if (hash(originalPrompt) !== entry.promptHash) throw new Error('源提示词哈希不一致。');
    if (
      !Array.isArray(entry.messages) ||
      !entry.messages.length ||
      entry.messages.some(
        (message) =>
          !message ||
          !['system', 'user'].includes(message.role) ||
          !nonempty(message.content) ||
          Object.keys(message).some((key) => !['role', 'content'].includes(key)),
      ) ||
      !['user', 'system,user'].includes(entry.messages.map((message) => message.role).join(','))
    )
      throw new Error('源冻结消息协议无效。');
    if (
      hash(JSON.stringify(entry.messages)) !== entry.messagesHash ||
      entry.messages.map((message) => message.content).join('\n\n') !== originalPrompt
    )
      throw new Error('源消息哈希或提示词对应关系不一致。');
    const resultId = `${entry.scenario.id}-${attempt}`;
    const result = resultsById.get(resultId);
    if (
      !result ||
      result.status !== 'success' ||
      result.promptHash !== entry.promptHash ||
      result.messagesHash !== entry.messagesHash ||
      result.model !== source.model ||
      typeof result.durationMs !== 'number' ||
      !Number.isFinite(result.durationMs) ||
      result.durationMs < 0
    )
      throw new Error('源结果必须成功、哈希与模型一致，并记录完整生成时长。');
    const draft = await readFile(path.join(sourceDirectory, `${resultId}.md`), 'utf8');
    if (!draft.trim()) throw new Error('源解读正文为空。');
    const request = entry.messages.find((message) => message.role === 'user')!.content;
    const messages = buildReadingRevisionMessages({ request, draft });
    const prompt = messages.map((message) => message.content).join('\n\n');
    prompts.set(entry.promptFile, prompt);
    cases.push({
      scenario: entry.scenario,
      promptFile: entry.promptFile,
      promptHash: hash(prompt),
      messages,
      messagesHash: hash(JSON.stringify(messages)),
      provenance: {
        sourceResultId: resultId,
        sourceResultHash: hash(JSON.stringify(result)),
        sourceAnswerHash: hash(draft),
        sourceDurationMs: result.durationMs,
        sourcePromptHash: entry.promptHash,
        sourceMessagesHash: entry.messagesHash,
      },
    });
  }
  const model = options.get('--model')!.trim();
  const manifest = {
    version: 1,
    source: 'synthetic',
    suite: 'p1',
    split: source.split,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    preparedAt: new Date().toISOString(),
    model,
    requestedModel: model,
    profile: 'p1',
    promptVersion: READING_REVISION_VERSION,
    stream: true,
    thinking,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    timeoutMs,
    maxOutputTokens,
    cases,
    provenance: {
      kind: 'offline-reading-revision',
      sourceDirectory,
      sourceManifestHash: hash(rawManifest),
      sourceRevision: source.revision,
      sourcePromptVersion: source.promptVersion ?? null,
      sourceAttempt: attempt,
      maxRequests,
      latency:
        '总首段等待 = sourceDurationMs + 修订 firstAnswerMs；总完成时间 = sourceDurationMs + 修订 durationMs。',
    },
  };
  await mkdir(outputDirectory, { recursive: true });
  for (const [file, prompt] of prompts)
    await writeFile(path.join(outputDirectory, file), prompt, { flag: 'wx' });
  await writeFile(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareReadingRevision(process.argv.slice(2))
    .then(() => console.log('修订候选材料已冻结，未调用模型；请用既有评测 runner 执行。'))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : '修订准备失败');
      process.exitCode = 1;
    });
}
