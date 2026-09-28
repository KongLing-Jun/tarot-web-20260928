// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runReadingEvaluation } from '../scripts/evaluate-reading-output';
import { interpretationEmpathyCases } from './fixtures/interpretation-empathy-cases';
import { spreads } from '@/lib/tarot/spreads';
import { buildReadingMessages } from '@/lib/api/prompts';
import * as prompts from '@/lib/api/prompts';
import { readingContextCases, readingContextPairs } from './fixtures/reading-context-cases';

const modelConfig = vi.hoisted(() => ({
  endpoint: 'https://example.invalid',
  apiKey: '',
  model: 'evaluation-test',
}));

vi.mock('@/lib/api/server-config', () => ({
  getModelConfig: () => modelConfig,
  getServerNumber: (key: string) => (key === 'UPSTREAM_TIMEOUT_MS' ? 1000 : 200),
}));

describe('reading evaluation preparation', () => {
  let root: string;
  const fetchMock = vi.fn();
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tarot-evaluation-test-'));
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    modelConfig.endpoint = 'https://example.invalid';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true });
  });
  it('freezes all synthetic cases, cards and hashes without a model request', async () => {
    await runReadingEvaluation(['--prepare', '--suite', 'empathy', '--output', root]);
    expect(fetchMock).not.toHaveBeenCalled();
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest.source).toBe('synthetic');
    expect(manifest.cases).toHaveLength(interpretationEmpathyCases.length);
    expect(manifest.maxOutputTokens).toBe(200);
    for (const entry of manifest.cases) {
      expect(entry.promptHash).toMatch(/^[a-f0-9]{64}$/);
      const prompt = await readFile(path.join(root, entry.promptFile), 'utf8');
      expect(prompt).toContain(entry.scenario.drawnCards[0].card.nameCn);
      expect(entry.messages).toEqual(buildReadingMessages(prompt));
      expect(
        entry.messages.map((message: { content: string }) => message.content).join('\n\n'),
      ).toBe(prompt);
      expect(entry.messagesHash).toBe(
        createHash('sha256').update(JSON.stringify(entry.messages)).digest('hex'),
      );
    }
    expect(
      new Set(
        interpretationEmpathyCases
          .filter((item) => item.mode === 'initial')
          .map((item) => item.spreadId),
      ),
    ).toEqual(new Set(spreads.map((item) => item.id)));
    expect(
      interpretationEmpathyCases.some((item) => item.history?.some((turn) => !turn.interpretation)),
    ).toBe(true);
  });
  it('freezes paired context cases without sending semantic review answers to the model', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'context',
      '--profile',
      'p2-context',
      '--attempts',
      '1',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(manifest.cases).toHaveLength(12);
    expect(manifest.promptVersion).toBe('2026-09-24-p2-context-r3');
    for (const entry of manifest.cases) {
      const data = JSON.parse(entry.messages[1].content);
      expect(data).not.toHaveProperty('review');
      expect(data).not.toHaveProperty('knownFacts');
      expect(data.evidence.users.at(-1).text).toBe(
        entry.scenario.followUpQuestion ?? entry.scenario.question,
      );
    }
    for (const pair of readingContextPairs) {
      const [a, b] = pair.caseIds.map((id) => readingContextCases.find((item) => item.id === id)!);
      expect(a.drawnCards).toEqual(b.drawnCards);
      expect(a.followUpQuestion ?? a.question).not.toBe(b.followUpQuestion ?? b.question);
    }
    const caseId = readingContextCases[0].id;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '已结合具体限制给出建议。' }, finish_reason: 'stop' }],
        }),
      ),
    );
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--scenarios',
      caseId,
      '--attempts',
      '1',
      '--max-requests',
      '1',
      '--output',
      path.join(root, 'results'),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual(
      manifest.cases[0].messages,
    );
  });
  it.each([
    ['--run', '--prepare'],
    ['--prepare', '--attempts', '0'],
    ['--prepare', '--suite', 'missing'],
    ['--prepare', '--scenarios', 'missing'],
    ['--prepare', '--input', 'ignored'],
    ['--prepare', '--timeout-ms', 'NaN'],
    ['--prepare', '--thinking', 'auto'],
    ['--prepare', '--reasoning-effort', 'medium'],
    ['--prepare', '--thinking', 'disabled', '--reasoning-effort', 'low'],
    ['--prepare', '--reasoning-effort', 'low'],
    ['--prepare', '--stream', '--stream'],
    ['--prepare', '--profile', 'unknown'],
    ['--prepare', '--split', 'unknown'],
    ['--prepare', '--suite', 'empathy', '--split', 'screen'],
    ['--prepare', '--model', '   '],
    ['--run', '--max-requests', '0'],
    ['--run', '--concurrency', '1.5'],
  ])('rejects invalid arguments before networking: %s', async (...args) => {
    await expect(runReadingEvaluation([...args, '--output', root])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('freezes an explicit candidate model and profile without modifying private configuration', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--profile',
      'p0',
      '--model',
      'candidate-model',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ model: 'candidate-model', profile: 'p0' });
    expect(manifest.promptVersion).toBe('2026-09-18-p0');
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'candidate-model-actual',
          choices: [{ message: { content: '更倾向先沟通。' }, finish_reason: 'stop' }],
          usage: { total_tokens: 12 },
        }),
      ),
    );
    const output = path.join(root, 'results');
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--output',
      output,
      '--attempts',
      '1',
      '--max-requests',
      '1',
      '--concurrency',
      '1',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('candidate-model');
    expect(modelConfig.model).toBe('evaluation-test');
    expect(JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'))[0]).toMatchObject({
      model: 'candidate-model',
      responseModel: 'candidate-model-actual',
      usage: { total_tokens: 12 },
    });
  });
  it.each([
    ['--model', 'other-model'],
    ['--profile', 'p1'],
    ['--max-output-tokens', '201'],
    ['--timeout-ms', '1001'],
  ])('rejects an explicit override of frozen %s', async (...override) => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--profile',
      'p0',
      '--output',
      root,
    ]);
    await expect(
      runReadingEvaluation([
        '--run',
        '--input',
        root,
        '--output',
        path.join(root, 'results'),
        ...override,
      ]),
    ).rejects.toThrow('冻结');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('preflights the complete request count before sending any request', async () => {
    await expect(
      runReadingEvaluation([
        '--run',
        '--suite',
        'empathy',
        '--scenarios',
        'single',
        '--attempts',
        '2',
        '--max-requests',
        '1',
        '--output',
        root,
      ]),
    ).rejects.toThrow('上限');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['development', 'holdout', 'screen'])(
    'freezes only the requested P1 %s cases',
    async (split) => {
      await runReadingEvaluation([
        '--prepare',
        '--suite',
        'p1',
        '--split',
        split,
        '--profile',
        'p1-knowledge',
        '--output',
        root,
      ]);
      const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
      expect(manifest).toMatchObject({ suite: 'p1', split, profile: 'p1-knowledge' });
      expect(manifest.cases.length).toBeGreaterThan(0);
      for (const { scenario } of manifest.cases) {
        expect(split === 'screen' ? scenario.screen : scenario.split === split).toBe(true);
      }
      await expect(
        runReadingEvaluation([
          '--run',
          '--input',
          root,
          '--split',
          split === 'holdout' ? 'development' : 'holdout',
          '--output',
          path.join(root, 'results'),
        ]),
      ).rejects.toThrow('冻结');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('retains the frozen profile messages instead of rebuilding a new profile', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'p1',
      '--split',
      'screen',
      '--profile',
      'p0',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    vi.spyOn(prompts, 'buildReadingMessages').mockImplementation(() => {
      throw new Error('禁止重建');
    });
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '更倾向先沟通。' }, finish_reason: 'stop' }],
          }),
        ),
      ),
    );
    const output = path.join(root, 'results');
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--scenarios',
      manifest.cases[0].scenario.id,
      '--attempts',
      '1',
      '--max-requests',
      '1',
      '--output',
      output,
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual(
      manifest.cases[0].messages,
    );
  });
  it('requires an explicit matching model override to replay a legacy candidate manifest', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    delete manifest.requestedModel;
    manifest.model = 'legacy-candidate';
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    const output = path.join(root, 'results');
    await expect(
      runReadingEvaluation(['--run', '--input', root, '--output', output]),
    ).rejects.toThrow('冻结');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '更倾向先沟通。' }, finish_reason: 'stop' }],
        }),
      ),
    );
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--output',
      output,
      '--model',
      'legacy-candidate',
      '--attempts',
      '1',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('legacy-candidate');
  });
  it.each([
    { model: '' },
    { model: '   ' },
    { profile: 'unknown' },
    { requestedModel: 'changed' },
    { split: 'screen' },
  ])('rejects invalid frozen model/profile metadata %j', async (invalid) => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, ...invalid }));
    await expect(
      runReadingEvaluation(['--run', '--input', root, '--output', path.join(root, 'results')]),
    ).rejects.toThrow('冻结');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('honors configured concurrency and retains HTTP failure status', async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return new Response('private response body', { status: 429 });
    });
    await runReadingEvaluation([
      '--run',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--attempts',
      '3',
      '--max-requests',
      '3',
      '--concurrency',
      '1',
      '--output',
      root,
    ]);
    expect(peak).toBe(1);
    const results = await readFile(path.join(root, 'results.json'), 'utf8');
    expect(JSON.parse(results).map((item: { status: string }) => item.status)).toEqual([
      'http-429',
      'http-429',
      'http-429',
    ]);
    expect(results).not.toContain('private response body');
  });
  it('freezes the actual attempt budget before an interrupted run leaves missing results', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--attempts',
      '1',
      '--output',
      root,
    ]);
    fetchMock.mockImplementation(async () => {
      process.emit('SIGINT');
      return new Response('failure', { status: 429 });
    });
    const output = path.join(root, 'interrupted');
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--output',
      output,
      '--attempts',
      '3',
      '--concurrency',
      '1',
    ]);
    expect(JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')).attempts).toBe(3);
    expect(JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'))).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
  it('refuses a changed frozen prompt before requesting the model', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    await writeFile(path.join(root, 'single.prompt.md'), 'changed');
    await expect(
      runReadingEvaluation(['--run', '--input', root, '--output', path.join(root, 'results')]),
    ).rejects.toThrow('哈希');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses the frozen prompt and preserves non-completed finish reasons', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    const frozenPrompt = await readFile(path.join(root, 'single.prompt.md'), 'utf8');
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: '已经收到一部分正文。' }, finish_reason: 'content_filter' },
          ],
        }),
        { status: 200 },
      ),
    );
    const output = path.join(root, 'results');
    await runReadingEvaluation(['--run', '--input', root, '--output', output, '--attempts', '1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual(
      buildReadingMessages(frozenPrompt),
    );
    const results = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
    expect(results[0]).toMatchObject({
      status: 'interrupted',
      generationStatus: 'interrupted',
      firstTokenMs: null,
      validAnswer: true,
    });
    expect(results[0].quality).toBeDefined();
  });
  it('measures visible stream content across fragmented UTF-8 SSE and preserves usage without reasoning', async () => {
    modelConfig.endpoint = 'https://api.deepseek.com/v1';
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--stream',
      '--thinking',
      'enabled',
      '--reasoning-effort',
      'low',
      '--output',
      root,
    ]);
    const events =
      [
        {
          model: 'stream-response-model',
          choices: [{ delta: { reasoning_content: '私密推理不能保存' } }],
        },
        { choices: [{ delta: { content: ' \n' } }] },
        { choices: [{ delta: { content: '## 核心解读\n' } }] },
        { choices: [{ delta: { content: '先确认你最关心的事情。' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 23, completion_tokens: 45, total_tokens: 68 } },
      ]
        .map((payload) => `data: ${JSON.stringify(payload)}\r\n\r\n`)
        .join('') + 'data: [DONE]\r\n\r\n';
    const bytes = new TextEncoder().encode(events);
    let offset = 0;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (offset >= bytes.length) {
              controller.close();
              return;
            }
            controller.enqueue(bytes.slice(offset, offset + 3));
            offset += 3;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    let time = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      time += 100;
      return time;
    });
    const output = path.join(root, 'results');
    await runReadingEvaluation(['--run', '--input', root, '--output', output, '--attempts', '1']);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    });
    const results = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
    expect(results[0]).toMatchObject({
      status: 'success',
      finishReason: 'stop',
      firstTokenMs: 100,
      firstAnswerMs: 200,
      durationMs: 300,
      responseModel: 'stream-response-model',
      usage: { total_tokens: 68 },
    });
    const saved = await readFile(path.join(output, 'single-1.md'), 'utf8');
    expect(saved).toContain('先确认你最关心的事情。');
    expect(saved).not.toContain('私密推理');
    expect(JSON.stringify(results)).not.toContain('私密推理');
  });
  it('renders grounded protocol through the real stream adapter while saving unassessed evidence separately', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--profile',
      'p1-grounded',
      '--stream',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const evidence = JSON.parse(
      manifest.cases[0].messages.find((message: { role: string }) => message.role === 'user')
        .content,
    ).evidence;
    const firstCard = evidence.cards[0];
    const firstUser = evidence.users[0];
    const records = [
      {
        type: 'claim',
        section: 'core',
        kind: 'inference',
        text: '按牌面，偏向继续了解。',
        users: [{ id: firstUser.id, quote: firstUser.text }],
        cards: [firstCard.id],
      },
      {
        type: 'claim',
        section: 'cards',
        kind: 'symbol',
        text: '这张牌提供当前问题的观察角度。',
        users: [],
        cards: [firstCard.id],
      },
    ];
    const protocol = [...records, { type: 'end' }]
      .map((record) => JSON.stringify(record) + '\n')
      .join('');
    const events =
      [
        {
          model: 'grounded-test-model',
          choices: [{ delta: { reasoning_content: '不会写入评测文件的私密推理' } }],
        },
        { choices: [{ delta: { content: protocol.slice(0, 37) } }] },
        { choices: [{ delta: { content: protocol.slice(37) } }] },
        { choices: [{ finish_reason: 'stop' }] },
        { choices: [], usage: { total_tokens: 88 } },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('') + 'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(events);
    let offset = 0;
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            if (offset === bytes.length) {
              controller.close();
              return;
            }
            controller.enqueue(bytes.slice(offset, offset + 1));
            offset++;
          },
        }),
      ),
    );
    const output = path.join(root, 'results');
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--output',
      output,
      '--attempts',
      '1',
      '--max-requests',
      '1',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const result = JSON.parse(await readFile(path.join(output, 'single-1.json'), 'utf8'));
    const markdown = await readFile(path.join(output, 'single-1.md'), 'utf8');
    const audit = JSON.parse(await readFile(path.join(output, 'single-1.grounding.json'), 'utf8'));
    expect(result).toMatchObject({
      status: 'success',
      finishReason: 'stop',
      responseModel: 'grounded-test-model',
      usage: { total_tokens: 88 },
      grounding: { referenceStatus: 'valid', recordCount: 2, semanticStatus: 'not-assessed' },
    });
    expect(markdown).toContain('## 核心解读');
    expect(markdown).toContain('按牌面，偏向继续了解。');
    expect(markdown).toContain(`### ${firstCard.position}｜${firstCard.cardName}`);
    expect(markdown).not.toContain('"type":"claim"');
    expect(markdown).not.toContain('original:0');
    expect(audit).toMatchObject({
      context: evidence,
      protocol,
      referenceStatus: 'valid',
      semanticStatus: 'not-assessed',
    });
    expect(audit.records).toEqual(
      records.map((record, index) => ({
        ...record,
        id: `claim:${index}`,
        verification: 'references-only',
      })),
    );
    expect(result.grounding.cardCoverage).toEqual({
      status: 'complete',
      requiredIds: [firstCard.id],
      explainedIds: [firstCard.id],
    });
    expect(audit.cardCoverage).toEqual(result.grounding.cardCoverage);
    expect(JSON.stringify({ result, audit, markdown })).not.toContain('私密推理');
  });
  it.each([false, true])(
    'never marks an invalid grounded reference successful, with valid prefix=%s',
    async (withPrefix) => {
      const valid = {
        type: 'claim',
        section: 'core',
        kind: 'inference',
        text: '按牌面，可以继续观察。',
        users: [],
        cards: ['original:0'],
      };
      const invalid = { ...valid, text: '坏记录不应展示。', cards: ['invented-card'] };
      const protocol = [...(withPrefix ? [valid] : []), invalid, { type: 'end' }]
        .map((record) => JSON.stringify(record) + '\n')
        .join('');
      fetchMock.mockResolvedValue(
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: protocol } }] })}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`,
        ),
      );
      await runReadingEvaluation([
        '--run',
        '--suite',
        'empathy',
        '--scenarios',
        'single',
        '--profile',
        'p1-grounded',
        '--stream',
        '--output',
        root,
        '--attempts',
        '1',
        '--max-requests',
        '1',
      ]);
      const result = JSON.parse(await readFile(path.join(root, 'single-1.json'), 'utf8'));
      const markdown = await readFile(path.join(root, 'single-1.md'), 'utf8');
      const audit = JSON.parse(await readFile(path.join(root, 'single-1.grounding.json'), 'utf8'));
      expect(result.status).not.toBe('success');
      expect(result.generationStatus).not.toBe('completed');
      expect(result.finishReason).not.toBe('stop');
      expect(process.exitCode).toBe(1);
      expect(markdown).not.toContain(invalid.text);
      expect(markdown).not.toContain('invented-card');
      if (withPrefix) expect(markdown).toContain(valid.text);
      else expect(markdown).toBe('');
      expect(audit).toMatchObject({
        protocol,
        referenceStatus: 'invalid',
        semanticStatus: 'not-assessed',
      });
      expect(audit.records).toHaveLength(withPrefix ? 1 : 0);
      expect(JSON.stringify(audit.records)).not.toContain(invalid.text);
      expect(result.grounding).toMatchObject({
        referenceStatus: 'invalid',
        recordCount: withPrefix ? 1 : 0,
        semanticStatus: 'not-assessed',
      });
    },
  );
  it.each(['--prepare', '--run'])(
    'rejects nonstream grounded %s before issuing a request',
    async (mode) => {
      await expect(
        runReadingEvaluation([
          mode,
          '--suite',
          'empathy',
          '--scenarios',
          'single',
          '--profile',
          'p1-grounded',
          '--output',
          root,
        ]),
      ).rejects.toThrow('流式');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('rejects a frozen grounded manifest with streaming disabled before networking', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--profile',
      'p1-grounded',
      '--stream',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    await writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({ ...manifest, stream: false }),
    );
    await expect(
      runReadingEvaluation(['--run', '--input', root, '--output', path.join(root, 'results')]),
    ).rejects.toThrow('流式');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, true, 'success'],
    ['length', true, 'truncated'],
    ['content_filter', true, 'interrupted'],
    [undefined, false, 'interrupted'],
    ['stop', false, 'success'],
  ])('classifies stream finish=%s done=%s as %s', async (finishReason, done, status) => {
    const stream = `data: ${JSON.stringify({ choices: [{ delta: { content: '可以先尝试一次沟通。' }, finish_reason: finishReason }] })}\n\n${done ? 'data: [DONE]\n\n' : ''}`;
    fetchMock.mockResolvedValue(new Response(stream));
    await runReadingEvaluation([
      '--run',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--stream',
      '--output',
      root,
      '--attempts',
      '1',
    ]);
    const results = JSON.parse(await readFile(path.join(root, 'results.json'), 'utf8'));
    expect(results[0].status).toBe(status);
  });
  it('does not count reasoning-only streams as a visible answer', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"reasoning_content":"隐藏推理"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      ),
    );
    await runReadingEvaluation([
      '--run',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--stream',
      '--output',
      root,
      '--attempts',
      '1',
    ]);
    const results = JSON.parse(await readFile(path.join(root, 'results.json'), 'utf8'));
    expect(results[0]).toMatchObject({
      status: 'no-valid-answer',
      firstTokenMs: null,
      firstAnswerMs: null,
    });
    expect(await readFile(path.join(root, 'single-1.md'), 'utf8')).toBe('');
  });
  it('accepts legacy manifests without silently changing provider or nonstream behavior', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    delete manifest.stream;
    delete manifest.thinking;
    delete manifest.profile;
    delete manifest.promptVersion;
    delete manifest.requestedModel;
    for (const entry of manifest.cases) {
      delete entry.messages;
      delete entry.messagesHash;
    }
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    vi.spyOn(prompts, 'buildReadingMessages').mockImplementation(() => {
      throw new Error('不可动态重建旧版消息');
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '可以先尝试一次沟通。' }, finish_reason: 'stop' }],
        }),
      ),
    );
    await runReadingEvaluation([
      '--run',
      '--input',
      root,
      '--output',
      path.join(root, 'results'),
      '--attempts',
      '1',
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: 'user', content: await readFile(path.join(root, 'single.prompt.md'), 'utf8') },
    ]);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body).not.toHaveProperty('stream_options');
  });
  it.each([
    ['--stream'],
    ['--thinking', 'disabled'],
    ['--thinking', 'enabled', '--reasoning-effort', 'low'],
  ])('rejects changing frozen request modes: %s', async (...args) => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    await expect(
      runReadingEvaluation([
        '--run',
        '--input',
        root,
        '--output',
        path.join(root, 'results'),
        ...args,
      ]),
    ).rejects.toThrow('冻结');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'enabled'])(
    'refuses explicit %s thinking on other providers before networking',
    async (thinking) => {
      await expect(
        runReadingEvaluation(['--run', '--thinking', thinking, '--output', root]),
      ).rejects.toThrow('DeepSeek');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('refuses changing a frozen reasoning effort', async () => {
    modelConfig.endpoint = 'https://api.deepseek.com';
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--thinking',
      'enabled',
      '--reasoning-effort',
      'low',
      '--output',
      root,
    ]);
    await expect(
      runReadingEvaluation([
        '--run',
        '--input',
        root,
        '--reasoning-effort',
        'high',
        '--output',
        path.join(root, 'results'),
      ]),
    ).rejects.toThrow('冻结');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { stream: 'true' },
    { thinking: 'auto' },
    { reasoningEffort: 'medium' },
    { thinking: 'disabled', reasoningEffort: 'low' },
  ])('rejects invalid frozen mode configuration %j', async (invalid) => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, ...invalid }));
    await expect(
      runReadingEvaluation(['--run', '--input', root, '--output', path.join(root, 'results')]),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses frozen messages without invoking a later version of the message builder', async () => {
    await runReadingEvaluation([
      '--prepare',
      '--suite',
      'empathy',
      '--scenarios',
      'single',
      '--output',
      root,
    ]);
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const builder = vi.spyOn(prompts, 'buildReadingMessages').mockImplementation(() => {
      throw new Error('新版构建器不应执行');
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '先确认下一步。' }, finish_reason: 'stop' }],
        }),
      ),
    );
    const output = path.join(root, 'results');
    await runReadingEvaluation(['--run', '--input', root, '--output', output, '--attempts', '1']);
    expect(builder).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages).toEqual(
      manifest.cases[0].messages,
    );
    expect(
      JSON.parse(await readFile(path.join(output, 'single-1.json'), 'utf8')).messagesHash,
    ).toBe(manifest.cases[0].messagesHash);
  });
  it.each(['content', 'role', 'missing-hash', 'missing-messages', 'equivalence'])(
    'rejects changed frozen message %s before networking',
    async (mutation) => {
      await runReadingEvaluation([
        '--prepare',
        '--suite',
        'empathy',
        '--scenarios',
        'single',
        '--output',
        root,
      ]);
      const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
      const entry = manifest.cases[0];
      if (mutation === 'content' || mutation === 'equivalence')
        entry.messages[0].content = '替换内容';
      if (mutation === 'role') entry.messages[0].role = 'assistant';
      if (mutation === 'missing-hash') delete entry.messagesHash;
      if (mutation === 'missing-messages') delete entry.messages;
      if (mutation === 'equivalence')
        entry.messagesHash = createHash('sha256')
          .update(JSON.stringify(entry.messages))
          .digest('hex');
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
      await expect(
        runReadingEvaluation(['--run', '--input', root, '--output', path.join(root, 'results')]),
      ).rejects.toThrow('冻结消息');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
