// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/server-config', () => ({
  getModelConfig: () => ({
    endpoint: 'https://api.deepseek.com/v1',
    apiKey: 'fixture-only',
    model: 'fixture-default',
  }),
  getServerNumber: () => 1000,
}));

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
let root: string;
let input: string;
let output: string;
const options = () => [
  '--input',
  input,
  '--output',
  output,
  '--attempt',
  '1',
  '--model',
  'revision-fixture',
  '--timeout-ms',
  '1000',
  '--max-output-tokens',
  '500',
  '--max-requests',
  '2',
];

async function readManifest() {
  return JSON.parse(await readFile(path.join(input, 'manifest.json'), 'utf8'));
}
async function writeManifest(value: unknown) {
  await writeFile(path.join(input, 'manifest.json'), JSON.stringify(value));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'reading-revision-'));
  input = path.join(root, 'source');
  output = path.join(root, 'frozen');
  await mkdir(input);
  const cases = [1, 2].map((index) => {
    const messages = [
      { role: 'system', content: '原始系统写作规则' },
      { role: 'user', content: `用户原始材料${index}` },
    ];
    return {
      scenario: {
        id: `development-${index}`,
        source: 'synthetic',
        split: 'development',
        question: '原题',
        knownFacts: ['EVAL_ONLY_FACT'],
        goal: 'EVAL_ONLY_GOAL',
        review: ['EVAL_ONLY_REVIEW'],
        drawnCards: [],
        mode: 'initial',
        spreadId: 'single',
      },
      promptFile: `development-${index}.prompt.md`,
      promptHash: hash(messages.map((item) => item.content).join('\n\n')),
      messages,
      messagesHash: hash(JSON.stringify(messages)),
    };
  });
  await writeManifest({
    version: 1,
    source: 'synthetic',
    suite: 'p1',
    split: 'screen',
    revision: 'source-revision',
    dirty: false,
    model: 'source-model',
    requestedModel: 'source-model',
    profile: 'p1',
    promptVersion: 'source-version',
    stream: true,
    thinking: 'enabled',
    reasoningEffort: 'low',
    timeoutMs: 1000,
    maxOutputTokens: 500,
    cases,
  });
  for (const entry of cases) {
    await writeFile(
      path.join(input, entry.promptFile),
      entry.messages.map((item) => item.content).join('\n\n'),
    );
    await writeFile(
      path.join(input, `${entry.scenario.id}-1.md`),
      `待修订草稿${entry.scenario.id}`,
    );
  }
  await writeFile(
    path.join(input, 'results.json'),
    JSON.stringify(
      cases.map((entry) => ({
        id: `${entry.scenario.id}-1`,
        status: 'success',
        durationMs: 2500,
        promptHash: entry.promptHash,
        messagesHash: entry.messagesHash,
        model: 'source-model',
      })),
    ),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('禁止联网');
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  process.exitCode = 0;
  await rm(root, { recursive: true, force: true });
});

describe('frozen reading revision preparation', () => {
  it('freezes disabled thinking without a reasoning effort and rejects contradictory policies', async () => {
    const { prepareReadingRevision } = await import('../scripts/prepare-reading-revision');
    await expect(
      prepareReadingRevision([
        ...options(),
        '--thinking',
        'disabled',
        '--reasoning-effort',
        'high',
      ]),
    ).rejects.toThrow();
    await expect(prepareReadingRevision([...options(), '--thinking', 'invalid'])).rejects.toThrow();
    await prepareReadingRevision([...options(), '--thinking', 'disabled']);
    const frozen = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    expect(frozen.thinking).toBe('disabled');
    expect(frozen.reasoningEffort).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves scenarios, passes only source user materials and draft, and records hashes plus serial latency provenance', async () => {
    const { prepareReadingRevision } = await import('../scripts/prepare-reading-revision');
    const source = await readManifest();
    await prepareReadingRevision(options());
    const frozen = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    expect(frozen).toMatchObject({
      version: 1,
      source: 'synthetic',
      suite: 'p1',
      profile: 'p1',
      model: 'revision-fixture',
      requestedModel: 'revision-fixture',
      stream: true,
      thinking: 'enabled',
      reasoningEffort: 'low',
      timeoutMs: 1000,
      maxOutputTokens: 500,
    });
    expect(frozen.cases.map((entry: { scenario: unknown }) => entry.scenario)).toEqual(
      source.cases.map((entry: { scenario: unknown }) => entry.scenario),
    );
    for (const entry of frozen.cases) {
      const prompt = await readFile(path.join(output, entry.promptFile), 'utf8');
      expect(prompt).not.toMatch(/EVAL_ONLY|原始系统写作规则/);
      expect(prompt).toContain('用户原始材料');
      expect(prompt).toContain('待修订草稿');
      expect(entry.promptHash).toBe(hash(prompt));
      expect(entry.messagesHash).toBe(hash(JSON.stringify(entry.messages)));
      expect(entry.messages.map((item: { content: string }) => item.content).join('\n\n')).toBe(
        prompt,
      );
      expect(entry.provenance).toMatchObject({
        sourceResultId: `${entry.scenario.id}-1`,
        sourceDurationMs: 2500,
        sourcePromptHash: source.cases.find(
          (original: { scenario: { id: string } }) => original.scenario.id === entry.scenario.id,
        ).promptHash,
      });
      expect(entry.provenance.sourceAnswerHash).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.provenance.sourceResultHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(prepareReadingRevision(options())).rejects.toThrow('已有');
  });

  it('rejects holdout partitions and missing partition proof before writing any revision', async () => {
    const { prepareReadingRevision } = await import('../scripts/prepare-reading-revision');
    const manifest = await readManifest();
    manifest.split = 'holdout';
    await writeManifest(manifest);
    await expect(prepareReadingRevision(options())).rejects.toThrow('开发');
    manifest.split = 'screen';
    manifest.cases[0].scenario.split = 'holdout';
    await writeManifest(manifest);
    await expect(prepareReadingRevision(options())).rejects.toThrow('开发');
    delete manifest.cases[0].scenario.split;
    await writeManifest(manifest);
    await expect(prepareReadingRevision(options())).rejects.toThrow('开发');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'prompt',
    'messages',
    'protocol',
    'result-hash',
    'failed-result',
    'empty-draft',
    'missing-duration',
  ])('rejects invalid source evidence: %s', async (failure) => {
    const { prepareReadingRevision } = await import('../scripts/prepare-reading-revision');
    const manifest = await readManifest();
    const results = JSON.parse(await readFile(path.join(input, 'results.json'), 'utf8'));
    if (failure === 'prompt')
      await writeFile(path.join(input, manifest.cases[0].promptFile), 'changed');
    if (failure === 'messages') manifest.cases[0].messagesHash = 'changed';
    if (failure === 'protocol') {
      manifest.cases[0].messages[1].role = 'assistant';
      manifest.cases[0].messagesHash = hash(JSON.stringify(manifest.cases[0].messages));
    }
    if (failure === 'result-hash') results[0].promptHash = 'changed';
    if (failure === 'failed-result') results[0].status = 'timeout';
    if (failure === 'empty-draft') await writeFile(path.join(input, 'development-1-1.md'), ' ');
    if (failure === 'missing-duration') delete results[0].durationMs;
    await writeManifest(manifest);
    await writeFile(path.join(input, 'results.json'), JSON.stringify(results));
    await expect(prepareReadingRevision(options())).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires all explicit limits and refuses an under-budget run or unsupported flags', async () => {
    const { prepareReadingRevision } = await import('../scripts/prepare-reading-revision');
    await expect(
      prepareReadingRevision(
        options().filter(
          (value, index, all) => value !== '--attempt' && all[index - 1] !== '--attempt',
        ),
      ),
    ).rejects.toThrow();
    const underBudget = options();
    underBudget[underBudget.indexOf('--max-requests') + 1] = '1';
    await expect(prepareReadingRevision(underBudget)).rejects.toThrow('上限');
    await expect(prepareReadingRevision([...options(), '--run'])).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reuses the existing version-one runner without rebuilding prompts or dropping provenance', async () => {
    const { prepareReadingRevision } = await import('../scripts/prepare-reading-revision');
    const { runReadingEvaluation } = await import('../scripts/evaluate-reading-output');
    await prepareReadingRevision(options());
    const fetcher = vi.fn(
      async () =>
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"## 核心解读\\n倾向继续推进。"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const target = path.join(root, 'revision-results');
    await runReadingEvaluation([
      '--run',
      '--input',
      output,
      '--output',
      target,
      '--attempts',
      '1',
      '--max-requests',
      '2',
      '--concurrency',
      '1',
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(
      (fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    const frozen = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    expect(sent.messages).toEqual(frozen.cases[0].messages);
    expect(sent).toMatchObject({
      model: 'revision-fixture',
      stream: true,
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    });
    expect(
      JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8')).cases[0].provenance
        .sourceDurationMs,
    ).toBe(2500);
    const results = JSON.parse(await readFile(path.join(target, 'results.json'), 'utf8'));
    expect(results.map((result: { status: string }) => result.status)).toEqual([
      'success',
      'success',
    ]);
  });
});
