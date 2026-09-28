import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runFollowUpTurn, rerunFollowUpInterpretation } from '@/lib/agent/agentTurn';
import { streamInterpret } from '@/lib/api/stream-client';
import { drawCardsForSpread } from '@/lib/tarot/draw';
import { getSpreadById } from '@/lib/tarot/spreads';
import { buildFollowUpHistory } from '@/lib/followUpHistory';

vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));

const spread = getSpreadById('single')!;
const cards = drawCardsForSpread(spread);
const history = [
  {
    question: '已约好周五见面',
    interpretation: '<think>历史内部推理</think>准备见面',
    additionalCards: cards,
  },
];
const params = {
  originalQuestion: '如何了解这段关系',
  spread,
  drawnCards: cards,
  previousInterpretation: '<think>首轮内部推理</think>首轮解读',
  followUpQuestion: '该怎么开口？',
  history,
  apiConfig: { endpoint: '', apiKey: '', model: '' },
  signal: new AbortController().signal,
  callbacks: {},
};
const reply = (fullText: string) => ({
  fullText,
  truncated: false,
  receivedError: false,
  usingFallback: false,
});

beforeEach(() => vi.resetAllMocks());

describe('追问编排上下文', () => {
  it('Agent 决策、回答及重新生成保留失败回合的用户纠正与补牌，排除无效模型推断', async () => {
    const previousTurns = [
      {
        id: 'failed',
        question: '我已经沟通过了，仍然没有结果',
        status: 'error',
        generationStatus: 'interrupted' as const,
        interpretation: '<think>内部推理</think>你从来没有表达过需要',
        additionalCards: cards,
        error: '连接中断',
      },
    ];
    const retainedHistory = buildFollowUpHistory(previousTurns);
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(reply('{"decision":"direct","drawCount":0,"reason":"承接已有信息"}'))
      .mockResolvedValueOnce(reply('根据已尝试的结果调整'))
      .mockResolvedValueOnce(reply('重新回应当前困难'));
    await runFollowUpTurn({ ...params, history: retainedHistory });
    await rerunFollowUpInterpretation({
      ...params,
      history: retainedHistory,
      decision: 'direct',
      additionalCards: [],
      previousFollowUpInterpretation: '根据已尝试的结果调整',
    });
    expect(streamInterpret).toHaveBeenCalledTimes(3);
    const decisionBody = vi.mocked(streamInterpret).mock.calls[0][0] as {
      agent: { prompt: string };
    };
    const prompt = decisionBody.agent.prompt;
    expect(prompt).toContain(previousTurns[0].question);
    expect(prompt).toContain(cards[0].card.nameCn);
    expect(prompt).not.toContain('你从来没有表达过需要');
    expect(prompt).not.toContain('内部推理');
    for (const [body] of vi.mocked(streamInterpret).mock.calls.slice(1)) {
      expect(body).not.toHaveProperty('agent');
      expect(body).toMatchObject({
        question: params.originalQuestion,
        followUp: { history: retainedHistory },
      });
      expect(JSON.stringify(body)).not.toContain('你从来没有表达过需要');
    }
  });

  it('明确直接追问只请求回应，保留历史补牌且不运行补牌判断', async () => {
    vi.mocked(streamInterpret).mockResolvedValueOnce(reply('具体回应'));
    const onSupplementaryCards = vi.fn();
    const result = await runFollowUpTurn({
      ...params,
      direct: true,
      callbacks: { onSupplementaryCards },
    });
    expect(streamInterpret).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ decision: 'direct', drawCount: 0, additionalCards: [] });
    expect(onSupplementaryCards).not.toHaveBeenCalled();
    expect(vi.mocked(streamInterpret).mock.calls[0][0]).toMatchObject({
      followUp: { mode: 'direct', history },
    });
  });
  it.each(['direct', 'draw'])('%s 决策及解读携带同一历史和历史补牌', async (decision) => {
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(
        reply(
          JSON.stringify({ decision, drawCount: decision === 'draw' ? 1 : 0, reason: '测试决策' }),
        ),
      )
      .mockResolvedValueOnce(reply('回复'));
    await runFollowUpTurn(params);
    expect(streamInterpret).toHaveBeenCalledTimes(2);
    const decisionBody = vi.mocked(streamInterpret).mock.calls[0][0] as {
      agent: { prompt: string };
    };
    const prompt = decisionBody.agent.prompt;
    expect(prompt).toContain('已约好周五见面');
    expect(prompt).toContain('准备见面');
    expect(prompt).toContain(cards[0].card.nameCn);
    expect(prompt).not.toContain('历史内部推理');
    expect(prompt).not.toContain('首轮内部推理');
    expect(vi.mocked(streamInterpret).mock.calls[1][0]).toMatchObject({
      question: params.originalQuestion,
      drawnCards: cards,
      followUp: {
        history,
        previousInterpretation: params.previousInterpretation,
        followUpQuestion: params.followUpQuestion,
      },
    });
  });

  it.each(['direct', 'draw'] as const)(
    '重新生成 %s 保留原补牌、历史及正文，交由服务端处理上一版思考',
    async (decision) => {
      vi.mocked(streamInterpret).mockResolvedValueOnce(reply('新回复'));
      await rerunFollowUpInterpretation({
        ...params,
        decision,
        additionalCards: cards,
        previousFollowUpInterpretation: '<think>旧版内部推理</think>旧版正文',
      });
      expect(streamInterpret).toHaveBeenCalledTimes(1);
      expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
        question: params.originalQuestion,
        drawnCards: cards,
        followUp: { history, additionalCards: cards, decision },
        regeneration: { previousResponse: '<think>旧版内部推理</think>旧版正文' },
      });
    },
  );
});
