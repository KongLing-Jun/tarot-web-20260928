// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/interpret/route';
import { loadIntentForReading } from '@/lib/server/intent';
import { streamInterpret } from '@/lib/api/stream-client';
import { runAgentTurn, runFollowUpTurn } from '@/lib/agent/agentTurn';
import { getSpreadById } from '@/lib/tarot/spreads';
import { allCards } from '@/lib/tarot/cards';
import type { ApiConfig } from '@/lib/tarot/types';
import type { IntentSnapshot } from '@/lib/intent/types';

vi.mock('@/lib/server/auth', () => ({ requireUser: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/server/intent', () => ({ loadIntentForReading: vi.fn() }));
vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));
vi.mock('@/lib/server/chat', () => ({
  startChatExchange: async () => ({ append: async () => {}, finish: async () => {} }),
}));
vi.mock('@/lib/api/server-config', () => ({
  getModelConfig: () => ({ endpoint: 'https://model.test/v1', apiKey: 'test', model: 'test' }),
  getModelGenerationOptions: () => ({}),
  getReadingPromptProfile: () => 'p1',
  getServerNumber: () => 4096,
}));
vi.mock('@/lib/api/stream-settings', () => ({
  getStreamSettings: () => ({
    upstreamTimeoutMs: 10000,
    chunkTimeoutMs: 10000,
    heartbeatMs: 5000,
    totalTimeoutMs: 20000,
  }),
}));

const snapshot: IntentSnapshot = {
  id: 'intent-1',
  version: 1,
  revision: 2,
  question: '稳定最重要',
  messages: [
    { id: 'm1', text: '我在两份工作之间犹豫，A收入高但不稳定，B收入低且稳定。' },
    { id: 'm2', text: '稳定最重要' },
  ],
  candidate: {
    task: 'compare',
    turnAction: 'follow-up',
    subject: null,
    goal: null,
    facts: [],
    constraints: [],
    wantsAdvice: true,
    missingInformation: [],
  },
  plan: { mode: 'reading', includeAction: true, reuseExistingCards: false, clarification: null },
};
const upstream = vi.fn();
const complete = { fullText: '正文', receivedError: false, truncated: false, usingFallback: false };
const base = {
  question: snapshot.question,
  apiConfig: {} as ApiConfig,
  signal: new AbortController().signal,
  callbacks: {},
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadIntentForReading).mockResolvedValue(snapshot);
  upstream.mockResolvedValue(
    new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n'),
  );
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => vi.unstubAllGlobals());

it('initial spread choice sends intent references without querying a not-yet-created reading', async () => {
  vi.mocked(streamInterpret)
    .mockResolvedValueOnce({ ...complete, fullText: '{"spreadId":"single","reason":"原因"}' })
    .mockResolvedValue(complete);
  await runAgentTurn({
    ...base,
    readingId: 'new-reading',
    intentId: 'intent-1',
    sceneId: 'two-options',
  });
  const body = vi.mocked(streamInterpret).mock.calls[0][0];
  expect(body).toMatchObject({
    question: snapshot.question,
    intentId: 'intent-1',
    sceneId: 'two-options',
    agent: { internal: true },
  });
  expect(body).not.toHaveProperty('readingId');
});

it('follow-up decision carries its owned reading and latest intent', async () => {
  vi.mocked(streamInterpret)
    .mockResolvedValueOnce({
      ...complete,
      fullText: '{"decision":"direct","drawCount":0,"reason":"原因"}',
    })
    .mockResolvedValue(complete);
  await runFollowUpTurn({
    ...base,
    originalQuestion: '原问题',
    followUpQuestion: snapshot.question,
    previousInterpretation: '旧回答',
    spread: getSpreadById('single')!,
    drawnCards: [],
    readingId: 'reading-1',
    intentId: 'intent-1',
  });
  expect(vi.mocked(streamInterpret).mock.calls[0][0]).toMatchObject({
    readingId: 'reading-1',
    question: snapshot.question,
    intentId: 'intent-1',
    agent: { internal: true },
  });
});

it.each(['internal', 'follow-up'] as const)(
  '%s decision receives full verified clarification context without reading instructions',
  async (kind) => {
    const spread = getSpreadById('single')!;
    const body =
      kind === 'internal'
        ? { question: snapshot.question, agent: { internal: true, prompt: '只返回选阵 JSON' } }
        : {
            question: '原问题',
            spread,
            drawnCards: [{ card: allCards[0], isReversed: false, position: spread.positions[0] }],
            followUp: {
              mode: 'decide',
              previousInterpretation: '旧回答',
              followUpQuestion: snapshot.question,
            },
          };
    const response = await POST(
      new NextRequest('http://localhost/api/interpret', {
        method: 'POST',
        body: JSON.stringify({ ...body, intentId: 'intent-1' }),
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(loadIntentForReading).toHaveBeenCalledWith('user-1', 'intent-1', snapshot.question, {
      sceneId: undefined,
      readingId: undefined,
    });
    const messages = JSON.parse(upstream.mock.calls[0][1].body).messages as {
      role: string;
      content: string;
    }[];
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    expect(system).toContain('只输出当前决策要求的 JSON');
    expect(system).not.toContain('clarify 只提出 clarification');
    expect(system).not.toContain(snapshot.messages[0].text);
    const context = messages
      .filter((m) => m.role === 'user')
      .map((m) => {
        try {
          return JSON.parse(m.content);
        } catch {
          return null;
        }
      })
      .find((m) => m?.latestQuestion);
    expect(context.messages).toEqual(snapshot.messages);
  },
);
