// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/config.mjs', () => ({
  readSettings: () => ({
    MODEL_BASE_URL: 'https://api.deepseek.com/v1',
    MODEL_API_KEY: 'fixture-secret',
  }),
}));
const input = {
  scenario: {
    question: '只想说说，不需要建议',
    knownFacts: [],
    goal: '倾诉',
    review: [],
    cards: [],
  },
  answerA: '我听到了你的失落。',
  answerB: '你现在不用急着振作。',
};
const dimensions = ['goalAlignment', 'executability', 'groundedConditions'];
function review() {
  const answer = (side: 'A' | 'B') => ({
    actionNeed: 'not-required',
    scores: { goalAlignment: 2, executability: null, groundedConditions: 2 },
    evidence: dimensions.map((dimension) => ({
      dimension,
      evidenceId: `${side}:1`,
      reason: '尊重倾诉，不强行布置动作',
    })),
    severeErrors: [],
  });
  return { answerA: answer('A'), answerB: answer('B'), winner: 'tie', winnerReason: '都承接倾诉' };
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('independent action review', () => {
  it('preserves not-applicable execution without awarding action points and resolves literal evidence', async () => {
    const { parseReadingActionReview } = await import('../scripts/reading-review-provider.mjs');
    const parsed = parseReadingActionReview(JSON.stringify(review()), input);
    expect(parsed.answerA.scores.executability).toBeNull();
    expect(parsed.answerA.evidence[0].quote).toBe(input.answerA);
  });

  it.each([
    'null-required',
    'numeric-not-required',
    'missing-dimension',
    'foreign-evidence',
    'unknown-need',
  ])('rejects malformed action score: %s', async (failure) => {
    const { parseReadingActionReview } = await import('../scripts/reading-review-provider.mjs');
    const result = review();
    if (failure === 'null-required') result.answerA.actionNeed = 'required';
    if (failure === 'numeric-not-required')
      Object.assign(result.answerA.scores, { executability: 2 });
    if (failure === 'missing-dimension')
      Reflect.deleteProperty(result.answerA.scores, 'groundedConditions');
    if (failure === 'foreign-evidence') result.answerA.evidence[0].evidenceId = 'B:1';
    if (failure === 'unknown-need') result.answerA.actionNeed = 'unknown';
    expect(() => parseReadingActionReview(JSON.stringify(result), input)).toThrow();
  });

  it('uses a separate rubric hash and does not silently accept unsupported profiles', async () => {
    const { default: Provider, READING_REVIEW_RUBRIC_HASH } =
      await import('../scripts/reading-review-provider.mjs');
    const config = {
      model: 'fixture-judge',
      timeoutMs: 1000,
      maxOutputTokens: 1000,
      maxRequests: 1,
      reviewProfile: 'action-v1',
    };
    expect(
      () => new Provider({ config: { ...config, rubricHash: READING_REVIEW_RUBRIC_HASH } }),
    ).toThrow('冻结');
    expect(() => new Provider({ config: { ...config, reviewProfile: 'typo' } })).toThrow();
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        model: 'fixture-judge',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(review()) } }],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await new Provider({ config }).callApi(JSON.stringify(input));
    expect(response.error).toBeUndefined();
    expect(JSON.parse(response.output!).answerA.scores.executability).toBeNull();
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('executability');
    expect(response.metadata?.rubricHash).not.toBe(READING_REVIEW_RUBRIC_HASH);
  });

  it('selects v2 explicitly and refuses a frozen v1 hash for v2', async () => {
    const { default: Provider } = await import('../scripts/reading-review-provider.mjs');
    const { ACTION_REVIEW_RUBRIC_HASH } = await import('../scripts/reading-action-rubric.mjs');
    const { ACTION_V2_REVIEW_RUBRIC_HASH } =
      await import('../scripts/reading-action-v2-rubric.mjs');
    const config = {
      model: 'fixture-judge',
      timeoutMs: 1000,
      maxOutputTokens: 1000,
      maxRequests: 1,
      reviewProfile: 'action-v2',
    };
    expect(
      () => new Provider({ config: { ...config, rubricHash: ACTION_REVIEW_RUBRIC_HASH } }),
    ).toThrow('冻结');
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(review()) } }],
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await new Provider({
      config: { ...config, rubricHash: ACTION_V2_REVIEW_RUBRIC_HASH },
    }).callApi(JSON.stringify(input));
    expect(response.metadata?.rubricHash).toBe(ACTION_V2_REVIEW_RUBRIC_HASH);
    expect(response.error).toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].content).toContain(
      '三维可同时扣分',
    );
  });
});
