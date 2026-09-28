// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/interpret/route';
import { GET } from '@/app/api/config/route';
import { streamInterpret } from '@/lib/api/stream-client';
import { spreads } from '@/lib/tarot/spreads';
import { drawCardsForSpread } from '@/lib/tarot/draw';
import { allCards } from '@/lib/tarot/cards';
import { readFileSync } from 'node:fs';
import exampleConfig from '../model.config.example.json';
import { startChatExchange } from '@/lib/server/chat';
import { GET as streamConfig } from '@/app/api/interpret/config/route';
import { ANSWER_FIRST_GUIDANCE } from '@/lib/api/reading-guidance-p1';
import {
  buildInterpretationPrompt,
  buildFollowUpDirectPrompt,
  buildFollowUpWithExtrasPrompt,
  buildReadingMessages,
} from '@/lib/api/prompts';

vi.mock('@/lib/server/auth', () => ({
  requireUser: vi.fn(async (request: NextRequest) => ({
    id: request.headers.get('x-real-ip') || 'test',
  })),
}));
vi.mock('@/lib/server/chat', () => ({
  startChatExchange: vi.fn(async () => ({
    append: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
  })),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: vi.fn(),
}));

const modelConfig = {
  ...exampleConfig,
  MODEL_BASE_URL: 'https://api.deepseek.com/',
  MODEL_API_KEY: 'server-test-key',
  MODEL_ID: 'deepseek-v4-flash',
  MODEL_THINKING: 'provider',
  MODEL_REASONING_EFFORT: undefined,
};

const stream = 'data: {"choices":[{"delta":{"content":"测试解读"}}]}\n\ndata: [DONE]\n\n';
const reading = {
  question: '今日指引',
  spread: spreads[0],
  drawnCards: [{ card: allCards[0], isReversed: false, position: spreads[0].positions[0] }],
};
const supplementary = [
  {
    card: allCards[1],
    isReversed: true,
    position: {
      id: 'supp-1',
      name: 'Supplementary 1',
      nameCn: '补 一',
      description: '为回应追问而抽取的补充指引',
    },
  },
];
const followUp = { previousInterpretation: '之前的解读', followUpQuestion: '接下来呢？' };
let requestId = 0;

function request(body: unknown) {
  return new NextRequest('http://localhost/api/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': `test-${requestId++}` },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(modelConfig));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('shared server model', () => {
  it.each(['p0', 'p1', 'p1-grounded', 'p2-context'])(
    'canonicalizes the %s reading before model and persistence',
    async (profile) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: profile }),
      );
      const original = { card: allCards[0], isReversed: true, position: spreads[0].positions[0] };
      const altered = {
        ...original,
        card: {
          ...original.card,
          nameCn: 'TEST_CARD',
          meaning: { upright: 'TEST_MEANING', reversed: 'TEST_MEANING' },
          keywords: { upright: ['TEST_KEYWORD'], reversed: ['TEST_KEYWORD'] },
        },
        position: {
          ...original.position,
          nameCn: 'TEST_POSITION',
          description: 'TEST_DESCRIPTION',
        },
      };
      const upstream = vi.fn().mockResolvedValue(new Response(stream));
      vi.stubGlobal('fetch', upstream);
      const response = await POST(
        request({
          ...reading,
          spread: { ...spreads[0], nameCn: 'TEST_SPREAD' },
          drawnCards: [altered],
        }),
      );
      expect(response.status).toBe(200);
      await response.text();
      const messages = JSON.parse(upstream.mock.calls[0][1].body).messages;
      expect(JSON.stringify(messages)).not.toMatch(
        /TEST_(CARD|MEANING|KEYWORD|POSITION|DESCRIPTION|SPREAD)/,
      );
      expect(vi.mocked(startChatExchange).mock.lastCall![2]).toMatchObject({
        spread: spreads[0],
        drawnCards: [original],
      });
    },
  );

  it.each([
    { spread: { ...spreads[0], id: 'unknown' }, drawnCards: [] },
    { drawnCards: [] },
    { drawnCards: [null] },
    {
      drawnCards: [
        { card: { id: 'unknown' }, isReversed: false, position: spreads[0].positions[0] },
      ],
    },
    { drawnCards: [{ card: allCards[0], isReversed: 'false', position: spreads[0].positions[0] }] },
    { drawnCards: [{ card: allCards[0], isReversed: false, position: spreads[1].positions[0] }] },
    {
      spread: spreads[1],
      drawnCards: spreads[1].positions.map((position) => ({
        card: allCards[0],
        isReversed: false,
        position,
      })),
    },
    {
      spread: spreads[1],
      drawnCards: allCards
        .slice(0, 3)
        .map((card) => ({ card, isReversed: false, position: spreads[1].positions[0] })),
    },
  ])(
    'rejects malformed or inconsistent structured cards before any side effects: %j',
    async (patch) => {
      const upstream = vi.fn();
      vi.stubGlobal('fetch', upstream);
      const response = await POST(request({ ...reading, ...patch }));
      expect(response.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
      expect(startChatExchange).not.toHaveBeenCalled();
    },
  );

  it('canonicalizes extra cards in each round, preserving legacy positions and cross-round repetition', async () => {
    const extra = {
      card: { ...allCards[1], nameCn: 'TEST_EXTRA' },
      isReversed: true,
      position: {
        id: 'legacy-extra',
        name: 'Legacy',
        nameCn: '旧补牌位',
        description: '原有补牌说明',
      },
    };
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    const response = await POST(
      request({
        ...reading,
        drawnCards: [{ card: allCards[0], isReversed: false, position: spreads[0].positions[0] }],
        followUp: {
          ...followUp,
          mode: 'with-extras',
          additionalCards: [extra],
          history: [{ question: '上次追问', interpretation: '已有回答', additionalCards: [extra] }],
        },
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(JSON.stringify(JSON.parse(upstream.mock.calls[0][1].body).messages)).not.toContain(
      'TEST_EXTRA',
    );
    expect(vi.mocked(startChatExchange).mock.lastCall![2].followUp).toMatchObject({
      additionalCards: [{ ...extra, card: allCards[1] }],
      history: [{ additionalCards: [{ ...extra, card: allCards[1] }] }],
    });
  });

  it.each([
    { ...followUp, mode: 'with-extras', additionalCards: [] },
    { ...followUp, mode: 'with-extras' },
    { ...followUp, mode: 'with-extras', additionalCards: [supplementary[0], supplementary[0]] },
    {
      ...followUp,
      mode: 'direct',
      history: [
        {
          question: '旧问题',
          interpretation: '',
          additionalCards: [supplementary[0], supplementary[0]],
        },
      ],
    },
  ])('rejects missing or duplicated supplementary draws: %j', async (followUp) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const response = await POST(request({ ...reading, followUp }));
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(startChatExchange).not.toHaveBeenCalled();
  });

  it('applies grounded evidence consistently to daily, direct, supplementary and regeneration requests', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: 'p1-grounded' }),
    );
    const base = { ...reading, drawnCards: drawCardsForSpread(spreads[0]) };
    for (const payload of [
      base,
      { ...base, followUp: { ...followUp, mode: 'direct' } },
      {
        ...base,
        followUp: {
          ...followUp,
          mode: 'with-extras',
          additionalCards: drawCardsForSpread(spreads[0]),
        },
      },
      { daily: { cardName: 'The Fool', cardNameCn: '愚者', dateKey: '2026-09-19' } },
      { ...base, regeneration: { previousResponse: '<think>隐藏推理</think>未经确认的旧稿' } },
    ]) {
      const upstream = vi.fn(async (_url: string, options: { body: string }) => {
        const material = JSON.parse(JSON.parse(options.body).messages[1].content);
        const record = {
          type: 'claim',
          section: 'core',
          kind: 'symbol',
          text: '探索主题提供一个观察角度。',
          users: [],
          cards: [material.evidence.cards[0].id],
        };
        const protocol = `${JSON.stringify(record)}\n{"type":"end"}\n`;
        return new Response(`data: ${JSON.stringify({ content: protocol })}\n\ndata: [DONE]\n\n`);
      });
      vi.stubGlobal('fetch', upstream);
      const response = await POST(request(payload));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('探索主题');
      const material = JSON.parse(JSON.parse(upstream.mock.calls[0][1].body).messages[1].content);
      expect(material.evidence).toEqual(
        vi.mocked(startChatExchange).mock.lastCall![2].groundingEvidence,
      );
      if ('regeneration' in payload) {
        expect(material.previousReply).toBe('未经确认的旧稿');
        expect(JSON.stringify(material.evidence)).not.toContain('旧稿');
        expect(JSON.stringify(material)).not.toContain('隐藏推理');
      }
    }
  });

  it('rejects foreign registered positions before recording or contacting the model', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: 'p1-grounded' }),
    );
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const response = await POST(
      request({ ...reading, drawnCards: drawCardsForSpread(spreads[1]) }),
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(startChatExchange).not.toHaveBeenCalled();
  });

  it('converts grounded output before both the client and recorder see it', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: 'p1-grounded' }),
    );
    const drawnCards = drawCardsForSpread(spreads[0]);
    const protocol =
      JSON.stringify({
        type: 'claim',
        section: 'core',
        kind: 'inference',
        text: '按牌面，偏向可以尝试。',
        users: [],
        cards: ['original:0'],
      }) + '\n{"type":"end"}\n';
    const frames = `data: ${JSON.stringify({ choices: [{ delta: { content: protocol } }] })}\n\ndata: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`;
    const upstream = vi.fn().mockResolvedValue(new Response(frames));
    vi.stubGlobal('fetch', upstream);
    const response = await POST(request({ ...reading, drawnCards }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('按牌面，偏向可以尝试');
    expect(body).toContain('牌面依据');
    expect(body).not.toContain('original:0');
    const recorder = await vi.mocked(startChatExchange).mock.results.at(-1)!.value;
    const saved = vi
      .mocked(recorder.append)
      .mock.calls.map((args: [Uint8Array]) => new TextDecoder().decode(args[0]))
      .join('');
    expect(saved).toContain('按牌面，偏向可以尝试');
    expect(saved).not.toContain('original:0');
    expect(vi.mocked(startChatExchange).mock.lastCall![2]).toMatchObject({
      promptProfile: 'p1-grounded',
      groundingVerification: 'references-only',
    });
  });

  it.each(['p0', 'p1', 'p2-context'] as const)(
    'uses the server %s profile for every structured reading entry',
    async (profile) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: profile }),
      );
      for (const payload of [
        reading,
        { ...reading, followUp: { ...followUp, mode: 'direct' } },
        {
          ...reading,
          followUp: { ...followUp, mode: 'with-extras', additionalCards: supplementary },
        },
        { daily: { cardName: 'The Fool', cardNameCn: '愚者', dateKey: '2026-09-19' } },
        { ...reading, regeneration: { previousResponse: '<think>秘密思考</think>旧AI猜测' } },
      ]) {
        const upstream = vi.fn().mockResolvedValue(new Response(stream));
        vi.stubGlobal('fetch', upstream);
        const response = await POST(
          request({ ...payload, promptProfile: profile === 'p0' ? 'p1' : 'p0' }),
        );
        expect(response.status).toBe(200);
        await response.text();
        const messages = JSON.parse(upstream.mock.calls[0][1].body).messages;
        const context = vi.mocked(startChatExchange).mock.lastCall![2];
        expect(context).toMatchObject({ promptProfile: profile, promptSource: 'structured' });
        expect(context.promptVersion).toContain(profile);
        expect(messages.map((message: { role: string }) => message.role)).toEqual([
          'system',
          'user',
        ]);
        expect(messages[0].content === ANSWER_FIRST_GUIDANCE).toBe(profile === 'p1');
        if ('regeneration' in payload) {
          expect(messages[1].content).toContain('旧AI猜测');
          expect(messages[1].content).not.toContain('秘密思考');
          if (profile === 'p1') expect(messages[1].content).toContain('不能视为用户事实');
          if (profile === 'p2-context') {
            const material = JSON.parse(messages[1].content);
            expect(material.regenerationDraft).toBe('旧AI猜测');
            expect(material.revisionInstruction).toContain('用户事实');
            expect(material.revisionInstruction).not.toContain('逐行JSON');
          }
        }
      }
    },
  );

  it.each(['direct', 'with-extras'] as const)(
    'preserves the original reply separately from the %s regeneration draft',
    async (mode) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: 'p2-context' }),
      );
      const upstream = vi.fn().mockResolvedValue(new Response(stream));
      vi.stubGlobal('fetch', upstream);
      await (
        await POST(
          request({
            ...reading,
            followUp: {
              ...followUp,
              mode,
              previousInterpretation: '<think>旧思考</think>第二条建议：先核对收件人',
              additionalCards: supplementary,
            },
            regeneration: { previousResponse: '<think>新思考</think>待修订追问回答' },
          }),
        )
      ).text();
      const messages = JSON.parse(upstream.mock.calls[0][1].body).messages;
      const data = JSON.parse(messages[1].content);
      expect(data.previousReply).toBe('第二条建议：先核对收件人');
      expect(data.regenerationDraft).toBe('待修订追问回答');
      expect(messages[1].content).not.toContain('思考');
    },
  );

  it.each(['initial', 'direct', 'with-extras'] as const)(
    'keeps the complete P0 regeneration messages identical to the pre-P1 %s prompt',
    async (mode) => {
      const config: Record<string, unknown> = { ...modelConfig };
      delete config.READING_PROMPT_PROFILE;
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
      const payload =
        mode === 'initial'
          ? reading
          : { ...reading, followUp: { ...followUp, mode, additionalCards: supplementary } };
      const base =
        mode === 'initial'
          ? buildInterpretationPrompt(reading.question, reading.spread, reading.drawnCards, 'p0')
          : mode === 'direct'
            ? buildFollowUpDirectPrompt(
                reading.question,
                reading.spread,
                reading.drawnCards,
                followUp.previousInterpretation,
                followUp.followUpQuestion,
                undefined,
                'p0',
              )
            : buildFollowUpWithExtrasPrompt(
                reading.question,
                reading.spread,
                reading.drawnCards,
                followUp.previousInterpretation,
                followUp.followUpQuestion,
                supplementary,
                undefined,
                'p0',
              );
      // Frozen suffix from HEAD's pre-P1 client appendRegenerationInstruction.
      const expectedPrompt = `${base}

## 上一版回复
旧AI猜测

## 重新生成要求
请重新生成一版回复，保持用户事实、问题、牌阵、牌面和明确意愿不变。先检查上一版是否直接答题、是否实质使用背景、是否只罗列可能或反复解释局限，再针对缺失处修正，而非只换措辞。能给建议时明确主张和依据；关键背景不足时尽早问一个问题。用户只想倾诉或不要建议时不强加行动。`;
      const upstream = vi.fn().mockResolvedValue(new Response(stream));
      vi.stubGlobal('fetch', upstream);
      await (
        await POST(
          request({
            ...payload,
            regeneration: { previousResponse: '<think>不可泄露思考</think>旧AI猜测\n' },
          }),
        )
      ).text();
      expect(JSON.parse(upstream.mock.calls[0][1].body).messages).toEqual(
        buildReadingMessages(expectedPrompt),
      );
      expect(vi.mocked(startChatExchange).mock.lastCall![2]).toMatchObject({
        promptProfile: 'p0',
        promptVersion: '2026-09-18-p0',
      });
    },
  );

  it('defaults a missing reading profile to p0 regardless of client overrides', async () => {
    const config: Record<string, unknown> = { ...modelConfig };
    delete config.READING_PROMPT_PROFILE;
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    await (await POST(request({ ...reading, promptProfile: 'p1' }))).text();
    expect(vi.mocked(startChatExchange).mock.lastCall![2]).toMatchObject({ promptProfile: 'p0' });
  });

  it.each(['p1-knowledge', 'invalid', null, false])(
    'rejects invalid runtime reading profile before recording: %s',
    async (profile) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: profile }),
      );
      const upstream = vi.fn();
      vi.stubGlobal('fetch', upstream);
      expect((await POST(request(reading))).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
      expect(startChatExchange).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'keeps old raw agent input explicitly separate from reading profiles (internal=%s)',
    async (internal) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: 'p1' }),
      );
      const upstream = vi.fn().mockResolvedValue(new Response(stream));
      vi.stubGlobal('fetch', upstream);
      await (await POST(request({ agent: { prompt: '保留旧客户端的文本', internal } }))).text();
      expect(JSON.parse(upstream.mock.calls[0][1].body).messages).toEqual([
        { role: 'user', content: '保留旧客户端的文本' },
      ]);
      expect(vi.mocked(startChatExchange).mock.lastCall![2]).toMatchObject({
        promptSource: internal ? 'decision' : 'legacy',
        promptVersion: internal ? 'decision' : 'legacy',
      });
    },
  );

  it('keeps structured follow-up decisions outside the reading profile', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, READING_PROMPT_PROFILE: 'p1' }),
    );
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    await (await POST(request({ ...reading, followUp: { ...followUp, mode: 'decide' } }))).text();
    expect(JSON.parse(upstream.mock.calls[0][1].body).messages).toHaveLength(1);
    expect(vi.mocked(startChatExchange).mock.lastCall![2]).toMatchObject({
      promptSource: 'decision',
      promptVersion: 'decision',
      internal: true,
    });
  });

  it.each([
    { regeneration: { previousResponse: null } },
    { regeneration: ['old'] },
    { followUp: { ...followUp, mode: 'unknown' } },
    { followUp: { ...followUp, mode: 'decide' }, regeneration: { previousResponse: '旧决策' } },
  ])('rejects malformed structured requests before upstream use: %j', async (payload) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect((await POST(request({ ...reading, ...payload }))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(startChatExchange).not.toHaveBeenCalled();
  });

  it.each([
    { MODEL_THINKING: 'disabled', expected: { thinking: { type: 'disabled' } } },
    {
      MODEL_THINKING: 'enabled',
      MODEL_REASONING_EFFORT: 'low',
      expected: { thinking: { type: 'enabled' }, reasoning_effort: 'low' },
    },
  ])(
    'uses server-controlled reasoning policy: $MODEL_THINKING',
    async ({ expected, ...settings }) => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ ...modelConfig, ...settings }));
      const upstream = vi.fn().mockResolvedValue(new Response(stream));
      vi.stubGlobal('fetch', upstream);
      await (
        await POST(request({ ...reading, thinking: { type: 'enabled' }, reasoning_effort: 'max' }))
      ).text();
      const body = JSON.parse(upstream.mock.calls[0][1].body);
      expect(body).toMatchObject(expected);
      if (settings.MODEL_THINKING === 'disabled')
        expect(body).not.toHaveProperty('reasoning_effort');
      expect(body.messages.map((message: { role: string }) => message.role)).toEqual([
        'system',
        'user',
      ]);
      expect(body.messages[1].content).toContain(reading.question);
    },
  );

  it('preserves provider defaults for existing runtime files without reasoning settings', async () => {
    const config: Record<string, unknown> = { ...modelConfig };
    delete config.MODEL_THINKING;
    delete config.MODEL_REASONING_EFFORT;
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    await (await POST(request(reading))).text();
    const body = JSON.parse(upstream.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    { MODEL_THINKING: 'invalid' },
    { MODEL_THINKING: 'disabled', MODEL_REASONING_EFFORT: 'low' },
    { MODEL_THINKING: 'enabled', MODEL_REASONING_EFFORT: 'invalid' },
    { MODEL_THINKING: 'disabled', MODEL_BASE_URL: 'https://other.invalid' },
  ])(
    'rejects incompatible model policy before persistence or an upstream call: %j',
    async (settings) => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ ...modelConfig, ...settings }));
      const upstream = vi.fn();
      vi.stubGlobal('fetch', upstream);
      expect((await POST(request(reading))).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
      expect(startChatExchange).not.toHaveBeenCalled();
    },
  );

  it('returns only validated timeout and retry settings for the browser', async () => {
    const response = await streamConfig(request({}));
    expect(await response.json()).toEqual({
      connectTimeoutMs: modelConfig.UPSTREAM_TIMEOUT_MS + modelConfig.STREAM_HEARTBEAT_MS,
      streamIdleTimeoutMs: modelConfig.STREAM_CHUNK_TIMEOUT_MS + modelConfig.STREAM_HEARTBEAT_MS,
      progressTimeoutMs: modelConfig.STREAM_CHUNK_TIMEOUT_MS,
      totalTimeoutMs:
        modelConfig.UPSTREAM_TIMEOUT_MS +
        modelConfig.STREAM_CHUNK_TIMEOUT_MS +
        modelConfig.STREAM_HEARTBEAT_MS,
      maxRetries: 2,
      retryBaseMs: 1000,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reloads optional timeout and retry policy without exposing provider secrets', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        ...modelConfig,
        STREAM_TOTAL_TIMEOUT_MS: 9000,
        STREAM_MAX_RETRIES: 0,
        STREAM_RETRY_BASE_MS: 50,
      }),
    );
    const response = await streamConfig(request({}));
    const settings = await response.json();
    expect(settings).toMatchObject({
      totalTimeoutMs: 9000 + modelConfig.STREAM_HEARTBEAT_MS,
      maxRetries: 0,
      retryBaseMs: 50,
    });
    expect(Object.keys(settings)).toHaveLength(6);
    expect(JSON.stringify(settings)).not.toContain(modelConfig.MODEL_API_KEY);
  });

  it('keeps generated text when final persistence fails', async () => {
    const recorder = await startChatExchange('test', '', {});
    vi.mocked(startChatExchange).mockResolvedValueOnce({
      ...recorder,
      complete: true,
      finish: vi.fn(async () => {
        throw new Error('database unavailable');
      }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const response = await POST(request(reading));
    const output = await response.text();
    expect(output).toContain('测试解读');
    expect(output).toContain('"persistence":"failed"');
    expect(output).not.toContain('"error"');
  });

  it('propagates request cancellation while connecting upstream', async () => {
    const abort = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            upstreamSignal = options.signal!;
            options.signal!.addEventListener('abort', () =>
              reject(new DOMException('cancelled', 'AbortError')),
            );
          }),
      ),
    );
    const pending = POST(
      new NextRequest('http://localhost/api/interpret', {
        method: 'POST',
        body: JSON.stringify(reading),
        signal: abort.signal,
      }),
    );
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    abort.abort();
    expect((await pending).status).toBe(499);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it('cancels a hanging upstream HTTP error body after headers arrive', async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const upstream = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 500 }));
    vi.stubGlobal('fetch', upstream);
    const pending = POST(
      new NextRequest('http://localhost/api/interpret', {
        method: 'POST',
        body: JSON.stringify(reading),
        signal: abort.signal,
      }),
    );
    await vi.waitFor(() => expect(upstream).toHaveBeenCalled());
    abort.abort();
    expect((await pending).status).toBe(499);
    expect(cancel).toHaveBeenCalled();
  });

  it('times out a hanging upstream HTTP error body without leaking provider details', async () => {
    vi.useFakeTimers();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, UPSTREAM_TIMEOUT_MS: 40 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ReadableStream({}), { status: 500 })),
    );
    const pending = POST(request(reading));
    await vi.advanceTimersByTimeAsync(50);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.text()).not.toContain(modelConfig.MODEL_API_KEY);
  });

  it.each([': heartbeat\n\n', 'data: {"content":"  ","thinking":"  "}\n\n'])(
    'does not allow heartbeats or whitespace to extend model progress: %s',
    async (frame) => {
      vi.useFakeTimers();
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          ...modelConfig,
          STREAM_CHUNK_TIMEOUT_MS: 40,
          STREAM_HEARTBEAT_MS: 10,
          STREAM_TOTAL_TIMEOUT_MS: 1000,
        }),
      );
      let source: ReadableStreamDefaultController<Uint8Array>;
      const cancel = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            new ReadableStream({
              start(ctrl) {
                source = ctrl;
              },
              cancel,
            }),
          ),
        ),
      );
      const response = await POST(request(reading));
      const output = response.text();
      for (let i = 0; i < 3; i++) {
        source!.enqueue(new TextEncoder().encode(frame));
        await vi.advanceTimersByTimeAsync(10);
      }
      await vi.advanceTimersByTimeAsync(20);
      expect(await output).toContain('回复生成超时');
      expect(cancel).toHaveBeenCalled();
    },
  );

  it('enforces total duration even while model content keeps arriving', async () => {
    vi.useFakeTimers();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        ...modelConfig,
        STREAM_CHUNK_TIMEOUT_MS: 100,
        STREAM_HEARTBEAT_MS: 10,
        STREAM_TOTAL_TIMEOUT_MS: 40,
      }),
    );
    let source: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(ctrl) {
              source = ctrl;
            },
          }),
        ),
      ),
    );
    const response = await POST(request(reading));
    const output = response.text();
    for (let i = 0; i < 3; i++) {
      source!.enqueue(new TextEncoder().encode('data: {"content":"内容"}\n\n'));
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(await output).toContain('回复生成超时');
  });

  it('keeps split upstream data frames intact while injecting heartbeats', async () => {
    vi.useFakeTimers();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, STREAM_CHUNK_TIMEOUT_MS: 100, STREAM_HEARTBEAT_MS: 10 }),
    );
    let source: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(ctrl) {
              source = ctrl;
            },
          }),
        ),
      ),
    );
    const response = await POST(request(reading));
    const output = response.text();
    source!.enqueue(new TextEncoder().encode('data: {"content":"半'));
    await vi.advanceTimersByTimeAsync(20);
    source!.enqueue(new TextEncoder().encode('帧答案"}\n\ndata: [DONE]'));
    source!.close();
    const text = await output;
    expect(text).toContain(': keepalive\n\n');
    expect(text).toContain('data: {"content":"半帧答案"}\n\n');
    expect(text).toContain('data: [DONE]\n\n');
  });

  it('forwards the terminal answer before a bounded database wait', async () => {
    vi.useFakeTimers();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, STREAM_CHUNK_TIMEOUT_MS: 40, STREAM_HEARTBEAT_MS: 10 }),
    );
    const recorder = await startChatExchange('test', '', {});
    vi.mocked(startChatExchange).mockResolvedValueOnce({
      ...recorder,
      complete: true,
      finish: vi.fn(() => new Promise<void>(() => {})),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const response = await POST(request(reading));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('测试解读');
    const rest = new Response(
      new ReadableStream({
        async start(ctrl) {
          while (true) {
            const value = await reader.read();
            if (value.done) break;
            ctrl.enqueue(value.value);
          }
          ctrl.close();
        },
      }),
    ).text();
    await vi.advanceTimersByTimeAsync(50);
    const output = await rest;
    expect(output).toContain('"persistence":"failed"');
    expect(output).not.toContain('"error"');
  });

  it.each(['decide', 'direct', 'with-extras'])(
    'passes completed follow-up history into %s prompts without thinking',
    async (mode) => {
      const upstream = vi.fn().mockResolvedValue(new Response(stream));
      vi.stubGlobal('fetch', upstream);
      const response = await POST(
        request({
          ...reading,
          followUp: {
            ...followUp,
            mode,
            additionalCards: mode === 'with-extras' ? supplementary : undefined,
            history: [
              {
                question: '已约好周五见面',
                interpretation: '<think>不应泄露的思考</think>准备见面',
                additionalCards: drawCardsForSpread(spreads[0]),
              },
            ],
          },
        }),
      );
      expect(response.status).toBe(200);
      await response.text();
      const prompt = JSON.parse(upstream.mock.calls[0][1].body)
        .messages.map((message: { content: string }) => message.content)
        .join('\n');
      expect(prompt).toContain('已约好周五见面');
      expect(prompt).toContain('准备见面');
      expect(prompt).not.toContain('不应泄露的思考');
    },
  );

  it.each(
    [
      null,
      {},
      [null],
      [{ question: 3, interpretation: '回答', additionalCards: [] }],
      [{ question: '问题', interpretation: '回答', additionalCards: [null] }],
      [
        {
          question: '问题',
          interpretation: '回答',
          additionalCards: [{ card: {}, position: {}, isReversed: false }],
        },
      ],
    ].map((history) => [history]),
  )('rejects invalid history before calling upstream: %j', async (history) => {
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    const response = await POST(
      request({ ...reading, followUp: { ...followUp, mode: 'direct', history } }),
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    ['reading', reading],
    [
      'daily',
      {
        daily: {
          cardName: 'The Fool',
          cardNameCn: '愚者',
          isReversed: false,
          keywords: ['开始'],
          meaning: '新的旅程',
          dateStr: '2026-09-09',
        },
      },
    ],
    ['agent', { agent: { prompt: '请选择牌阵' } }],
    ['follow-up decision', { ...reading, followUp: { ...followUp, mode: 'decide' } }],
    ['follow-up direct', { ...reading, followUp: { ...followUp, mode: 'direct' } }],
    [
      'follow-up extras',
      {
        ...reading,
        followUp: { ...followUp, mode: 'with-extras', additionalCards: supplementary },
      },
    ],
  ])('uses the server model for %s without browser configuration', async (_mode, body) => {
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    const output = await response.text();
    expect(output).toContain(stream);
    expect(output).toContain('"persistence":"saved"');
    expect(upstream.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const options = upstream.mock.calls[0][1];
    expect(options.headers.Authorization).toBe('Bearer server-test-key');
    expect(JSON.parse(options.body)).toMatchObject({ model: 'deepseek-v4-flash', stream: true });
    expect(JSON.parse(options.body).messages[0].content.length).toBeGreaterThan(0);
  });

  it('ignores stale or malicious client provider overrides', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    const response = await POST(
      request({
        ...reading,
        apiConfig: { endpoint: 'https://other.invalid', apiKey: 'old-key', model: 'old-model' },
      }),
    );
    await response.text();
    expect(upstream.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(upstream.mock.calls[0][1].headers.Authorization).toBe('Bearer server-test-key');
    expect(JSON.parse(upstream.mock.calls[0][1].body).model).toBe('deepseek-v4-flash');
  });

  it('returns availability without exposing provider configuration', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ available: true, intentEnabled: false });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('fails gracefully when the server has no key', async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ ...modelConfig, MODEL_API_KEY: '' }));
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect(await (await GET()).json()).toEqual({ available: false, intentEnabled: false });
    expect((await POST(request(reading))).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['invalid json', 'null', '{"MODEL_BASE_URL":42}'])(
    'handles invalid configuration files: %s',
    async (content) => {
      vi.mocked(readFileSync).mockReturnValue(content);
      expect(await (await GET()).json()).toEqual({ available: false, intentEnabled: false });
    },
  );

  it('handles a missing file', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect((await POST(request(reading))).status).toBe(503);
  });

  it('reads file changes on the next request and ignores environment overrides', async () => {
    vi.stubEnv('MODEL_ID', 'old-env-model');
    const upstream = vi.fn().mockImplementation(() => Promise.resolve(new Response(stream)));
    vi.stubGlobal('fetch', upstream);
    await (await POST(request(reading))).text();
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, MODEL_ID: 'updated-file-model' }),
    );
    await (await POST(request(reading))).text();
    expect(JSON.parse(upstream.mock.calls[0][1].body).model).toBe('deepseek-v4-flash');
    expect(JSON.parse(upstream.mock.calls[1][1].body).model).toBe('updated-file-model');
  });

  it('redacts the server key from upstream errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid server-test-key', { status: 401 })),
    );
    const response = await POST(request(reading));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('server-test-key');
  });

  it('takes output tokens from JSON and reloads changes', async () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, MAX_OUTPUT_TOKENS: 2048 }),
    );
    const upstream = vi.fn().mockImplementation(() => Promise.resolve(new Response(stream)));
    vi.stubGlobal('fetch', upstream);
    const first = request(reading);
    await (await POST(first)).text();
    expect(JSON.parse(upstream.mock.calls[0][1].body).max_tokens).toBe(2048);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ ...modelConfig, MAX_OUTPUT_TOKENS: 4096 }),
    );
    const third = request(reading);
    third.headers.set('x-real-ip', first.headers.get('x-real-ip')!);
    await (await POST(third)).text();
    expect(JSON.parse(upstream.mock.calls[1][1].body).max_tokens).toBe(4096);
  });

  it('allows more than ten AI requests from the same user without an hourly quota', async () => {
    const upstream = vi.fn().mockImplementation(() => Promise.resolve(new Response(stream)));
    vi.stubGlobal('fetch', upstream);
    for (let i = 0; i < 12; i++) {
      const next = request(reading);
      next.headers.set('x-real-ip', 'unlimited-user');
      const response = await POST(next);
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(upstream).toHaveBeenCalledTimes(12);
  });

  it.each([
    'UPSTREAM_TIMEOUT_MS',
    'MAX_OUTPUT_TOKENS',
    'STREAM_CHUNK_TIMEOUT_MS',
    'STREAM_HEARTBEAT_MS',
  ])('fails before opening upstream resources when %s is missing', async (key) => {
    const config: Record<string, unknown> = { ...modelConfig };
    delete config[key];
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await POST(request(reading))).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });

  it('omits provider settings from browser AI requests', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', upstream);
    const result = await streamInterpret(
      { ...reading, apiConfig: { apiKey: 'old-browser-key' } },
      {},
      {
        connectTimeoutMs: 1000,
        streamIdleTimeoutMs: 1000,
        progressTimeoutMs: 1000,
        totalTimeoutMs: 5000,
        maxRetries: 0,
        retryBaseMs: 1,
      },
    );
    expect(result.fullText).toBe('测试解读');
    const payload = JSON.parse(upstream.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      ...reading,
      operationId: expect.any(String),
      attemptId: expect.any(String),
    });
    expect(payload).not.toHaveProperty('apiConfig');
  });
});
