// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/config.mjs', () => ({
  readSettings: () => ({
    MODEL_BASE_URL: 'https://api.deepseek.com/v1',
    MODEL_API_KEY: 'private-fixture-key',
  }),
}));
const options = (maxRequests = 2) => ({
  config: { model: 'review-fixture-model', timeoutMs: 1000, maxOutputTokens: 2000, maxRequests },
});
const input = {
  scenario: {
    question: '能继续吗',
    knownFacts: ['还未收到回复'],
    goal: '判断倾向',
    review: ['不要编造心理'],
    cards: [],
  },
  answerA: '暂时不支持继续推进。还没有回复。',
  answerB: '倾向先等明确信息。不要推断心理。',
};
const dimensions = ['directAnswer', 'consistency', 'efficiency', 'cardConnection', 'faithfulness'];
const review = () => ({
  answerA: {
    scores: Object.fromEntries(dimensions.map((key) => [key, 1])),
    firstTwoSentencesAnswer: true,
    evidence: dimensions.map((dimension) => ({
      dimension,
      quote: '还没有回复',
      reason: '可见事实',
    })),
    severeErrors: [],
  },
  answerB: {
    scores: Object.fromEntries(dimensions.map((key) => [key, 2])),
    firstTwoSentencesAnswer: true,
    evidence: dimensions.map((dimension) => ({ dimension, quote: '明确信息', reason: '清晰表达' })),
    severeErrors: [],
  },
  winner: 'B',
  winnerReason: '回应更直接',
});
const response = (content = JSON.stringify(review()), finish_reason = 'stop') =>
  new Response(
    JSON.stringify({
      model: 'actual-review-model',
      choices: [{ message: { content, reasoning_content: '不可泄露思考' }, finish_reason }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    }),
  );

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bounded blinded reading reviewer', () => {
  it('requires explicit policy and rejects unknown numeric budgets', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    for (const config of [
      {},
      { ...options().config, maxRequests: 0 },
      { ...options().config, timeoutMs: NaN },
      { ...options().config, model: '' },
    ]) {
      expect(() => new Provider({ config })).toThrow();
    }
  });

  it('refuses to run a frozen review after the rubric has changed', async () => {
    const { default: Provider, READING_REVIEW_RUBRIC_HASH } =
      await import('../scripts/reading-review-provider.mjs');
    expect(() => new Provider({ config: { ...options().config, rubricHash: 'changed' } })).toThrow(
      '冻结',
    );
    expect(
      () =>
        new Provider({ config: { ...options().config, rubricHash: READING_REVIEW_RUBRIC_HASH } }),
    ).not.toThrow();
  });

  it('uses system rubric and blinded material, records actual model and usage without reasoning or keys', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    const result = await new Provider(options()).callApi('unused', {
      vars: {
        scenario: JSON.stringify(input.scenario),
        answerA: input.answerA,
        answerB: input.answerB,
      },
    });
    expect(JSON.parse(result.output!)).toMatchObject({ winner: 'B' });
    expect(result).toMatchObject({
      metadata: { responseModel: 'actual-review-model', usage: { total_tokens: 140 } },
      tokenUsage: { total: 140, prompt: 100, completion: 40 },
    });
    expect(JSON.stringify(result)).not.toMatch(/private-fixture-key|不可泄露思考/);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: 'review-fixture-model',
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
      stream: false,
    });
    expect(body.messages[1].content).toContain(input.answerA);
    expect(body.messages[0].content).toContain('五个维度');
    expect(fetcher.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('enforces the same global cap across instances without retrying paid failures', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('Bearer private-fixture-key error', { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const one = new Provider(options(1));
    expect(await one.callApi(JSON.stringify(input))).toMatchObject({
      error: expect.stringContaining('401'),
    });
    expect(await one.callApi(JSON.stringify(input))).toMatchObject({
      error: expect.stringContaining('预算'),
    });
    expect(await new Provider(options(10)).callApi(JSON.stringify(input))).toMatchObject({
      error: expect.stringContaining('预算'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not leak credentials from network or HTTP errors', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Bearer private-fixture-key full request')),
    );
    const result = await new Provider(options()).callApi(JSON.stringify(input));
    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).not.toMatch(/private-fixture-key|Bearer|full request/);
  });

  it('rejects truncation even when the returned JSON is valid', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(JSON.stringify(review()), 'length')));
    expect(await new Provider(options()).callApi(JSON.stringify(input))).toMatchObject({
      error: expect.stringContaining('完整'),
    });
  });

  it.each(['length', 'invalid-json'])(
    'keeps paid usage when the reviewer output fails validation: %s',
    async (failure) => {
      const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            response(
              failure === 'invalid-json' ? '{}' : JSON.stringify(review()),
              failure === 'length' ? 'length' : 'stop',
            ),
          ),
      );
      const result = await new Provider(options()).callApi(JSON.stringify(input));
      expect(result).toMatchObject({
        error: expect.any(String),
        metadata: { responseModel: 'actual-review-model', usage: { total_tokens: 140 } },
        tokenUsage: { total: 140 },
      });
      expect(JSON.stringify(result)).not.toMatch(/private-fixture-key|不可泄露思考/);
    },
  );

  it('times out a stuck upstream and aborts without retry', async () => {
    vi.useFakeTimers();
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const pending = new Provider(options()).callApi(JSON.stringify(input));
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ error: expect.stringContaining('超时') });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('honors external abort before consuming budget', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const fetcher = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetcher);
    const provider = new Provider(options(1));
    const abort = new AbortController();
    abort.abort();
    expect(
      await provider.callApi(JSON.stringify(input), {}, { abortSignal: abort.signal }),
    ).toMatchObject({ error: expect.stringContaining('取消') });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await provider.callApi(JSON.stringify(input))).toHaveProperty('output');
  });

  it('aborts an in-flight body read and does not wait for an uncooperative transport', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) });
    vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController();
    const pending = new Provider(options()).callApi(
      JSON.stringify(input),
      {},
      { abortSignal: abort.signal },
    );
    await Promise.resolve();
    abort.abort();
    expect(await pending).toMatchObject({ error: expect.stringContaining('取消') });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('rejects malformed material before spending budget and invalid model JSON without a retry', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const fetcher = vi.fn().mockResolvedValue(response('{"incomplete":true}'));
    vi.stubGlobal('fetch', fetcher);
    const provider = new Provider(options(1));
    expect(await provider.callApi('{')).toMatchObject({ error: expect.any(String) });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await provider.callApi(JSON.stringify(input))).toMatchObject({
      error: expect.stringContaining('校验'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('validates score ranges, evidence quotations, required dimensions and winner', async () => {
    const { parseReadingReview } = await import('../scripts/reading-review-provider.mjs');
    expect(parseReadingReview(JSON.stringify(review()), input)).toMatchObject({ winner: 'B' });
    expect(() => parseReadingReview('not json', input)).toThrow();
    const badScore = review();
    badScore.answerA.scores.directAnswer = 3;
    const inventedQuote = review();
    inventedQuote.answerA.evidence[0].quote = '题目和回答均无这句话';
    const missing = review();
    delete missing.answerB.scores.faithfulness;
    const unknownWinner = { ...review(), winner: 'candidate-p1' };
    for (const invalid of [badScore, inventedQuote, missing, unknownWinner])
      expect(() => parseReadingReview(JSON.stringify(invalid), input)).toThrow();
  });

  it('numbers original answer lines without rewriting punctuation, whitespace or blank line positions', async () => {
    const { buildReadingReviewPrompt } = await import('../scripts/reading-review-provider.mjs');
    const material = {
      ...input,
      answerA: '## 判断\r\n\r\n  倾向继续：但还未确认。\n下一步需核实。',
    };
    const prompt = JSON.parse(buildReadingReviewPrompt(material));
    expect(prompt.answerA).toEqual([
      { id: 'A:1', text: '## 判断' },
      { id: 'A:3', text: '  倾向继续：但还未确认。' },
      { id: 'A:4', text: '下一步需核实。' },
    ]);
    expect(prompt.answerB).toEqual([{ id: 'B:1', text: input.answerB }]);
  });

  it('resolves evidence IDs to exact source quotes and preserves the legacy result shape', async () => {
    const { parseReadingReview } = await import('../scripts/reading-review-provider.mjs');
    const material = { ...input, answerA: '倾向继续。\n\n 对方已经决定承诺。' };
    const indexed = {
      ...review(),
      answerA: {
        ...review().answerA,
        evidence: dimensions.map((dimension) => ({
          dimension,
          evidenceId: 'A:1',
          reason: '判断是否答题',
        })),
        severeErrors: [{ evidenceId: 'A:3', reason: '题目未提供承诺事实，牌面不能证明心理' }],
      },
    };
    const result = parseReadingReview(JSON.stringify(indexed), material);
    expect(result.answerA.evidence[0]).toEqual({
      dimension: 'directAnswer',
      quote: '倾向继续。',
      reason: '判断是否答题',
    });
    expect(result.answerA.severeErrors[0]).toEqual({
      quote: ' 对方已经决定承诺。',
      reason: '题目未提供承诺事实，牌面不能证明心理',
    });
    expect(result.answerB).toEqual(review().answerB);
    expect(JSON.stringify(result)).not.toContain('evidenceId');
  });

  it('normalizes a numbered upstream review before returning the existing summary format', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const indexed = {
      ...review(),
      answerA: {
        ...review().answerA,
        evidence: dimensions.map((dimension) => ({
          dimension,
          evidenceId: 'A:1',
          reason: '核心正文',
        })),
      },
      answerB: {
        ...review().answerB,
        evidence: dimensions.map((dimension) => ({
          dimension,
          evidenceId: 'B:1',
          reason: '核心正文',
        })),
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(JSON.stringify(indexed))));
    const result = await new Provider(options()).callApi(JSON.stringify(input));
    expect(result.error).toBeUndefined();
    const parsed = JSON.parse(result.output!);
    expect(parsed.answerA.evidence[0]).toEqual({
      dimension: 'directAnswer',
      quote: input.answerA,
      reason: '核心正文',
    });
    expect(parsed.answerB.evidence[0].quote).toBe(input.answerB);
    expect(result.tokenUsage).toMatchObject({ total: 140 });
  });

  it.each([
    { evidenceId: 'B:1' },
    { evidenceId: 'A:2' },
    { evidenceId: 'A:999' },
    { evidenceId: 1 },
    { evidenceId: 'A:1', quote: '模型改写过的引文' },
  ])('rejects unknown, cross-answer or mismatched evidence references: %j', async (reference) => {
    const { parseReadingReview } = await import('../scripts/reading-review-provider.mjs');
    const invalid = {
      ...review(),
      answerA: {
        ...review().answerA,
        evidence: dimensions.map((dimension) => ({
          dimension,
          ...reference,
          reason: '不能降低证据可核验性',
        })),
      },
    };
    expect(() => parseReadingReview(JSON.stringify(invalid), input)).toThrow('引用无法核验');
  });

  it('also rejects a severe error referring to the other answer', async () => {
    const { parseReadingReview } = await import('../scripts/reading-review-provider.mjs');
    const invalid = {
      ...review(),
      answerA: {
        ...review().answerA,
        severeErrors: [{ evidenceId: 'B:1', reason: '错误绑定回答' }],
      },
    };
    expect(() => parseReadingReview(JSON.stringify(invalid), input)).toThrow(
      '严重错误引用无法核验',
    );
  });
});
