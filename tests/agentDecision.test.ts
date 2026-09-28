import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractSpreadChoiceJson } from '@/lib/agent/spreadChoice';
import {
  runAgentTurn,
  rerunAgentInterpretation,
  runFollowUpTurn,
  rerunFollowUpInterpretation,
} from '@/lib/agent/agentTurn';
import { streamInterpret } from '@/lib/api/stream-client';
import { LLMError } from '@/lib/api/errors';
import { getSpreadById } from '@/lib/tarot/spreads';
import { allCards } from '@/lib/tarot/cards';
import type { ApiConfig } from '@/lib/tarot/types';

vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));
const params = () => ({
  question: '今天可以做什么',
  apiConfig: {} as ApiConfig,
  signal: new AbortController().signal,
  callbacks: {},
});
beforeEach(() => vi.resetAllMocks());

describe('严格牌阵决策', () => {
  const complete = {
    fullText: '正文',
    receivedError: false,
    truncated: false,
    usingFallback: false,
  };
  it('只有内部选阵透传prompt，Agent正文交由服务端构建', async () => {
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce({ ...complete, fullText: '{"spreadId":"single","reason":"原因"}' })
      .mockResolvedValueOnce(complete);
    const result = await runAgentTurn({ ...params(), readingId: 'reading' });
    expect(vi.mocked(streamInterpret).mock.calls[0][0]).toMatchObject({
      agent: { internal: true },
    });
    expect(vi.mocked(streamInterpret).mock.calls[1][0]).toMatchObject({
      question: params().question,
      spread: result.spread,
      drawnCards: result.drawnCards,
      readingId: 'reading',
    });
    expect(vi.mocked(streamInterpret).mock.calls[1][0]).not.toHaveProperty('agent');
  });
  it.each(['direct', 'draw'] as const)(
    '追问%s及其重试发送原问题、历史和结构化牌面',
    async (decision) => {
      const spread = getSpreadById('single')!;
      const history = [{ question: '用户背景', interpretation: '旧回答', additionalCards: [] }];
      const input = {
        ...params(),
        readingId: 'reading',
        followUpId: 'followup',
        originalQuestion: '原问题',
        followUpQuestion: '追问',
        previousInterpretation: '首轮回答',
        spread,
        drawnCards: [],
        history,
      };
      vi.mocked(streamInterpret)
        .mockResolvedValueOnce({
          ...complete,
          fullText: JSON.stringify({
            decision,
            drawCount: decision === 'draw' ? 1 : 0,
            reason: '原因',
          }),
        })
        .mockResolvedValue(complete);
      const result = await runFollowUpTurn(input);
      const body = vi.mocked(streamInterpret).mock.calls[1][0];
      expect(body).not.toHaveProperty('agent');
      expect(body).toMatchObject({
        question: '原问题',
        readingId: 'reading',
        followUp: {
          id: 'followup',
          mode: decision === 'draw' ? 'with-extras' : 'direct',
          decision,
          previousInterpretation: '首轮回答',
          followUpQuestion: '追问',
          history,
          additionalCards: result.additionalCards,
        },
      });
      await rerunFollowUpInterpretation({
        ...input,
        decision,
        additionalCards: result.additionalCards,
        previousFollowUpInterpretation: '上版追问',
      });
      expect(vi.mocked(streamInterpret).mock.lastCall![0]).toMatchObject({
        ...(body as object),
        regeneration: { previousResponse: '上版追问' },
      });
    },
  );
  it('首轮重试保持原牌并将上一版交由服务端处理', async () => {
    vi.mocked(streamInterpret).mockResolvedValue(complete);
    const spread = getSpreadById('single')!;
    const drawnCards = [{ card: allCards[0], isReversed: false, position: spread.positions[0] }];
    await rerunAgentInterpretation({
      ...params(),
      spread,
      drawnCards,
      previousInterpretation: '上一版',
    });
    expect(vi.mocked(streamInterpret).mock.lastCall![0]).toMatchObject({
      spread,
      drawnCards,
      regeneration: { previousResponse: '上一版' },
    });
    expect(vi.mocked(streamInterpret).mock.lastCall![0]).not.toHaveProperty('agent');
  });
  it('容许完整 JSON 代码块，与补牌决策协议一致', () => {
    expect(extractSpreadChoiceJson('```json\n{"spreadId":"single","reason":"原因"}\n```')).toEqual({
      spreadId: 'single',
      reason: '原因',
    });
  });
  it('只读取正式正文，忽略思考中的候选 JSON', () => {
    expect(
      extractSpreadChoiceJson(
        '<think>{"spreadId":"single","reason":"候选"}</think>{"spreadId":"timeline","reason":"原因"}',
      ),
    ).toEqual({ spreadId: 'timeline', reason: '原因' });
  });
  it.each([
    '{"spreadId":"invented","reason":"原因"}',
    '{"spreadId":"single","reason":2}',
    '解释：{"spreadId":"single","reason":"原因"}',
    '{"spreadId":"single","reason":"原因"}{"spreadId":"timeline","reason":"原因"}',
    '<think>{"spreadId":"single","reason":"候选"}</think>',
  ])('拒绝不符合完整对象协议的输出 %s', (text) => expect(extractSpreadChoiceJson(text)).toBeNull());
  it.each(['AUTH_FAILED', 'BAD_REQUEST', 'ABORTED'] as const)(
    '不吞掉 %s 后继续付费解读',
    async (code) => {
      const error = new LLMError({ code, message: '请求失败', retryable: false });
      vi.mocked(streamInterpret).mockRejectedValueOnce(error);
      await expect(runAgentTurn(params())).rejects.toBe(error);
      expect(streamInterpret).toHaveBeenCalledTimes(1);
    },
  );
  it('非法决策显式返回 fallback 原因', async () => {
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce({
        fullText: '{"spreadId":"unknown","reason":"错误"}',
        receivedError: false,
        truncated: false,
        usingFallback: false,
      })
      .mockResolvedValueOnce({
        fullText: '正文',
        receivedError: false,
        truncated: false,
        usingFallback: false,
      });
    expect(await runAgentTurn(params())).toMatchObject({
      decisionFallbackReason: 'invalid-output',
      spread: { id: 'single' },
    });
  });
  it('网络故障的兜底原因可区分于非法 JSON', async () => {
    vi.mocked(streamInterpret)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        fullText: '正文',
        receivedError: false,
        truncated: false,
        usingFallback: false,
      });
    expect(await runAgentTurn(params())).toMatchObject({
      decisionFallbackReason: 'transient-error',
      spread: { id: 'single' },
    });
  });
  it('完整 JSON 后发生流中断也不能采用候选决策', async () => {
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce({
        fullText: '{"spreadId":"single","reason":"候选"}',
        receivedError: true,
        truncated: false,
        usingFallback: false,
      })
      .mockResolvedValueOnce({
        fullText: '正文',
        receivedError: false,
        truncated: false,
        usingFallback: false,
      });
    expect(await runAgentTurn(params())).toMatchObject({
      decisionFallbackReason: 'incomplete-output',
      spread: { id: 'single' },
    });
  });
  it('追问决策仅使用正文，结果透传生成和保存状态', async () => {
    const spread = getSpreadById('single')!;
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce({
        fullText:
          '<think>{"decision":"draw","drawCount":3,"reason":"候选"}</think>{"decision":"direct","drawCount":0,"reason":"已有背景"}',
        receivedError: false,
        truncated: false,
        usingFallback: false,
      })
      .mockResolvedValueOnce({
        fullText: '已有正文',
        answer: '已有正文',
        receivedError: false,
        truncated: false,
        usingFallback: false,
        generationStatus: 'completed',
        persistenceStatus: 'failed',
        finishReason: 'stop',
      });
    const result = await runFollowUpTurn({
      ...params(),
      originalQuestion: '原问题',
      followUpQuestion: '接下来呢',
      previousInterpretation: '原回答',
      spread,
      drawnCards: [],
    });
    expect(result).toMatchObject({
      decision: 'direct',
      additionalCards: [],
      answer: '已有正文',
      receivedError: false,
      generationStatus: 'completed',
      persistenceStatus: 'failed',
      finishReason: 'stop',
    });
  });
  it('解读回合保留流错误并执行牌面一致性检查', async () => {
    const spread = getSpreadById('single')!;
    vi.mocked(streamInterpret).mockResolvedValueOnce({
      fullText:
        '## 核心解读\n内容\n## 可采取的行动\n行动\n## 各牌说明\n### 指引 愚者（逆位）\n说明',
      receivedError: true,
      truncated: false,
      usingFallback: false,
    });
    const result = await rerunAgentInterpretation({
      ...params(),
      spread,
      drawnCards: [{ card: allCards[0], isReversed: false, position: spread.positions[0] }],
    });
    expect(result).toMatchObject({ receivedError: true, quality: { needsRetry: true } });
  });
});
