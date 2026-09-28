import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectReading } from './helpers/manual-reading';
import { getSpreadById, getDefaultSpread } from '@/lib/tarot/spreads';
import { readingScenes } from '@/lib/readingEntry';
import { useReading } from '@/hooks/useReading';
import { streamInterpret, type StreamCallbacks, type StreamResult } from '@/lib/api/stream-client';
import { getReadings } from '@/lib/readingStorage';
import { mockReadingApi } from './helpers/reading-api';

beforeEach(mockReadingApi);

vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('手动占卜的操作语义', () => {
  it('自动重试清除上次思考缓冲，仅有思考不能算完成解读', async () => {
    vi.mocked(streamInterpret).mockImplementationOnce(async (_body, callbacks) => {
      callbacks.onThinking?.('<think>第一次思考</think>');
      callbacks.onRetry?.(1, 2);
      callbacks.onContent?.('本次正文');
      throw new Error('network');
    });
    const { result } = renderHook(() => useReading());
    selectReading(result);
    const config = { endpoint: '', apiKey: '', model: '' };
    await act(() => result.current.startInterpretation(config));
    expect(result.current.interpretation).toBe('本次正文');
    vi.mocked(streamInterpret).mockResolvedValueOnce({
      fullText: '<think>只有思考</think>',
      truncated: false,
      usingFallback: false,
      receivedError: false,
    });
    await act(() => result.current.startInterpretation(config));
    expect(result.current.error).toContain('有效解读');
  });
  it('重置后旧草稿保存失败不重试，也不覆盖新回合的保存引用', async () => {
    const readingFetch = globalThis.fetch;
    let rejectOld!: (reason: Error) => void;
    let creates = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, options?: RequestInit) => {
        if (input === '/api/readings' && options?.method === 'POST' && ++creates === 1) {
          return new Promise<Response>((_resolve, reject) => {
            rejectOld = reject;
          });
        }
        return readingFetch(input, options);
      }),
    );
    const { result } = renderHook(() => useReading());
    selectReading(result);
    const config = { endpoint: '', apiKey: '', model: '' };
    let old!: Promise<void>;
    await act(async () => {
      old = result.current.startInterpretation(config);
    });
    act(() => result.current.reset());
    selectReading(result);
    let finishNew!: (value: StreamResult) => void;
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
      rejectOld(new Error('old save failed'));
      await old;
    });
    expect(creates).toBe(2);
    expect(result.current.isInterpreting).toBe(true);
    await act(async () => {
      finishNew({
        fullText: '新回合',
        truncated: false,
        usingFallback: false,
        receivedError: false,
      });
      await current;
    });
    expect(result.current.interpretation).toBe('新回合');
  });

  it('首次揭牌即保存最终选择，模型失败和重试沿用同一条记录', async () => {
    const { result } = renderHook(() => useReading());
    act(() => result.current.setQuestion('如何继续推进？'));
    selectReading(result);
    let saved!: Awaited<ReturnType<typeof getReadings>>;
    await act(async () => {
      saved = await getReadings();
    });
    expect(saved).toEqual([
      expect.objectContaining({
        question: '如何继续推进？',
        drawnCards: result.current.drawnCards,
        interpretation: '',
      }),
    ]);
    const id = saved[0].id;
    vi.mocked(streamInterpret).mockRejectedValueOnce(new Error('network'));
    const config = { endpoint: '', apiKey: '', model: '' };
    await act(() => result.current.startInterpretation(config));
    expect(vi.mocked(streamInterpret).mock.lastCall?.[0]).toMatchObject({
      readingId: id,
      drawnCards: saved[0].drawnCards,
    });
    expect(await getReadings()).toEqual([expect.objectContaining({ id, interpretation: '' })]);
    vi.mocked(streamInterpret).mockResolvedValueOnce({
      fullText: '重试成功',
      truncated: false,
      usingFallback: false,
      receivedError: false,
    });
    await act(() => result.current.startInterpretation(config));
    expect(await getReadings()).toEqual([
      expect.objectContaining({ id, interpretation: '重试成功' }),
    ]);
  });

  it('抽牌后加速、全揭和重新解读保留牌面，更新同一条历史；返回保留问题', async () => {
    vi.mocked(streamInterpret).mockResolvedValue({
      fullText: '解读正文',
      truncated: false,
      usingFallback: false,
      receivedError: false,
    });
    const { result } = renderHook(() => useReading());
    act(() => result.current.setQuestion('我可以如何行动？'));
    selectReading(result);
    const cards = result.current.drawnCards;
    const random = vi.spyOn(Math, 'random');
    act(() => result.current.revealAllCards());
    expect(result.current.drawnCards).toEqual(cards);
    expect(random).not.toHaveBeenCalled();
    const config = { endpoint: '', apiKey: '', model: '' };
    await act(() => result.current.startInterpretation(config));
    const id = (await getReadings())[0].id;
    await act(() => result.current.startInterpretation(config));
    expect(result.current.drawnCards).toEqual(cards);
    expect(await getReadings()).toHaveLength(1);
    expect((await getReadings())[0].id).toBe(id);
    act(() => result.current.editReading('question'));
    expect(result.current.question).toBe('我可以如何行动？');
    act(() => result.current.redraw());
    expect(result.current.drawnCards).toEqual([]);
    expect(result.current.question).toBe('我可以如何行动？');
    expect(result.current.phase).toBe('shuffle');
  });

  it('重新解读在没有新内容时失败保留上次正文', async () => {
    const config = { endpoint: '', apiKey: '', model: '' };
    vi.mocked(streamInterpret).mockResolvedValueOnce({
      fullText: '已有正文',
      truncated: false,
      usingFallback: false,
      receivedError: false,
    });
    const { result } = renderHook(() => useReading());
    selectReading(result);
    await act(() => result.current.startInterpretation(config));
    vi.mocked(streamInterpret).mockRejectedValueOnce(new Error('network'));
    await act(() => result.current.startInterpretation(config));
    expect(result.current.interpretation).toBe('已有正文');
    expect(result.current.error).toBeTruthy();
    expect(result.current.isInterpreting).toBe(false);
  });

  it('取消立即保留尚未刷新的正文，旧请求不能结束或覆盖新请求', async () => {
    const config = { endpoint: '', apiKey: '', model: '' };
    let firstCallbacks!: StreamCallbacks;
    let finishFirst!: (value: StreamResult) => void;
    let finishSecond!: (value: StreamResult) => void;
    vi.mocked(streamInterpret)
      .mockImplementationOnce((_body, callbacks) => {
        firstCallbacks = callbacks;
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve;
          }),
      );
    const { result } = renderHook(() => useReading());
    selectReading(result);
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.startInterpretation(config);
    });
    act(() => {
      firstCallbacks.onContent?.('已收到的部分');
      result.current.cancelRequest();
    });
    expect(result.current.interpretation).toBe('已收到的部分');
    expect(result.current.isInterpreting).toBe(false);
    expect(result.current.notice).toBe('已停止生成，已保留当前内容，可保留原牌重试。');
    let second!: Promise<void>;
    await act(async () => {
      second = result.current.startInterpretation(config);
    });
    await act(async () => {
      firstCallbacks.onContent?.('过期片段');
      firstCallbacks.onStreamError?.('过期报错');
      firstCallbacks.onRetry?.(1, 2);
      finishFirst({
        fullText: '过期正文',
        truncated: false,
        usingFallback: false,
        receivedError: false,
      });
      await first;
    });
    expect(result.current.isInterpreting).toBe(true);
    expect(result.current.interpretation).toBe('已收到的部分');
    expect(result.current.error).toBeNull();
    expect(result.current.retryInfo).toBeNull();
    expect(await getReadings()).toEqual([expect.objectContaining({ interpretation: '' })]);
    await act(async () => {
      finishSecond({
        fullText: '本次正文',
        truncated: false,
        usingFallback: false,
        receivedError: false,
      });
      await second;
    });
    expect(result.current.interpretation).toBe('本次正文');
    expect(result.current.isInterpreting).toBe(false);
  });

  it('重置后旧主解读不得覆盖已经保存的牌面记录', async () => {
    const config = { endpoint: '', apiKey: '', model: '' };
    let finish!: (value: StreamResult) => void;
    vi.mocked(streamInterpret).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useReading());
    selectReading(result);
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.startInterpretation(config);
    });
    act(() => result.current.reset());
    await act(async () => {
      finish({
        fullText: '旧牌解读',
        truncated: false,
        usingFallback: false,
        receivedError: false,
      });
      await pending;
    });
    expect(result.current.interpretation).toBe('');
    expect(result.current.phase).toBe('question');
    expect(await getReadings()).toEqual([expect.objectContaining({ interpretation: '' })]);
  });

  it('追问重试在首字前失败也保留上次已生成的部分', async () => {
    const config = { endpoint: '', apiKey: '', model: '' };
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce({
        fullText: '原牌正文',
        truncated: false,
        usingFallback: false,
        receivedError: false,
      })
      .mockResolvedValueOnce({
        fullText: '{"decision":"direct","drawCount":0,"reason":"原牌即可回答"}',
        truncated: false,
        usingFallback: false,
        receivedError: false,
      })
      .mockImplementationOnce(async (_body, callbacks) => {
        callbacks.onContent?.('追问已有的部分');
        throw new Error('network');
      })
      .mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useReading());
    selectReading(result);
    await act(() => result.current.startInterpretation(config));
    await act(() => result.current.askFollowUp('我能如何行动？', config));
    const id = result.current.followUps[0].id;
    expect(result.current.followUps[0].interpretation).toBe('追问已有的部分');
    await act(() => result.current.retryFollowUp(id, config));
    expect(result.current.followUps[0]).toMatchObject({
      status: 'error',
      interpretation: '追问已有的部分',
    });
  });
});

it('场景新问题从解读阶段重置，清空草稿、旧牌与报告并保留牌阵；普通重置恢复默认牌阵', async () => {
  const scene = readingScenes[0];
  const spread = getSpreadById(scene.spreadId)!;
  const { result, rerender } = renderHook(({ question }) => useReading(spread, question), {
    initialProps: { question: '' },
  });
  act(() => result.current.setQuestion('用户编辑的问题'));
  rerender({ question: '新的外部默认值' });
  expect(result.current.question).toBe('用户编辑的问题');
  selectReading(result);
  vi.mocked(streamInterpret).mockResolvedValueOnce({
    fullText: '已完成的解读',
    truncated: false,
    usingFallback: false,
    receivedError: false,
  });
  await act(() => result.current.startInterpretation({ endpoint: '', apiKey: '', model: '' }));
  expect(result.current.phase).toBe('interpret');
  act(() => result.current.reset({ question: '', spread }));
  expect(result.current.question).toBe('');
  expect(result.current.spread).toBe(spread);
  expect(result.current.phase).toBe('question');
  expect(result.current.interpretation).toBe('');
  expect(result.current.drawnCards).toHaveLength(0);
  expect(result.current.followUps).toHaveLength(0);
  act(() => result.current.reset());
  expect(result.current.question).toBe('');
  expect(result.current.spread).toBe(getDefaultSpread());
});
