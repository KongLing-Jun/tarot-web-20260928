import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPage from '@/app/agent/page';
import type { AgentMessage } from '@/hooks/useAgentChat';
import type { IntentSnapshot } from '@/lib/intent/types';
import { getSpreadById } from '@/lib/tarot/spreads';
import { drawCardsForSpread } from '@/lib/tarot/draw';

const { chatHook } = vi.hoisted(() => ({ chatHook: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/components/session/AgentChatSession', () => ({
  useAgentChatSession: function useSession() {
    const [draft, setDraft] = React.useState('');
    const [directDraft, setDirectDraft] = React.useState(false);
    return { ...chatHook(), draft, setDraft, directDraft, setDirectDraft };
  },
}));
vi.mock('@/hooks/useApiConfig', () => ({
  useApiConfig: () => ({ config: {}, isLoaded: true, canUseApi: true, intentEnabled: true }),
}));
vi.mock('@/components/cards/TarotCard', () => ({ TarotCardComponent: () => <span /> }));

const spread = getSpreadById('single')!;
const message: AgentMessage = {
  id: 'agent',
  role: 'agent',
  content: '正文',
  status: 'done',
  error: null,
  spread,
  spreadReason: '',
  drawnCards: drawCardsForSpread(spread),
  notice: null,
  readingId: 'reading-old',
  retry: null,
  followUps: [],
};
function chatState(messages: AgentMessage[] = []) {
  return {
    messages,
    isRunning: false,
    sendQuestion: vi.fn(),
    askFollowUp: vi.fn(),
    regenerateAgentMessage: vi.fn(),
    regenerateFollowUp: vi.fn(),
    redrawAgentMessage: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    restoreReading: vi.fn(),
    hasReading: vi.fn().mockReturnValue(false),
  };
}
function intent(
  question: string,
  action: IntentSnapshot['candidate']['turnAction'] = 'new',
): IntentSnapshot {
  return {
    id: 'intent-ready',
    version: 1,
    revision: 1,
    question,
    messages: [{ id: 'message-1', text: question }],
    candidate: {
      task: 'prepare',
      turnAction: action,
      subject: null,
      goal: null,
      facts: [],
      constraints: [],
      wantsAdvice: true,
      missingInformation: [],
    },
    plan: {
      mode: 'reading',
      includeAction: true,
      reuseExistingCards: action === 'correct',
      clarification: null,
    },
  };
}
const analyze = vi.fn();
beforeEach(() => {
  analyze.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, options?: RequestInit) => {
      if (input !== '/api/intent') throw new Error(`Unexpected request ${input}`);
      return analyze(JSON.parse(String(options?.body)));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function submit(text: string, existing = false) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: existing ? '发送' : '开始解读' }));
}

describe('Agent 意图识别与会话分流', () => {
  it('澄清阻止首次解读并保留用户草稿', async () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    const result = intent('怎么准备');
    result.plan = { ...result.plan, mode: 'clarify', clarification: '你想准备什么事情？' };
    analyze.mockResolvedValue(Response.json(result));
    render(<AgentPage />);
    submit('怎么准备');
    expect(await screen.findByText('你想准备什么事情？')).toBeInTheDocument();
    expect(state.sendQuestion).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('怎么准备');
  });

  it('识别失败保留草稿且不发送问题', async () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    analyze.mockResolvedValue(Response.json({ error: 'internal detail' }, { status: 503 }));
    render(<AgentPage />);
    submit('准备面试');
    expect(await screen.findByRole('alert')).toHaveTextContent('重试');
    expect(screen.getByRole('textbox')).toHaveValue('准备面试');
    expect(state.sendQuestion).not.toHaveBeenCalled();
  });

  it('识别就绪后将意图关联到首次提问', async () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    analyze.mockResolvedValue(Response.json(intent('准备面试')));
    render(<AgentPage />);
    submit('准备面试');
    await waitFor(() =>
      expect(state.sendQuestion).toHaveBeenCalledWith('准备面试', {}, { intentId: 'intent-ready' }),
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('纠正已有占卜时直接追问，避免因纠正而补牌', async () => {
    const state = chatState([message]);
    chatHook.mockReturnValue(state);
    analyze.mockResolvedValue(Response.json(intent('不是面试，是考试', 'correct')));
    render(<AgentPage />);
    submit('不是面试，是考试', true);
    await waitFor(() =>
      expect(state.askFollowUp).toHaveBeenCalledWith(
        '不是面试，是考试',
        {},
        {
          intentId: 'intent-ready',
          direct: true,
        },
      ),
    );
    expect(analyze).toHaveBeenCalledWith({
      question: '不是面试，是考试',
      readingId: 'reading-old',
    });
    expect(state.sendQuestion).not.toHaveBeenCalled();
  });

  it('切换主题时去掉旧占卜重新识别，用新意图启动问题', async () => {
    const state = chatState([message]);
    chatHook.mockReturnValue(state);
    analyze.mockResolvedValueOnce(Response.json(intent('换个话题，聊聊旅行', 'switch-topic')));
    analyze.mockResolvedValueOnce(
      Response.json({ ...intent('换个话题，聊聊旅行'), id: 'intent-new-topic' }),
    );
    render(<AgentPage />);
    submit('换个话题，聊聊旅行', true);
    await waitFor(() =>
      expect(state.sendQuestion).toHaveBeenCalledWith(
        '换个话题，聊聊旅行',
        {},
        {
          intentId: 'intent-new-topic',
        },
      ),
    );
    expect(analyze).toHaveBeenNthCalledWith(1, {
      question: '换个话题，聊聊旅行',
      readingId: 'reading-old',
    });
    expect(analyze).toHaveBeenNthCalledWith(2, { question: '换个话题，聊聊旅行' });
    expect(state.askFollowUp).not.toHaveBeenCalled();
  });
});
