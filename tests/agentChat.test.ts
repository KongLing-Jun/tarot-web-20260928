import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentChat } from '@/hooks/useAgentChat';
import {
  runAgentTurn,
  rerunAgentInterpretation,
  runFollowUpTurn,
  rerunFollowUpInterpretation,
} from '@/lib/agent/agentTurn';
import { getSpreadById } from '@/lib/tarot/spreads';
import { drawCardsForSpread } from '@/lib/tarot/draw';
import type { ApiConfig } from '@/lib/tarot/types';
import {
  saveReading,
  updateReadingFollowUps,
  updateReadingInterpretation,
} from '@/lib/readingStorage';

vi.mock('@/lib/agent/agentTurn', () => ({
  runAgentTurn: vi.fn(),
  rerunAgentInterpretation: vi.fn(),
  runFollowUpTurn: vi.fn(),
  rerunFollowUpInterpretation: vi.fn(),
}));
vi.mock('@/lib/readingStorage', () => ({
  saveReading: vi.fn(),
  updateReadingFollowUps: vi.fn(),
  updateReadingInterpretation: vi.fn(),
}));

const spread = getSpreadById('single')!;
const cards = drawCardsForSpread(spread);
const config = {} as ApiConfig;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updateReadingFollowUps).mockResolvedValue(undefined);
  vi.mocked(runAgentTurn).mockImplementation(async ({ callbacks }) => {
    callbacks.onSpreadChosen?.({ spread, reason: '测试选阵' });
    await callbacks.onCardsDrawn?.({ drawnCards: cards });
    callbacks.onContent?.('原始解读');
    return {
      spread,
      reason: '',
      drawnCards: cards,
      interpretation: '原始解读',
      truncated: false,
      usingFallback: false,
    };
  });
});

describe('重新解读与重新抽牌', () => {
  it('恢复仍在生成的历史追问后，新的保存请求不回传服务端 running 状态', async () => {
    const { result } = renderHook(() => useAgentChat());
    act(() =>
      result.current.restoreReading({
        id: 'saved',
        question: '原问题',
        spread,
        drawnCards: cards,
        interpretation: '原解读',
        createdAt: new Date(),
        followUps: [
          {
            id: 'interrupted',
            question: '上次追问',
            status: 'interpreting',
            generationStatus: 'running',
            decision: 'direct',
            drawCount: 0,
            additionalCards: [],
            revealedCount: 0,
            interpretation: '已保存部分',
            error: null,
          },
        ],
      }),
    );
    vi.mocked(runFollowUpTurn).mockResolvedValueOnce({
      decision: 'direct',
      drawCount: 0,
      reason: '',
      additionalCards: [],
      interpretation: '新的回应',
      truncated: false,
    });
    await act(() => result.current.askFollowUp('新的进展', config, { direct: true }));
    expect(runFollowUpTurn).toHaveBeenCalledTimes(1);
    expect(updateReadingFollowUps).toHaveBeenCalled();
    for (const [, followUps] of vi.mocked(updateReadingFollowUps).mock.calls) {
      expect(followUps[0]).toMatchObject({
        id: 'interrupted',
        status: 'error',
        interpretation: '已保存部分',
      });
      expect(followUps.some((followUp) => followUp.generationStatus === 'running')).toBe(false);
    }
  });
  it('仅有思考不算成功，正文后出现错误也不被成功状态覆盖', async () => {
    vi.mocked(runAgentTurn).mockResolvedValueOnce({
      spread,
      reason: '',
      drawnCards: cards,
      interpretation: '<think>分析中</think>',
      truncated: false,
      usingFallback: false,
    });
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('问题', config));
    expect(result.current.messages[1]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('有效'),
    });
    vi.mocked(runAgentTurn).mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onContent?.('部分正文');
      callbacks.onStreamError?.('连接中断');
      return {
        spread,
        reason: '',
        drawnCards: cards,
        interpretation: '部分正文',
        truncated: false,
        usingFallback: false,
      };
    });
    await act(() => result.current.sendQuestion('另一问题', config));
    expect(result.current.messages[3]).toMatchObject({
      status: 'error',
      content: '部分正文',
      error: '连接中断',
    });
  });

  it('完整正文保存失败后重试只补存，不重新调用模型', async () => {
    vi.mocked(saveReading)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('数据库暂不可用'));
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('问题', config));
    expect(result.current.messages[1]).toMatchObject({
      content: '原始解读',
      status: 'done',
      persistenceStatus: 'failed',
    });
    await act(() => result.current.regenerateAgentMessage(result.current.messages[1].id, config));
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(rerunAgentInterpretation).not.toHaveBeenCalled();
    expect(updateReadingInterpretation).toHaveBeenCalledWith(
      expect.any(String),
      '原始解读',
      'completed',
    );
    expect(result.current.messages[1]).toMatchObject({ persistenceStatus: 'saved', notice: null });
  });
  it('抽牌记录保存失败后，重试先补存同一任务的原牌再解读', async () => {
    vi.mocked(saveReading).mockRejectedValueOnce(new Error('保存失败'));
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('原问题', config));
    const failed = result.current.messages[1];
    expect(failed).toMatchObject({ role: 'agent', status: 'error', drawnCards: cards });
    vi.mocked(rerunAgentInterpretation).mockResolvedValueOnce({
      interpretation: '重试完成',
      truncated: false,
    });
    await act(() => result.current.regenerateAgentMessage(failed.id, config));
    expect(saveReading).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveReading).mock.calls[1][0]).toMatchObject({
      id: vi.mocked(saveReading).mock.calls[0][0].id,
      drawnCards: cards,
    });
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(result.current.messages[1]).toMatchObject({ status: 'done', readingSaved: true });
  });

  it('截断追问保存未完成状态，刷新恢复后仅用户输入进入后续上下文', async () => {
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('原问题', config));
    vi.mocked(runFollowUpTurn).mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onContent?.('被截断的正文');
      return {
        decision: 'direct',
        drawCount: 0,
        reason: '',
        additionalCards: [],
        interpretation: '被截断的正文',
        truncated: true,
      };
    });
    await act(() => result.current.askFollowUp('第一次追问', config, { direct: true }));
    const saved = vi.mocked(updateReadingFollowUps).mock.lastCall!;
    expect(saved[1][0]).toMatchObject({
      status: 'error',
      interpretation: '被截断的正文',
      error: expect.stringContaining('截断'),
    });
    act(() =>
      result.current.restoreReading({
        id: saved[0],
        question: '原问题',
        spread,
        drawnCards: cards,
        interpretation: '原解读',
        createdAt: new Date(),
        followUps: saved[1],
      }),
    );
    vi.mocked(runFollowUpTurn).mockResolvedValueOnce({
      decision: 'direct',
      drawCount: 0,
      reason: '',
      additionalCards: [],
      interpretation: '后续回应',
      truncated: false,
    });
    await act(() => result.current.askFollowUp('第二次追问', config));
    expect(runFollowUpTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        history: [{ question: '第一次追问', interpretation: '', additionalCards: [] }],
      }),
    );
  });
  it('卸载保存已显示的追问片段，旧流结束不能覆盖离开时的快照', async () => {
    const { result, unmount } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('原问题', config));
    let reject!: (error: Error) => void;
    vi.mocked(runFollowUpTurn).mockImplementationOnce(
      ({ callbacks }) =>
        new Promise((_, fail) => {
          callbacks.onContent?.('已显示的部分');
          reject = fail;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.askFollowUp('追问', config, { direct: true });
    });
    unmount();
    expect(updateReadingFollowUps).toHaveBeenLastCalledWith(expect.any(String), [
      expect.objectContaining({
        interpretation: '已显示的部分',
        status: 'error',
        decision: 'direct',
      }),
    ]);
    const count = vi.mocked(updateReadingFollowUps).mock.calls.length;
    await act(async () => {
      reject(new Error('旧请求结束'));
      await pending;
    });
    expect(updateReadingFollowUps).toHaveBeenCalledTimes(count);
  });
  it('恢复原记录与追问不发起请求，进展继续写回原记录且保留中断回合的用户补充', async () => {
    const { result } = renderHook(() => useAgentChat());
    const done = {
      id: 'done',
      question: '我已尝试沟通',
      interpretation: '观察回应',
      additionalCards: cards,
      status: 'done' as const,
      error: null,
      drawCount: 1,
      revealedCount: 1,
      decision: 'draw' as const,
    };
    act(() =>
      result.current.restoreReading({
        id: 'saved',
        question: '原问题',
        spread,
        drawnCards: cards,
        interpretation: '原解读',
        createdAt: new Date(),
        followUps: [
          done,
          { ...done, id: 'partial', status: 'interpreting', interpretation: '未完成内容' },
        ],
      }),
    );
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(saveReading).not.toHaveBeenCalled();
    expect(updateReadingFollowUps).not.toHaveBeenCalled();
    expect(result.current.messages[1]).toMatchObject({
      readingId: 'saved',
      drawnCards: cards,
      followUps: [
        { id: 'done', status: 'done' },
        { id: 'partial', status: 'error', interpretation: '未完成内容' },
      ],
    });
    vi.mocked(runFollowUpTurn).mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onContent?.('根据现实结果继续');
      return {
        decision: 'direct',
        drawCount: 0,
        reason: '',
        additionalCards: [],
        interpretation: '根据现实结果继续',
        truncated: false,
      };
    });
    await act(() => result.current.askFollowUp('有新的进展', config, { direct: true }));
    expect(runFollowUpTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        originalQuestion: '原问题',
        direct: true,
        drawnCards: cards,
        history: [
          { question: done.question, interpretation: done.interpretation, additionalCards: cards },
          { question: done.question, interpretation: '', additionalCards: cards },
        ],
      }),
    );
    expect(updateReadingFollowUps).toHaveBeenLastCalledWith(
      'saved',
      expect.arrayContaining([expect.objectContaining({ question: '有新的进展' })]),
    );
    expect(saveReading).not.toHaveBeenCalled();
  });

  it('重新生成中间回合保留此前失败纠正与补牌，排除自身及未来回合且不重复新增', async () => {
    const { result } = renderHook(() => useAgentChat());
    const base = {
      status: 'done' as const,
      decision: 'draw' as const,
      drawCount: 1,
      additionalCards: cards,
      revealedCount: 1,
      interpretation: '旧回答',
      error: null,
    };
    act(() =>
      result.current.restoreReading({
        id: 'saved',
        question: '原问题',
        spread,
        drawnCards: cards,
        interpretation: '原解读',
        createdAt: new Date(),
        followUps: [
          {
            ...base,
            id: 'correction',
            question: '我不想复合',
            status: 'error',
            generationStatus: 'cancelled',
            interpretation: '未完成的推断',
          },
          { ...base, id: 'target', question: '只想取回物品' },
          { ...base, id: 'future', question: '后来的新进展' },
        ],
      }),
    );
    const agentId = result.current.messages[1].id;
    vi.mocked(rerunFollowUpInterpretation).mockResolvedValueOnce({
      interpretation: '物品交接建议',
      truncated: false,
    });
    await act(() => result.current.regenerateFollowUp(agentId, 'target', config));
    expect(rerunFollowUpInterpretation).toHaveBeenCalledWith(
      expect.objectContaining({
        followUpId: 'target',
        followUpQuestion: '只想取回物品',
        additionalCards: cards,
        history: [{ question: '我不想复合', interpretation: '', additionalCards: cards }],
      }),
    );
    expect(runFollowUpTurn).not.toHaveBeenCalled();
    const updated = result.current.messages[1];
    if (updated.role !== 'agent') throw new Error('未找到占卜');
    expect(updated.followUps.map((followUp) => followUp.id)).toEqual([
      'correction',
      'target',
      'future',
    ]);
  });

  it('空首轮恢复为未完成，主动重试沿用原牌和原 ID', async () => {
    const { result } = renderHook(() => useAgentChat());
    act(() =>
      result.current.restoreReading({
        id: 'saved',
        question: '原问题',
        spread,
        drawnCards: cards,
        interpretation: '',
        createdAt: new Date(),
      }),
    );
    expect(result.current.messages[1]).toMatchObject({ status: 'error', drawnCards: cards });
    vi.mocked(rerunAgentInterpretation).mockResolvedValueOnce({
      interpretation: '补全解读',
      truncated: false,
    });
    await act(() => result.current.regenerateAgentMessage(result.current.messages[1].id, config));
    expect(rerunAgentInterpretation).toHaveBeenCalledWith(
      expect.objectContaining({ readingId: 'saved', drawnCards: cards }),
    );
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(saveReading).not.toHaveBeenCalled();
  });

  it('恢复后旧首轮晚到不能写存储或解除新追问运行状态', async () => {
    let finishOld!: () => void;
    vi.mocked(runAgentTurn).mockImplementationOnce(
      ({ callbacks }) =>
        new Promise((resolve) => {
          finishOld = () => {
            callbacks.onContent?.('旧内容');
            resolve({
              spread,
              reason: '',
              drawnCards: cards,
              interpretation: '旧内容',
              truncated: false,
              usingFallback: false,
            });
          };
        }),
    );
    const { result } = renderHook(() => useAgentChat());
    let old!: Promise<void>;
    act(() => {
      old = result.current.sendQuestion('旧问题', config);
    });
    act(() =>
      result.current.restoreReading({
        id: 'restored',
        question: '已保存问题',
        spread,
        drawnCards: cards,
        interpretation: '已保存解读',
        createdAt: new Date(),
      }),
    );
    let finishNew!: () => void;
    vi.mocked(runFollowUpTurn).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = () =>
            resolve({
              decision: 'direct',
              drawCount: 0,
              reason: '',
              additionalCards: [],
              interpretation: '新回复',
              truncated: false,
            });
        }),
    );
    let current!: Promise<void>;
    await act(async () => {
      current = result.current.askFollowUp('新进展', config);
    });
    await act(async () => {
      finishOld();
      await old;
    });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.messages[1]).toMatchObject({
      content: '已保存解读',
      readingId: 'restored',
    });
    expect(saveReading).not.toHaveBeenCalled();
    await act(async () => {
      finishNew();
      await current;
    });
  });
  it('连续追问记住本次占卜事实，重生成只读取该轮之前的历史', async () => {
    const { result } = renderHook(() => useAgentChat());
    vi.mocked(runFollowUpTurn).mockImplementation(async ({ callbacks }) => {
      callbacks.onDecided?.('direct', 0, '原牌即可回答');
      callbacks.onContent?.('<think>内部推理</think>准备见面');
      return {
        decision: 'direct',
        drawCount: 0,
        reason: '',
        additionalCards: [],
        interpretation: '<think>内部推理</think>准备见面',
        truncated: false,
      };
    });
    await act(() => result.current.sendQuestion('如何行动', config));
    await act(() => result.current.askFollowUp('已约好周五见面', config));
    await act(() => result.current.askFollowUp('该怎么开口？', config));
    expect(vi.mocked(runFollowUpTurn).mock.lastCall?.[0].history).toEqual([
      { question: '已约好周五见面', interpretation: '准备见面', additionalCards: [] },
    ]);
    const agent = result.current.messages[1];
    if (agent.role !== 'agent') throw new Error('未找到占卜');
    vi.mocked(rerunFollowUpInterpretation).mockResolvedValue({
      interpretation: '新回答',
      truncated: false,
    });
    await act(() => result.current.regenerateFollowUp(agent.id, agent.followUps[0].id, config));
    expect(vi.mocked(rerunFollowUpInterpretation).mock.lastCall?.[0].history).toEqual([]);
    await act(() => result.current.sendQuestion('另一次占卜', config));
    await act(() => result.current.askFollowUp('接下来呢？', config));
    expect(vi.mocked(runFollowUpTurn).mock.lastCall?.[0].history).toEqual([]);
  });

  it('模型解读失败之前已保存问题和牌面，重试沿用同一条记录', async () => {
    vi.mocked(runAgentTurn).mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onSpreadChosen?.({ spread, reason: '测试' });
      await callbacks.onCardsDrawn?.({ drawnCards: cards });
      expect(saveReading).toHaveBeenCalledWith(
        expect.objectContaining({
          question: '失败也应保存',
          drawnCards: cards,
          interpretation: '',
        }),
      );
      throw new Error('模型连接中断');
    });
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('失败也应保存', config));
    const agent = result.current.messages[1];
    expect(agent).toMatchObject({
      status: 'error',
      readingId: expect.any(String),
      drawnCards: cards,
    });
    vi.mocked(rerunAgentInterpretation).mockImplementationOnce(async ({ callbacks }) => {
      callbacks.onContent?.('重试成功');
      return { interpretation: '重试成功', truncated: false };
    });
    await act(() => result.current.regenerateAgentMessage(agent.id, config));
    expect(saveReading).toHaveBeenCalledTimes(1);
    expect(result.current.messages[1]).toMatchObject({ content: '重试成功' });
  });
  it('重新解读传入原牌，不再次执行选阵抽牌；失败时原文仍在', async () => {
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('如何行动', config));
    const agent = result.current.messages[1];
    vi.mocked(rerunAgentInterpretation).mockRejectedValue(new Error('network error'));
    await act(() => result.current.regenerateAgentMessage(agent.id, config));
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(rerunAgentInterpretation).toHaveBeenCalledWith(
      expect.objectContaining({ drawnCards: cards, spread }),
    );
    expect(result.current.messages[1]).toMatchObject({
      content: '原始解读',
      drawnCards: cards,
      status: 'error',
    });
  });

  it('重新抽牌开启新回合，保留原来的消息', async () => {
    const { result } = renderHook(() => useAgentChat());
    await act(() => result.current.sendQuestion('如何行动', config));
    const original = result.current.messages[1];
    await act(() => result.current.redrawAgentMessage(original.id, config));
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(rerunAgentInterpretation).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages[1]).toEqual(original);
  });
});
