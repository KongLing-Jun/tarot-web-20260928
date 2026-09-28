// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/intent/route';
import { analyzeIntent, loadIntentForReading } from '@/lib/server/intent';
import { getIntentSnapshot, getReadingIntentMessages } from '@/lib/server/intent-store';
import { database } from '@/lib/server/database';
import { requireUser } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/http';
import { getIntentRecognitionEnabled } from '@/lib/api/server-config';
import type { IntentCandidate, IntentSnapshot } from '@/lib/intent/types';

vi.mock('@/lib/server/database', () => ({ database: vi.fn() }));
vi.mock('@/lib/server/auth', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/api/server-config', () => ({
  getIntentRecognitionEnabled: vi.fn(() => true),
  getModelConfig: () => ({
    endpoint: 'https://model.test/v1',
    apiKey: 'private-test',
    model: 'test',
  }),
  getModelGenerationOptions: () => ({}),
  getServerNumber: () => 1000,
}));
vi.mock('@/lib/api/stream-settings', () => ({
  getStreamSettings: () => ({ upstreamTimeoutMs: 1000 }),
}));

const candidate: IntentCandidate = {
  task: 'prepare',
  turnAction: 'new',
  subject: null,
  goal: null,
  facts: [],
  constraints: [],
  wantsAdvice: true,
  missingInformation: [],
};
const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const question = '明天面试，今晚怎么准备';
const snapshot: IntentSnapshot = {
  id,
  version: 1,
  revision: 1,
  question,
  sceneId: 'preparation',
  messages: [{ id: 'message-1', text: question }],
  candidate,
  plan: { mode: 'reading', includeAction: true, reuseExistingCards: false, clarification: null },
};
const query = vi.fn();
const upstream = vi.fn();
function response(value: unknown = candidate, finish = 'stop') {
  return Response.json({
    choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }],
  });
}
function request(body: unknown) {
  return new NextRequest('http://localhost/api/intent', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(database).mockReturnValue({ query } as unknown as ReturnType<typeof database>);
  vi.mocked(requireUser).mockResolvedValue({ id: 'user-a' } as Awaited<
    ReturnType<typeof requireUser>
  >);
  query.mockResolvedValue({ rows: [], rowCount: 1 });
  upstream.mockResolvedValue(response());
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => vi.unstubAllGlobals());

describe('server intent evidence and storage', () => {
  const drawnCards = [
    {
      card: { id: 'major-00' },
      isReversed: false,
      position: { id: 'current', name: 'Current', nameCn: '现状', description: '当前状态' },
    },
  ];
  function modelReadingContext() {
    const body = JSON.parse(upstream.mock.calls[0][1].body);
    return JSON.parse(
      body.messages.find((message: { role: string }) => message.role === 'user').content,
    ).readingContext;
  }

  it('marks initial recognition as having no existing cards', async () => {
    const result = await analyzeIntent('user-a', { question });
    expect(modelReadingContext()).toEqual({ hasExistingCards: false });
    expect(result.plan.reuseExistingCards).toBe(false);
  });

  it.each([
    { cards: drawnCards, expected: true },
    { cards: [], expected: false },
    { cards: undefined, expected: false },
  ])(
    'uses verified owned cards for recognition and reuse: $expected',
    async ({ cards, expected }) => {
      query.mockResolvedValueOnce({ rows: [{ data: { question, drawnCards: cards } }] });
      upstream.mockResolvedValueOnce(
        response({ ...candidate, task: 'explain-cards', turnAction: 'follow-up' }),
      );
      const result = await analyzeIntent('user-a', { question: '请解释原牌', readingId: 'r1' });
      expect(modelReadingContext()).toEqual({ hasExistingCards: expected });
      expect(result.plan.reuseExistingCards).toBe(expected);
      expect(query.mock.calls[0][1]).toEqual(['user-a', 'r1']);
    },
  );

  it('ignores forged card state and cards in client input', async () => {
    query.mockResolvedValueOnce({ rows: [{ data: { question, drawnCards: [] } }] });
    upstream.mockResolvedValueOnce(response({ ...candidate, task: 'explain-cards' }));
    const result = await POST(
      request({
        question,
        readingId: 'r1',
        hasExistingCards: true,
        readingContext: { hasExistingCards: true },
        drawnCards,
      }),
    );
    expect(result.status).toBe(200);
    expect(modelReadingContext()).toEqual({ hasExistingCards: false });
    expect((await result.json()).plan.reuseExistingCards).toBe(false);
  });

  it('does not use a foreign reading or invoke its model', async () => {
    await expect(analyzeIntent('user-b', { question, readingId: 'foreign' })).rejects.toMatchObject(
      { status: 404 },
    );
    expect(query).toHaveBeenCalledWith(expect.stringContaining('user_id = $1 AND id = $2'), [
      'user-b',
      'foreign',
    ]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects malformed stored cards before recognition', async () => {
    query.mockResolvedValueOnce({
      rows: [{ data: { question, drawnCards: [{ card: { id: 'invented' } }] } }],
    });
    await expect(analyzeIntent('user-a', { question, readingId: 'r1' })).rejects.toMatchObject({
      status: 400,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('preserves repeated statements with distinct message ids in correction order', async () => {
    const first = { id: 'first', text: '我想跳槽' };
    const second = { id: 'second', text: '我不想跳槽' };
    const third = { id: 'third', text: '我想跳槽' };
    const secondId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const thirdId = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
    query
      .mockResolvedValueOnce({
        rows: [
          {
            data: {
              question: first.text,
              sceneId: 'preparation',
              intentId: id,
              followUps: [
                { id: 'f1', question: second.text, intentId: secondId },
                { id: 'f2', question: third.text, intentId: thirdId },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ snapshot: { ...snapshot, question: first.text, messages: [first] } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot: {
              ...snapshot,
              id: secondId,
              readingId: 'r1',
              question: second.text,
              messages: [first, second],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot: {
              ...snapshot,
              id: thirdId,
              readingId: 'r1',
              question: third.text,
              messages: [first, second, third],
            },
          },
        ],
      });
    expect(await getReadingIntentMessages('user-a', 'r1')).toEqual([first, second, third]);
  });

  it('rejects conflicting text for the same stable historical message id', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            data: {
              question,
              sceneId: 'preparation',
              intentId: id,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot: {
              ...snapshot,
              messages: [
                { id: 'conflict', text: '早先内容' },
                { id: 'conflict', text: '被改写的内容' },
                { id: 'latest', text: question },
              ],
            },
          },
        ],
      });
    await expect(getReadingIntentMessages('user-a', 'r1')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a snapshot whose last message does not match the linked question', async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            data: {
              question,
              sceneId: 'preparation',
              intentId: id,
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            snapshot: {
              ...snapshot,
              messages: [{ id: 'wrong-last', text: '其他问题' }],
            },
          },
        ],
      });
    await expect(getReadingIntentMessages('user-a', 'r1')).rejects.toMatchObject({ status: 409 });
  });

  it('keeps original A/B context and clarification evidence for later follow-ups without assistant text', async () => {
    const original = { id: 'original', text: 'A是稳定工作，B是创业，该怎么选' };
    const clarification = { id: 'clarification', text: '我更看重稳定' };
    const followUpQuestion = { id: 'follow-up-question', text: '还有什么风险需要准备' };
    const followUpAnswer = { id: 'follow-up-answer', text: '主要担心收入变化' };
    const nextQuestion = '那第一步做什么';
    const followUpId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
    const initial: IntentSnapshot = {
      ...snapshot,
      sceneId: 'two-options',
      question: clarification.text,
      messages: [original, clarification],
    };
    const subsequent: IntentSnapshot = {
      ...initial,
      id: followUpId,
      readingId: 'r1',
      question: followUpAnswer.text,
      messages: [original, clarification, followUpQuestion, followUpAnswer],
    };
    query
      .mockResolvedValueOnce({
        rows: [
          {
            data: {
              question: clarification.text,
              sceneId: 'two-options',
              intentId: id,
              interpretation: '模型说你已经决定创业',
              followUps: [
                {
                  id: 'f1',
                  question: followUpAnswer.text,
                  intentId: followUpId,
                  interpretation: '模型虚构的事实',
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ snapshot: initial }] })
      .mockResolvedValueOnce({ rows: [{ snapshot: subsequent }] });
    const result = await analyzeIntent('user-a', { readingId: 'r1', question: nextQuestion });
    expect(result.messages.map((message) => message.text)).toEqual([
      original.text,
      clarification.text,
      followUpQuestion.text,
      followUpAnswer.text,
      nextQuestion,
    ]);
    expect(result.messages.slice(0, 4)).toEqual([
      original,
      clarification,
      followUpQuestion,
      followUpAnswer,
    ]);
    expect(query.mock.calls[1][1]).toEqual(['user-a', id]);
    expect(query.mock.calls[2][1]).toEqual(['user-a', followUpId]);
    expect(JSON.stringify(result.messages)).not.toContain('模型');
  });

  it('refuses a foreign intent referenced by an owned historical reading', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ data: { question, sceneId: 'preparation', intentId: id } }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(getReadingIntentMessages('user-a', 'r1')).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[1][1]).toEqual(['user-a', id]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    { ...snapshot, question: '与保存记录不同的问题' },
    { ...snapshot, sceneId: 'two-options' },
    { ...snapshot, readingId: 'another-reading' },
    { ...snapshot, version: 0 },
    { ...snapshot, plan: { ...snapshot.plan, mode: 'clarify' as const } },
  ])(
    'rejects invalid historical initial bindings instead of admitting unrelated evidence',
    async (stored) => {
      query
        .mockResolvedValueOnce({
          rows: [{ data: { question, sceneId: 'preparation', intentId: id } }],
        })
        .mockResolvedValueOnce({ rows: [{ snapshot: stored }] });
      await expect(getReadingIntentMessages('user-a', 'r1')).rejects.toMatchObject({ status: 409 });
    },
  );

  it.each([undefined, 'another-reading'])(
    'requires historical follow-up snapshots to bind the same reading: %s',
    async (readingId) => {
      query
        .mockResolvedValueOnce({
          rows: [
            {
              data: {
                question: '原问题',
                sceneId: 'preparation',
                followUps: [{ id: 'f1', question, intentId: id }],
              },
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ snapshot: { ...snapshot, readingId } }] });
      await expect(getReadingIntentMessages('user-a', 'r1')).rejects.toMatchObject({ status: 409 });
    },
  );

  it('stores a server-generated snapshot with ownership and configured model budget', async () => {
    const result = await analyzeIntent('user-a', { question, sceneId: 'preparation' });
    expect(result).toMatchObject({ question, revision: 1, sceneId: 'preparation', candidate });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tarot_user_intents'), [
      result.id,
      'user-a',
      null,
      1,
      JSON.stringify(result),
    ]);
    const body = JSON.parse(upstream.mock.calls[0][1].body);
    expect(body).toMatchObject({ stream: false, max_tokens: 1000, model: 'test' });
  });

  it('isolates missing and foreign snapshots by user_id', async () => {
    await expect(getIntentSnapshot('user-b', id)).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('user_id = $1 AND id = $2'), [
      'user-b',
      id,
    ]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('loads only user questions from owned reading history', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          data: {
            question: '尚未面试',
            interpretation: 'assistant cannot be evidence',
            followUps: [{ id: 'f1', question: '不是换工作', interpretation: 'irrelevant' }],
          },
        },
      ],
    });
    expect(await getReadingIntentMessages('user-a', 'reading-1')).toEqual([
      { id: 'reading:reading-1', text: '尚未面试' },
      { id: 'follow-up:reading-1:f1', text: '不是换工作' },
    ]);
    expect(query.mock.calls[0][1]).toEqual(['user-a', 'reading-1']);
  });

  it('creates an immutable next revision with previous user evidence', async () => {
    query.mockResolvedValueOnce({ rows: [{ snapshot }] });
    const result = await analyzeIntent('user-a', {
      question: '只想倾诉',
      sceneId: 'preparation',
      previousIntentId: id,
    });
    expect(result.revision).toBe(2);
    expect(result.messages[0]).toEqual(snapshot.messages[0]);
    expect(result.messages.at(-1)?.text).toBe('只想倾诉');
    expect(query.mock.calls[1][1][2]).toBe(id);
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE'))).toBe(false);
  });

  it('rejects changed scene before calling model', async () => {
    query.mockResolvedValueOnce({ rows: [{ snapshot }] });
    await expect(
      analyzeIntent('user-a', { question, sceneId: 'progress', previousIntentId: id }),
    ).rejects.toMatchObject({ status: 409 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    {
      ...candidate,
      facts: [{ value: '已经失败', source: { messageId: 'forged', quote: '已经失败' } }],
    },
    { ...candidate, task: 'invented' },
    null,
  ])('refuses malformed or forged model evidence', async (value) => {
    upstream.mockResolvedValueOnce(response(value));
    await expect(analyzeIntent('user-a', { question })).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects truncated output instead of saving partial intent', async () => {
    upstream.mockResolvedValueOnce(response(candidate, 'length'));
    await expect(analyzeIntent('user-a', { question })).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it('accepts complete fenced JSON', async () => {
    upstream.mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: '```json\n' + JSON.stringify(candidate) + '\n```',
            },
          },
        ],
      }),
    );
    await expect(analyzeIntent('user-a', { question })).resolves.toHaveProperty(
      'candidate',
      candidate,
    );
  });

  it('does not invoke model when request has already been cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyzeIntent('user-a', { question }, controller.signal)).rejects.toMatchObject({
      status: 503,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    { ...snapshot, question: '过时问题' },
    { ...snapshot, sceneId: 'progress' },
    { ...snapshot, plan: { ...snapshot.plan, mode: 'clarify' } },
    { ...snapshot, readingId: 'another-reading' },
  ])('refuses stale or unready intent during generation', async (stored) => {
    query.mockResolvedValueOnce({ rows: [{ snapshot: stored }] });
    await expect(
      loadIntentForReading('user-a', id, question, { sceneId: 'preparation' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('recovers saved reading scene and still enforces reading ownership', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ snapshot }] })
      .mockResolvedValueOnce({ rows: [{ data: { question, sceneId: 'preparation' } }] });
    await expect(
      loadIntentForReading('user-a', id, question, { readingId: 'r1' }),
    ).resolves.toEqual(snapshot);
    expect(query.mock.calls[1][1]).toEqual(['user-a', 'r1']);
    query.mockResolvedValueOnce({ rows: [{ snapshot }] }).mockResolvedValueOnce({ rows: [] });
    await expect(
      loadIntentForReading('user-a', id, question, { readingId: 'foreign' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('/api/intent', () => {
  it('returns unavailable without invoking recognition when the capability is disabled', async () => {
    vi.mocked(getIntentRecognitionEnabled).mockReturnValueOnce(false);
    const result = await POST(request({ question }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: '意图识别尚未启用' });
    expect(upstream).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it('does not bind an initial intent to an unrelated existing question', async () => {
    query.mockResolvedValueOnce({ rows: [{ snapshot }] }).mockResolvedValueOnce({
      rows: [{ data: { question: '别的问题', sceneId: 'preparation' } }],
    });
    await expect(
      loadIntentForReading('user-a', id, question, { readingId: 'r1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cannot override the stored scene with a matching client-supplied scene', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ snapshot }] })
      .mockResolvedValueOnce({ rows: [{ data: { question, sceneId: 'progress' } }] });
    await expect(
      loadIntentForReading('user-a', id, question, { readingId: 'r1', sceneId: 'preparation' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('recovers the scene from owned reading before recognition', async () => {
    query.mockResolvedValueOnce({
      rows: [{ data: { question: '原问题', sceneId: 'preparation' } }],
    });
    const result = await analyzeIntent('user-a', { question, readingId: 'r1' });
    expect(result.sceneId).toBe('preparation');
    expect(result.messages[0]).toEqual({ id: 'reading:r1', text: '原问题' });
  });

  it('rejects a forged scene for an owned reading', async () => {
    query.mockResolvedValueOnce({ rows: [{ data: { question, sceneId: 'preparation' } }] });
    await expect(
      analyzeIntent('user-a', { question, readingId: 'r1', sceneId: 'progress' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('aborts an in-flight model request without saving an intent', async () => {
    upstream.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    );
    const controller = new AbortController();
    const pending = analyzeIntent('user-a', { question }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON', async () => {
    const result = await POST(
      new NextRequest('http://localhost/api/intent', { method: 'POST', body: '{invalid' }),
    );
    expect(result.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new HttpError(401, '请登录后使用'));
    expect((await POST(request({ question }))).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([
    { question: '' },
    { question: '字'.repeat(501) },
    { question, sceneId: 'unknown' },
    { question, readingId: {} },
  ])('rejects invalid input before model invocation', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns a snapshot directly with no-store', async () => {
    const result = await POST(request({ question }));
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ question, candidate });
  });
  it('does not expose model response secrets on provider failure', async () => {
    upstream.mockResolvedValueOnce(
      new Response('private-test secret-vendor-body', { status: 500 }),
    );
    const result = await POST(request({ question }));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toMatch(/private-test|secret-vendor-body/);
  });
});
