import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectReading } from './helpers/manual-reading';
import { useReading } from '@/hooks/useReading';
import { streamInterpret } from '@/lib/api/stream-client';
import { getReadings } from '@/lib/readingStorage';
import { mockReadingApi } from './helpers/reading-api';

beforeEach(mockReadingApi);

vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));
const config = { endpoint: '', apiKey: '', model: '' };
const reply = (fullText: string) => ({
  fullText,
  truncated: false,
  usingFallback: false,
  receivedError: false,
});
const direct = reply('{"decision":"direct","drawCount":0,"reason":"原牌即可回答"}');
const draw = reply('{"decision":"draw","drawCount":2,"reason":"补充方向"}');

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function ready() {
  vi.mocked(streamInterpret).mockResolvedValueOnce(reply('原牌解读'));
  const hook = renderHook(() => useReading());
  selectReading(hook.result);
  await act(() => hook.result.current.startInterpretation(config));
  vi.mocked(streamInterpret).mockClear();
  return hook;
}

describe('手动占卜追问', () => {
  it('失败回合中的目标纠正进入后续决策和回答，重试时排除自身与未来补充', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret).mockResolvedValueOnce({
      ...reply('仍然建议你去复合'),
      truncated: true,
    });
    await act(() =>
      result.current.askFollowUp('我不想复合，只想取回物品', config, { direct: true }),
    );
    const correctionId = result.current.followUps[0].id;
    expect((await getReadings())[0].followUps?.[0]).toMatchObject({
      id: correctionId,
      question: '我不想复合，只想取回物品',
      status: 'error',
      generationStatus: 'truncated',
    });

    vi.mocked(streamInterpret)
      .mockClear()
      .mockResolvedValueOnce(direct)
      .mockResolvedValueOnce(reply('只讨论物品交接'));
    await act(() => result.current.askFollowUp('那该怎么发消息？', config));
    for (const [body] of vi.mocked(streamInterpret).mock.calls) {
      expect(body).toMatchObject({
        followUp: {
          history: [
            {
              question: '我不想复合，只想取回物品',
              interpretation: '',
              additionalCards: [],
            },
          ],
        },
      });
    }

    vi.mocked(streamInterpret).mockClear().mockResolvedValueOnce(reply('尊重你的目标'));
    await act(() => result.current.retryFollowUp(correctionId, config));
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
      followUp: { history: [], followUpQuestion: '我不想复合，只想取回物品' },
    });
    expect(result.current.followUps.map((followUp) => followUp.id)).toEqual([
      correctionId,
      expect.any(String),
    ]);
    expect(result.current.followUps[0].interpretation).toBe('尊重你的目标');
  });

  it('补牌决策被截断时即使 JSON 完整也不自动抽牌', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret).mockResolvedValueOnce({ ...draw, truncated: true });
    await act(() => result.current.askFollowUp('是否需要补充视角？', config));
    expect(result.current.followUps[0]).toMatchObject({ status: 'error', additionalCards: [] });
    expect(streamInterpret).toHaveBeenCalledTimes(1);
  });
  it('只有思考和截断回复都保留内容并标记未完成', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret).mockResolvedValueOnce(reply('<think>分析中</think>'));
    await act(() => result.current.askFollowUp('想更清楚一点', config, { direct: true }));
    expect(result.current.followUps[0]).toMatchObject({
      status: 'error',
      generationStatus: 'no-valid-answer',
    });
    vi.mocked(streamInterpret).mockResolvedValueOnce({ ...reply('部分建议'), truncated: true });
    await act(() => result.current.retryFollowUp(result.current.followUps[0].id, config));
    expect(result.current.followUps[0]).toMatchObject({
      status: 'error',
      generationStatus: 'truncated',
      interpretation: '部分建议',
    });
  });
  it('快捷追问在请求模型前保存用户修正，避免等待期间丢失', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret).mockImplementationOnce(async () => {
      expect((await getReadings())[0].followUps?.[0]).toMatchObject({
        question: '我其实很平静',
        decision: 'direct',
      });
      return reply('理解你的修正');
    });
    await act(() => result.current.askFollowUp('我其实很平静', config, { direct: true }));
    expect(result.current.followUps[0].status).toBe('done');
  });
  it('快捷纠偏直接回应，失败后重试也不进入补牌判断', async () => {
    const { result } = await ready();
    const originalCards = result.current.drawnCards;
    vi.mocked(streamInterpret).mockRejectedValueOnce(new Error('network'));
    await act(() => result.current.askFollowUp('纠正一下，我很平静', config, { direct: true }));
    expect(streamInterpret).toHaveBeenCalledTimes(1);
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
      followUp: { mode: 'direct' },
    });
    expect(result.current.followUps[0]).toMatchObject({
      decision: 'direct',
      status: 'error',
      additionalCards: [],
    });
    vi.mocked(streamInterpret).mockResolvedValueOnce(reply('回应更正'));
    await act(() => result.current.retryFollowUp(result.current.followUps[0].id, config));
    expect(result.current.drawnCards).toEqual(originalCards);
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
      followUp: { mode: 'direct' },
    });
  });
  it('旧追问保存收尾不能清除重置后新主解读的请求', async () => {
    const { result } = await ready();
    const readingFetch = globalThis.fetch;
    let releaseSave!: () => void;
    let held = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, options?: RequestInit) => {
        const data = options?.body ? JSON.parse(String(options.body)) : {};
        if (!held && options?.method === 'PATCH' && data.followUps?.[0]?.status === 'error') {
          held = true;
          return new Promise<Response>((resolve) => {
            releaseSave = () => {
              void readingFetch(input, options).then(resolve);
            };
          });
        }
        return readingFetch(input, options);
      }),
    );
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockRejectedValueOnce(new Error('network'));
    let old!: Promise<void>;
    await act(async () => {
      old = result.current.askFollowUp('下一步呢？', config);
    });
    await waitFor(() => expect(held).toBe(true));
    act(() => result.current.reset());
    selectReading(result);
    let finishNew!: (value: ReturnType<typeof reply>) => void;
    vi.mocked(streamInterpret).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNew = resolve;
        }),
    );
    let current!: Promise<void>;
    await act(async () => {
      current = result.current.startInterpretation(config);
    });
    await act(async () => {
      releaseSave();
      await old;
    });
    await act(async () => {
      finishNew(reply('新回合正文'));
      await current;
    });
    expect(result.current.interpretation).toBe('新回合正文');
    expect(result.current.isInterpreting).toBe(false);
  });

  it('连续追问的决策、回答和较早追问重试使用正确历史', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockResolvedValueOnce(reply('<think>内部推理</think>准备见面'));
    await act(() => result.current.askFollowUp('已约好周五见面', config));
    vi.mocked(streamInterpret)
      .mockClear()
      .mockResolvedValueOnce(direct)
      .mockRejectedValueOnce(new Error('network'));
    await act(() => result.current.askFollowUp('该怎么开口？', config));
    const history = [
      { question: '已约好周五见面', interpretation: '准备见面', additionalCards: [] },
    ];
    for (const [body] of vi.mocked(streamInterpret).mock.calls)
      expect(body).toMatchObject({ followUp: { history } });
    const secondId = result.current.followUps[1].id;
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockResolvedValueOnce(reply('后续回答'));
    await act(() => result.current.askFollowUp('这是之后的补充', config));
    vi.mocked(streamInterpret).mockClear().mockResolvedValueOnce(reply('重新说明'));
    await act(() => result.current.retryFollowUp(secondId, config));
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({ followUp: { history } });
  });

  it('直接回答决策后立即生成该新追问的正文', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockResolvedValueOnce(reply('具体行动'));
    await act(() => result.current.askFollowUp('我能做什么？', config));
    expect(streamInterpret).toHaveBeenCalledTimes(2);
    expect(result.current.followUps[0]).toMatchObject({
      status: 'done',
      interpretation: '具体行动',
      decision: 'direct',
    });
    expect((await getReadings())[0].followUps).toEqual(result.current.followUps);
  });

  it('补牌和补牌失败重试继续携带此前完成的追问', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockResolvedValueOnce(reply('准备见面'));
    await act(() => result.current.askFollowUp('已约好周五见面', config));
    const history = [
      { question: '已约好周五见面', interpretation: '准备见面', additionalCards: [] },
    ];
    vi.mocked(streamInterpret).mockClear().mockRejectedValueOnce(new Error('network'));
    await act(() => result.current.askFollowUp('还应留意什么？', config));
    const id = result.current.followUps[1].id;
    vi.mocked(streamInterpret).mockResolvedValueOnce(draw);
    await act(() => result.current.retryFollowUp(id, config));
    const additionalCards = result.current.followUps[1].additionalCards;
    vi.mocked(streamInterpret).mockRejectedValueOnce(new Error('network'));
    await act(async () => result.current.revealAllFollowUpCards(id, config));
    vi.mocked(streamInterpret).mockResolvedValueOnce(reply('补牌回应'));
    await act(() => result.current.retryFollowUp(id, config));
    expect(vi.mocked(streamInterpret).mock.calls).toHaveLength(4);
    for (const [body] of vi.mocked(streamInterpret).mock.calls)
      expect(body).toMatchObject({ followUp: { history } });
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
      followUp: { mode: 'with-extras', additionalCards },
    });
  });

  it('决策失败的重试保留追问ID，重新决策并继续生成回答', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret).mockRejectedValueOnce(new Error('network'));
    await act(() => result.current.askFollowUp('如何理解？', config));
    const id = result.current.followUps[0].id;
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockResolvedValueOnce(reply('新的说明'));
    await act(() => result.current.retryFollowUp(id, config));
    expect(result.current.followUps).toHaveLength(1);
    expect(result.current.followUps[0]).toMatchObject({
      id,
      status: 'done',
      interpretation: '新的说明',
    });
  });

  it('重复全部揭牌只生成一次回答，回答失败后重试使用相同补牌', async () => {
    const { result } = await ready();
    vi.mocked(streamInterpret).mockResolvedValueOnce(draw);
    await act(() => result.current.askFollowUp('下一步呢？', config));
    const { id, additionalCards } = result.current.followUps[0];
    expect((await getReadings())[0].followUps?.[0]).toMatchObject({
      status: 'awaiting-reveal',
      additionalCards,
    });
    vi.mocked(streamInterpret).mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      result.current.revealAllFollowUpCards(id, config);
      result.current.revealAllFollowUpCards(id, config);
    });
    expect(streamInterpret).toHaveBeenCalledTimes(2);
    expect(result.current.followUps[0]).toMatchObject({
      status: 'error',
      revealedCount: 2,
      additionalCards,
    });
    vi.mocked(streamInterpret).mockResolvedValueOnce(reply('补牌解读'));
    await act(() => result.current.retryFollowUp(id, config));
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
      followUp: { mode: 'with-extras', additionalCards },
    });
    expect(result.current.followUps[0].additionalCards).toEqual(additionalCards);
  });

  it('重置后忽略旧决策结果及其后续回答', async () => {
    const { result } = await ready();
    let finish!: (value: ReturnType<typeof reply>) => void;
    vi.mocked(streamInterpret).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.askFollowUp('我能做什么？', config);
    });
    act(() => result.current.reset());
    await act(async () => {
      finish(direct);
      await pending;
    });
    expect(result.current.followUps).toEqual([]);
    expect(streamInterpret).toHaveBeenCalledTimes(1);
  });

  it('取消后可重试，旧回答返回时不会覆盖新正文', async () => {
    const { result } = await ready();
    let finish!: (value: ReturnType<typeof reply>) => void;
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(direct)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.askFollowUp('我能做什么？', config);
    });
    const id = result.current.followUps[0].id;
    act(() => result.current.cancelRequest());
    expect(result.current.followUps[0].status).toBe('error');
    vi.mocked(streamInterpret).mockResolvedValueOnce(reply('重试后的回答'));
    await act(() => result.current.retryFollowUp(id, config));
    await act(async () => {
      finish(reply('旧回答'));
      await pending;
    });
    expect(result.current.followUps[0]).toMatchObject({
      id,
      status: 'done',
      interpretation: '重试后的回答',
    });
  });
});
