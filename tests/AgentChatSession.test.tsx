import { StrictMode, useLayoutEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserSession } from '@/components/session/UserSession';
import { useAgentChatSession } from '@/components/session/AgentChatSession';
import {
  runAgentTurn,
  runFollowUpTurn,
  rerunAgentInterpretation,
  rerunFollowUpInterpretation,
} from '@/lib/agent/agentTurn';
import {
  saveReading,
  updateReadingFollowUps,
  updateReadingInterpretation,
} from '@/lib/readingStorage';
import { getSpreadById } from '@/lib/tarot/spreads';
import { drawCardsForSpread } from '@/lib/tarot/draw';
import { LLMError } from '@/lib/api/errors';
import type { ApiConfig } from '@/lib/tarot/types';
import { loadAgentSession, saveAgentSession } from '@/lib/agentSessionStorage';

vi.mock('@/lib/agentSessionStorage', () => ({
  loadAgentSession: vi.fn(),
  saveAgentSession: vi.fn(),
}));
vi.mock('@/lib/auth/environment', () => ({ isWechatMiniProgram: async () => true }));

const navigation = vi.hoisted(() => ({ pathname: '/agent' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('@/lib/agent/agentTurn', () => ({
  runAgentTurn: vi.fn(),
  runFollowUpTurn: vi.fn(),
  rerunAgentInterpretation: vi.fn(),
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
const turnResult = {
  spread,
  drawnCards: cards,
  reason: '',
  interpretation: '完整解读',
  truncated: false,
  usingFallback: false,
};
let session: ReturnType<typeof useAgentChatSession>;

function Conversation() {
  const current = useAgentChatSession();
  useLayoutEffect(() => {
    session = current;
  }, [current]);
  return <div data-testid="conversation">{JSON.stringify(current.messages)}</div>;
}

function App({ visible = true }: { visible?: boolean }) {
  return (
    <StrictMode>
      <UserSession>{visible ? <Conversation /> : <p>其他页面</p>}</UserSession>
    </StrictMode>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadAgentSession).mockResolvedValue({ tasks: [], revision: 0 });
  vi.mocked(saveAgentSession).mockImplementation(async (_tasks, revision) => ({
    revision: revision + 1,
  }));
  navigation.pathname = '/agent';
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () =>
      Response.json({
        user: {
          nickname: '测试用户',
          createdAt: '2026-09-01',
          favoriteCardIds: [],
        },
      }),
    ),
  );
  vi.mocked(runAgentTurn).mockImplementation(async ({ callbacks }) => {
    callbacks.onSpreadChosen?.({ spread, reason: '' });
    await callbacks.onCardsDrawn?.({ drawnCards: cards });
    callbacks.onContent?.('完整解读');
    return turnResult;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('跨页面对话会话', () => {
  it.each([true, false])('重新解读及重新抽牌保留意图关联，兼容旧记录：%s', async (linked) => {
    const reference = linked ? { intentId: 'intent-original', sceneId: 'preparation' } : {};
    render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.sendQuestion('原问题', config, reference));
    const agentId = session.messages[1].id;
    vi.mocked(rerunAgentInterpretation).mockResolvedValue({
      interpretation: '新的解读',
      truncated: false,
    });
    await act(() => session.regenerateAgentMessage(agentId, config));
    expect(rerunAgentInterpretation).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: linked ? 'intent-original' : undefined,
        sceneId: linked ? 'preparation' : undefined,
      }),
    );
    await act(() => session.redrawAgentMessage(agentId, config));
    expect(runAgentTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        intentId: linked ? 'intent-original' : undefined,
        sceneId: linked ? 'preparation' : undefined,
      }),
    );
    expect(saveReading).toHaveBeenLastCalledWith(
      expect.objectContaining({
        intentId: linked ? 'intent-original' : undefined,
        sceneId: linked ? 'preparation' : undefined,
      }),
    );
  });

  it.each([true, false])('选阵前失败后重试保留意图及持久化关联：%s', async (linked) => {
    const reference = linked ? { intentId: 'intent-retry', sceneId: 'preparation' } : {};
    vi.mocked(runAgentTurn).mockRejectedValueOnce(new Error('测试网络中断'));
    render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.sendQuestion('原问题', config, reference));
    const agentId = session.messages[1].id;
    await act(() => session.regenerateAgentMessage(agentId, config));
    expect(runAgentTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        intentId: linked ? 'intent-retry' : undefined,
        sceneId: linked ? 'preparation' : undefined,
      }),
    );
    expect(saveReading).toHaveBeenLastCalledWith(
      expect.objectContaining({
        intentId: linked ? 'intent-retry' : undefined,
        sceneId: linked ? 'preparation' : undefined,
      }),
    );
  });

  it.each([true, false])('重新生成追问使用该轮意图及原场景：%s', async (linked) => {
    render(<App />);
    await screen.findByTestId('conversation');
    await act(() =>
      session.sendQuestion(
        '原问题',
        config,
        linked ? { intentId: 'intent-original', sceneId: 'preparation' } : {},
      ),
    );
    vi.mocked(runFollowUpTurn).mockImplementation(async ({ callbacks }) => {
      callbacks.onDecided?.('direct', 0, '');
      return {
        decision: 'direct',
        drawCount: 0,
        reason: '',
        additionalCards: [],
        interpretation: '追问正文',
        truncated: false,
      };
    });
    await act(() =>
      session.askFollowUp('继续讨论', config, linked ? { intentId: 'intent-followup' } : undefined),
    );
    const agent = session.messages.find((item) => item.role === 'agent');
    if (!agent || agent.role !== 'agent') throw new Error('缺少测试解读');
    vi.mocked(rerunFollowUpInterpretation).mockResolvedValue({
      interpretation: '新的追问正文',
      truncated: false,
    });
    await act(() => session.regenerateFollowUp(agent.id, agent.followUps[0].id, config));
    expect(rerunFollowUpInterpretation).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: linked ? 'intent-followup' : undefined,
        sceneId: linked ? 'preparation' : undefined,
      }),
    );
  });

  it('选阵时离开，后台继续抽牌和接收内容；返回接回同一请求并保存结果', async () => {
    let params!: Parameters<typeof runAgentTurn>[0];
    let finish!: (result: typeof turnResult) => void;
    vi.mocked(runAgentTurn).mockImplementationOnce((args) => {
      params = args;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const view = render(<App />);
    await screen.findByTestId('conversation');
    let pending!: Promise<void>;
    await act(async () => {
      pending = session.sendQuestion('原问题', config);
    });
    const originalIds = session.messages.map((message) => message.id);
    navigation.pathname = '/library';
    view.rerender(<App visible={false} />);
    expect(params.signal.aborted).toBe(false);
    await act(async () => {
      params.callbacks.onSpreadChosen?.({ spread, reason: '选择单牌' });
      await params.callbacks.onCardsDrawn?.({ drawnCards: cards });
      params.callbacks.onContent?.('后台内容');
    });
    navigation.pathname = '/agent';
    view.rerender(<App />);
    await screen.findByTestId('conversation');
    expect(session.isRunning).toBe(true);
    expect(session.messages.map((message) => message.id)).toEqual(originalIds);
    expect(session.messages[1]).toMatchObject({
      content: '后台内容',
      drawnCards: cards,
      status: 'running',
    });
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    await act(async () => {
      params.callbacks.onContent?.('，完整解读');
      finish({ ...turnResult, interpretation: '后台内容，完整解读' });
      await pending;
    });
    expect(session.isRunning).toBe(false);
    expect(session.messages[1]).toMatchObject({ content: '后台内容，完整解读', status: 'done' });
    expect(saveReading).toHaveBeenLastCalledWith(
      expect.objectContaining({ interpretation: '后台内容，完整解读', drawnCards: cards }),
    );
  });

  it('追问在其他页面完成，返回恢复补牌和最终状态，能继续追问', async () => {
    const view = render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.sendQuestion('原问题', config));
    let params!: Parameters<typeof runFollowUpTurn>[0];
    let finish!: (result: Awaited<ReturnType<typeof runFollowUpTurn>>) => void;
    vi.mocked(runFollowUpTurn).mockImplementationOnce((args) => {
      params = args;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = session.askFollowUp('接下来呢', config);
    });
    navigation.pathname = '/history';
    view.rerender(<App visible={false} />);
    expect(params.signal.aborted).toBe(false);
    await act(async () => {
      params.callbacks.onDecided?.('draw', 1, '补充建议');
      await params.callbacks.onSupplementaryCards?.(cards);
      params.callbacks.onContent?.('追问完成');
      finish({
        decision: 'draw',
        drawCount: 1,
        reason: '补充建议',
        additionalCards: cards,
        interpretation: '追问完成',
        truncated: false,
      });
      await pending;
    });
    expect(updateReadingFollowUps).toHaveBeenLastCalledWith(expect.any(String), [
      expect.objectContaining({
        status: 'done',
        interpretation: '追问完成',
        additionalCards: cards,
      }),
    ]);
    navigation.pathname = '/agent';
    view.rerender(<App />);
    await screen.findByTestId('conversation');
    expect(session.isRunning).toBe(false);
    expect(session.messages[1]).toMatchObject({
      followUps: [{ status: 'done', interpretation: '追问完成', additionalCards: cards }],
    });
    vi.mocked(runFollowUpTurn).mockResolvedValueOnce({
      decision: 'direct',
      drawCount: 0,
      reason: '',
      additionalCards: [],
      interpretation: '继续',
      truncated: false,
    });
    await act(() => session.askFollowUp('再问一次', config));
    expect(runFollowUpTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        history: [{ question: '接下来呢', interpretation: '追问完成', additionalCards: cards }],
      }),
    );
  });

  it('重新解读在后台完成，草稿和直接回应选项跨页面保留，新对话清空', async () => {
    const view = render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.sendQuestion('原问题', config));
    let params!: Parameters<typeof rerunAgentInterpretation>[0];
    let finish!: (result: { interpretation: string; truncated: boolean }) => void;
    vi.mocked(rerunAgentInterpretation).mockImplementationOnce((args) => {
      params = args;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    let pending!: Promise<void>;
    act(() => {
      session.setDraft('未发送的追问');
      session.setDirectDraft(true);
      pending = session.regenerateAgentMessage(session.messages[1].id, config);
    });
    navigation.pathname = '/';
    view.rerender(<App visible={false} />);
    expect(params.signal.aborted).toBe(false);
    await act(async () => {
      params.callbacks.onContent?.('新的解读');
      finish({ interpretation: '新的解读', truncated: false });
      await pending;
    });
    navigation.pathname = '/agent';
    view.rerender(<App />);
    await screen.findByTestId('conversation');
    expect(session.messages[1]).toMatchObject({
      content: '新的解读',
      status: 'done',
      drawnCards: cards,
    });
    expect(updateReadingInterpretation).toHaveBeenCalledWith(
      expect.any(String),
      '新的解读',
      'completed',
    );
    expect(session.draft).toBe('未发送的追问');
    expect(session.directDraft).toBe(true);
    act(() => session.reset());
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe('');
    expect(session.directDraft).toBe(false);
  });

  it('返回后主动停止仍能终止原请求，显示停止状态', async () => {
    let signal!: AbortSignal;
    vi.mocked(runAgentTurn).mockImplementationOnce((args) => {
      signal = args.signal;
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () =>
          reject(new LLMError({ code: 'ABORTED', message: '停止', retryable: false })),
        ),
      );
    });
    const view = render(<App />);
    await screen.findByTestId('conversation');
    let pending!: Promise<void>;
    await act(async () => {
      pending = session.sendQuestion('原问题', config);
    });
    navigation.pathname = '/profile';
    view.rerender(<App visible={false} />);
    expect(signal.aborted).toBe(false);
    navigation.pathname = '/agent';
    view.rerender(<App />);
    await screen.findByTestId('conversation');
    await act(async () => {
      session.cancel();
      await pending;
    });
    expect(signal.aborted).toBe(true);
    expect(session.isRunning).toBe(false);
    expect(session.messages[1]).toMatchObject({ status: 'error', error: '已停止生成' });
  });

  it('登录失效时终止后台请求，重新登录后不带回旧会话', async () => {
    let signal!: AbortSignal;
    vi.mocked(runAgentTurn).mockImplementationOnce((args) => {
      signal = args.signal;
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () =>
          reject(new LLMError({ code: 'ABORTED', message: '停止', retryable: false })),
        ),
      );
    });
    const view = render(<App />);
    await screen.findByTestId('conversation');
    let pending!: Promise<void>;
    await act(async () => {
      pending = session.sendQuestion('私人问题', config);
    });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: '登录过期' }, { status: 401 }));
    navigation.pathname = '/profile';
    view.rerender(<App visible={false} />);
    await waitFor(() => expect(signal.aborted).toBe(true));
    await act(async () => {
      await pending;
    });
    navigation.pathname = '/agent';
    view.rerender(<App />);
    await screen.findByTestId('conversation');
    expect(session.messages).toEqual([]);
    expect(session.isRunning).toBe(false);
  });
});

describe('数据库对话任务', () => {
  it('选阵前先保存问题和任务引用，数据库失败时不调用模型', async () => {
    vi.mocked(saveAgentSession).mockRejectedValueOnce(new Error('数据库暂不可用'));
    render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.sendQuestion('还没抽牌的问题', config));
    expect(saveAgentSession).toHaveBeenCalledWith(
      [{ id: expect.any(String), readingId: expect.any(String), question: '还没抽牌的问题' }],
      0,
      expect.any(AbortSignal),
    );
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('数据库暂不可用');
    expect(localStorage.length).toBe(0);
  });

  it('重新挂载从数据库恢复多回合、牌面和追问，重试沿用尚未抽牌的任务 ID', async () => {
    const saved = {
      id: 'reading-one',
      question: '原问题',
      spread,
      drawnCards: cards,
      interpretation: '已保存解读',
      createdAt: new Date(),
      followUps: [
        {
          id: 'fu',
          question: '追问',
          status: 'done' as const,
          decision: 'direct' as const,
          drawCount: 0,
          additionalCards: [],
          revealedCount: 0,
          interpretation: '追问回答',
          error: null,
        },
      ],
    };
    vi.mocked(loadAgentSession).mockResolvedValue({
      revision: 7,
      tasks: [
        {
          id: 'first',
          question: '原问题',
          readingId: saved.id,
          reading: saved,
          completion: 'complete',
        },
        {
          id: 'pending',
          question: '尚未选阵的问题',
          readingId: 'pending-reading',
          reading: null,
          completion: 'unknown',
        },
      ],
    });
    const view = render(<App />);
    await screen.findByTestId('conversation');
    expect(session.messages).toHaveLength(4);
    expect(session.messages[1]).toMatchObject({
      id: 'first',
      status: 'done',
      drawnCards: cards,
      followUps: [{ interpretation: '追问回答' }],
    });
    expect(session.messages[3]).toMatchObject({
      id: 'pending',
      status: 'error',
      readingId: 'pending-reading',
    });
    expect(saveAgentSession).not.toHaveBeenCalled();
    view.unmount();
    render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.regenerateAgentMessage('pending', config));
    expect(runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ readingId: 'pending-reading', question: '尚未选阵的问题' }),
    );
    expect(saveAgentSession).toHaveBeenCalledWith(expect.any(Array), 7, expect.any(AbortSignal));
  });

  it('开始新对话保存空任务列表，退出登录只清理内存', async () => {
    const view = render(<App />);
    await screen.findByTestId('conversation');
    await act(() => session.sendQuestion('原问题', config));
    await act(async () => {
      session.reset();
    });
    expect(saveAgentSession).toHaveBeenLastCalledWith([], 1, expect.any(AbortSignal));
    const calls = vi.mocked(saveAgentSession).mock.calls.length;
    view.unmount();
    expect(saveAgentSession).toHaveBeenCalledTimes(calls);
  });

  it('读取数据库失败时阻止新对话覆盖已有任务', async () => {
    vi.mocked(loadAgentSession).mockRejectedValue(new Error('读取失败'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
    expect(screen.queryByTestId('conversation')).not.toBeInTheDocument();
    expect(saveAgentSession).not.toHaveBeenCalled();
  });
});
