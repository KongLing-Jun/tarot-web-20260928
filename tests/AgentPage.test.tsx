import React from 'react';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPage from '@/app/agent/page';
import type { AgentMessage, FollowUpMessage } from '@/hooks/useAgentChat';
import { getSpreadById } from '@/lib/tarot/spreads';
import { drawCardsForSpread } from '@/lib/tarot/draw';

const { chatHook, getResume, navigation } = vi.hoisted(() => ({
  chatHook: vi.fn(),
  getResume: vi.fn(),
  navigation: { query: '', replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.query),
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock('@/lib/readingResume', () => ({ getReadingForResume: getResume }));
vi.mock('@/components/session/AgentChatSession', () => ({
  useAgentChatSession: function useSession() {
    const [draft, setDraft] = React.useState('');
    const [directDraft, setDirectDraft] = React.useState(false);
    return { ...chatHook(), draft, setDraft, directDraft, setDirectDraft };
  },
}));
vi.mock('@/hooks/useApiConfig', () => ({
  useApiConfig: () => ({ config: {}, isLoaded: true, canUseApi: true }),
}));
vi.mock('@/components/cards/TarotCard', () => ({
  TarotCardComponent: ({ isRevealed }: { isRevealed: boolean }) => (
    <span data-testid="card" data-revealed={isRevealed} />
  ),
}));

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
  readingId: null,
  retry: null,
  followUps: [],
};

function chatState(messages = [message]) {
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

beforeEach(() => {
  navigation.query = '';
  getResume.mockReset();
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Agent 手机交互', () => {
  it('普通对话保留通用嵌入提示和三种开头', () => {
    chatHook.mockReturnValue(chatState([]));
    render(<AgentPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('时间或资源限制'));
    fireEvent.click(screen.getByRole('button', { name: '不知道怎么开头？' }));
    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(3);
    expect(screen.getByText('从一件事说起')).toBeInTheDocument();
    expect(screen.getByText('从一个选择说起')).toBeInTheDocument();
    expect(screen.getByText('从一段关系说起')).toBeInTheDocument();
    expect(screen.queryByText('准备一次重要表达')).not.toBeInTheDocument();
  });
  it('首轮字数提示覆盖边界，保留超限全文并在删减后恢复发送', () => {
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    const send = screen.getByRole('button', { name: '开始解读' });
    expect(screen.queryByText('0 / 500')).not.toBeInTheDocument();
    expect(send).toBeDisabled();
    expect(input).not.toHaveAttribute('maxlength');
    for (const length of [400, 401, 500, 501]) {
      const text = '问'.repeat(length);
      fireEvent.change(input, { target: { value: text } });
      expect(input).toHaveValue(text);
      expect(screen.getByText(`${length} / 500`)).toHaveAttribute(
        'data-warning',
        String(length > 400),
      );
      if (length > 500) expect(send).toBeDisabled();
      else expect(send).toBeEnabled();
    }
    const error = screen.getByText('请精简到 500 字以内');
    expect(error).toHaveAttribute('aria-live', 'polite');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'question-send-hint question-length-error');
    fireEvent.click(send);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.sendQuestion).not.toHaveBeenCalled();
    const recovered = '问'.repeat(499) + '👨‍👩‍👧‍👦';
    fireEvent.change(input, { target: { value: recovered } });
    expect(screen.getByText('500 / 500')).toBeInTheDocument();
    expect(error).toBeEmptyDOMElement();
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).toHaveAttribute('aria-describedby', 'question-send-hint');
    fireEvent.click(send);
    expect(state.sendQuestion).toHaveBeenCalledWith(recovered, {});
    fireEvent.change(input, { target: { value: ' \n ' } });
    expect(screen.getByText('3 / 500')).toBeInTheDocument();
    expect(send).toBeDisabled();
  });

  it('追加感受超过限制时保留完整草稿且禁止发送', () => {
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    const draft = '问'.repeat(500);
    fireEvent.change(input, { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: /添加此刻的感受/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: '平静' }));
    fireEvent.click(screen.getByRole('button', { name: '填入输入框' }));
    expect(input).toHaveValue(`${draft}\n我此刻的感受：平静。`);
    expect(input).toHaveFocus();
    expect(screen.getByText('请精简到 500 字以内')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始解读' })).toBeDisabled();
    expect(state.sendQuestion).not.toHaveBeenCalled();
  });

  const followUp: FollowUpMessage = {
    id: 'follow-up',
    question: '接下来可以怎么沟通？',
    status: 'done',
    decision: 'direct',
    drawCount: 0,
    reason: '',
    additionalCards: [],
    error: null,
    notice: null,
    retry: null,
    interpretation: `## 核心解读\n${'先梳理你在意的事情，再区分事实和猜测。'.repeat(8)}\n\n## 可采取的行动\n找一个安静的时间表达自己的感受。\n\n## 各牌说明\n结合原牌理解当前处境。`,
  };

  it('追问沿用双卡报告，可切换、展开及查看牌义，重试仍指向本轮', () => {
    const state = chatState([{ ...message, followUps: [followUp] }]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    const region = within(screen.getByRole('region', { name: '本次追问' }));
    expect(region.getByText(`继续聊 · ${followUp.question}`)).toBeInTheDocument();
    expect(region.getByRole('tabpanel')).toHaveTextContent('先梳理');
    expect(region.getByRole('button', { name: '收起本段 ⌃' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(region.getByRole('button', { name: '收起本段 ⌃' }));
    fireEvent.click(region.getByRole('button', { name: '展开本段 ⌄' }));
    fireEvent.click(region.getByRole('tab', { name: /02/ }));
    expect(region.getByRole('tabpanel')).toHaveTextContent('表达自己的感受');
    const evidence = region.getByText('牌义依据').closest('details')!;
    expect(evidence).not.toHaveAttribute('open');
    fireEvent.click(region.getByText('牌义依据'));
    expect(evidence).toHaveAttribute('open');
    fireEvent.click(region.getByRole('button', { name: '重新解读（保留原牌）' }));
    expect(state.regenerateFollowUp).toHaveBeenCalledWith('agent', 'follow-up', {});
  });

  it('追问从补牌判断到等待、流式正文和错误始终沿用新报告状态', () => {
    const update = (changes: Partial<FollowUpMessage>) =>
      chatHook.mockReturnValue({
        ...chatState([
          {
            ...message,
            followUps: [
              { ...followUp, status: 'running', interpretation: '', decision: null, ...changes },
            ],
          },
        ]),
        isRunning: changes.status !== 'error',
      });
    update({});
    const { rerender } = render(<AgentPage />);
    let region = within(screen.getByRole('region', { name: '本次追问' }));
    expect(region.getByRole('status')).toHaveTextContent('正在判断是否需要补牌');
    expect(region.queryByRole('region', { name: '解读生成状态' })).not.toBeInTheDocument();
    update({ decision: 'direct', retry: { attempt: 1, max: 3 } });
    rerender(<AgentPage />);
    region = within(screen.getByRole('region', { name: '本次追问' }));
    expect(region.getByRole('region', { name: '解读生成状态' })).toHaveTextContent('第 1 / 3 次');
    update({ decision: 'direct', interpretation: '## 核心解读\n先看清自己的感受。' });
    rerender(<AgentPage />);
    expect(region.getByRole('heading', { name: '事情怎么看' })).toBeInTheDocument();
    expect(region.queryByRole('region', { name: '解读生成状态' })).not.toBeInTheDocument();
    update({
      decision: 'direct',
      status: 'error',
      interpretation: '## 核心解读\n先看清自己的感受。',
      error: '连接中断',
    });
    rerender(<AgentPage />);
    expect(region.getByRole('alert')).toHaveTextContent('已保留生成的内容');
    expect(region.getByText('先看清自己的感受。')).toBeInTheDocument();
    expect(region.getByRole('button', { name: '重新解读（保留原牌）' })).toBeEnabled();
  });

  it('追问补牌仍显示原补牌和原因，普通文本也进入卡片容器', () => {
    chatHook.mockReturnValue(
      chatState([
        {
          ...message,
          followUps: [
            {
              ...followUp,
              decision: 'draw',
              additionalCards: message.drawnCards,
              reason: '补充沟通视角',
              interpretation: '没有章节标题的旧追问正文',
              restored: true,
            },
          ],
        },
      ]),
    );
    render(<AgentPage />);
    const region = within(screen.getByRole('region', { name: '本次追问' }));
    expect(region.getByText('本次追问需要 1 张补牌')).toBeInTheDocument();
    expect(region.getByText('补充沟通视角')).toBeInTheDocument();
    expect(region.getByTestId('card')).toHaveAttribute('data-revealed', 'true');
    expect(region.getByRole('heading', { name: '本次解读' })).toBeInTheDocument();
    expect(region.getByText('没有章节标题的旧追问正文')).toBeInTheDocument();
  });

  it('输入栏不再显示辅助入口，输入草稿不会自动发送', () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    expect(screen.queryByRole('button', { name: '✦ 辅助' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '原来的草稿' } });
    expect(screen.getByRole('textbox')).toHaveValue('原来的草稿');
    expect(state.askFollowUp).not.toHaveBeenCalled();
  });

  it('显眼的新对话入口保护草稿，取消不重置，确认才清空', () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '未发送的内容' } });
    fireEvent.click(screen.getByRole('button', { name: '＋新对话' }));
    expect(state.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(screen.getByRole('textbox')).toHaveValue('未发送的内容');
    fireEvent.click(screen.getByRole('button', { name: '＋新对话' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '开始新对话' }));
    expect(state.reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('首页新建意图开启新会话，底部对话入口保持原会话', () => {
    navigation.query = 'new=1';
    const state = chatState();
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    expect(state.reset).toHaveBeenCalledOnce();
    expect(navigation.replace).toHaveBeenCalledWith('/agent');
    expect(screen.getByRole('link', { name: '对话' })).toHaveAttribute('href', '/agent');
  });

  it('首页新建意图遇到生成中的会话先确认，取消不停止生成', () => {
    navigation.query = 'new=1';
    const state = { ...chatState([{ ...message, status: 'running' }]), isRunning: true };
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    expect(screen.getByRole('dialog')).toHaveTextContent('将停止生成');
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(state.reset).not.toHaveBeenCalled();
    expect(state.cancel).not.toHaveBeenCalled();
  });

  it('返回正在生成的历史对话时保留实时内容，不重新加载或重置', () => {
    navigation.query = 'readingId=saved';
    const state = {
      ...chatState([{ ...message, readingId: 'saved', status: 'running' }]),
      isRunning: true,
    };
    state.hasReading.mockReturnValue(true);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    expect(getResume).not.toHaveBeenCalled();
    expect(state.restoreReading).not.toHaveBeenCalled();
    expect(screen.getByText('正文')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停 止' })).toBeInTheDocument();
    expect(screen.getByTestId('card')).toHaveAttribute('data-revealed', 'true');
  });
  it('历史原牌和补牌首次渲染即已揭示，不重播揭牌进度', () => {
    chatHook.mockReturnValue(
      chatState([
        {
          ...message,
          restored: true,
          followUps: [
            {
              id: 'fu',
              question: '补充',
              status: 'done',
              decision: 'draw',
              drawCount: 1,
              reason: '',
              additionalCards: message.drawnCards,
              interpretation: '补牌说明',
              error: null,
              notice: null,
              retry: null,
              restored: true,
            },
          ],
        },
      ]),
    );
    render(<AgentPage />);
    expect(screen.getAllByTestId('card')).toHaveLength(2);
    for (const card of screen.getAllByTestId('card'))
      expect(card).toHaveAttribute('data-revealed', 'true');
  });
  it('恢复加载与错误时禁用发送，可重试且不会落入空白欢迎页', async () => {
    navigation.query = 'readingId=saved';
    getResume.mockRejectedValueOnce(new Error('无权访问'));
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('无权访问');
    expect(screen.queryByText('说说正在困扰你的事')).not.toBeInTheDocument();
    expect(state.sendQuestion).not.toHaveBeenCalled();
    getResume.mockResolvedValueOnce({ reading: { id: 'saved' }, completion: 'unknown' });
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await waitFor(() =>
      expect(state.restoreReading).toHaveBeenCalledWith({ id: 'saved' }, 'unknown'),
    );
  });

  it('切换记录后忽略旧读取结果', async () => {
    navigation.query = 'readingId=a';
    let finishA!: (value: unknown) => void;
    getResume.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishA = resolve;
        }),
    );
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    const { rerender } = render(<AgentPage />);
    navigation.query = 'readingId=b';
    getResume.mockResolvedValueOnce({ reading: { id: 'b' }, completion: 'complete' });
    rerender(<AgentPage />);
    await waitFor(() => expect(state.restoreReading).toHaveBeenCalledWith({ id: 'b' }, 'complete'));
    await act(async () => finishA({ reading: { id: 'a' }, completion: 'complete' }));
    expect(state.restoreReading).toHaveBeenCalledTimes(1);
  });

  it('输入追问需确认发送，发送后清空草稿', () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '我并不焦虑' } });
    expect(state.askFollowUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(state.askFollowUp).toHaveBeenLastCalledWith('我并不焦虑', {}, undefined);
    expect(input).toHaveValue('');
  });
  it('示例只追加草稿，修改后才发送，中文组合输入不会误发', () => {
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '我的情况' } });
    fireEvent.click(screen.getByRole('button', { name: '不知道怎么开头？' }));
    expect(screen.getByRole('button', { name: '填入输入框' })).toBeDisabled();
    const firstOpening = screen.getByRole('radio', { name: /从一件事说起/ });
    firstOpening.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭弹窗' })).toHaveFocus();
    fireEvent.click(screen.getByRole('radio', { name: /从一个选择说起/ }));
    fireEvent.click(screen.getByRole('button', { name: '填入输入框' }));
    expect(input).toHaveValue('我的情况\n我在……和……之间犹豫，最看重的是……，目前的限制是……');
    expect(input).toHaveFocus();
    expect(state.sendQuestion).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '我修改后的问题' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.sendQuestion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始解读' }));
    expect(state.sendQuestion).toHaveBeenCalledWith('我修改后的问题', {});
  });
  it('感受可多选和自己补充，取消不改草稿，确认只追加且重复填入去重', () => {
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    const trigger = screen.getByRole('button', { name: /添加此刻的感受/ });
    fireEvent.change(input, { target: { value: '我的情况' } });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: '填入输入框' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '焦虑' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(input).toHaveValue('我的情况');
    expect(trigger).toHaveFocus();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(trigger);
      expect(screen.getByRole('checkbox', { name: '焦虑' })).not.toBeChecked();
      fireEvent.click(screen.getByRole('checkbox', { name: '焦虑' }));
      fireEvent.click(screen.getByRole('checkbox', { name: '犹豫' }));
      fireEvent.click(screen.getByRole('button', { name: '其他感受' }));
      const other = screen.getByRole('textbox', { name: '用自己的话说说' });
      expect(other).toHaveFocus();
      fireEvent.change(other, { target: { value: '有点期待' } });
      fireEvent.click(screen.getByRole('button', { name: '填入输入框' }));
    }
    expect(input).toHaveValue('我的情况\n我此刻的感受：焦虑、犹豫、有点期待。');
    expect(input).toHaveFocus();
    expect(state.sendQuestion).not.toHaveBeenCalled();
    expect(state.askFollowUp).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('');
  });

  it('其他感受可单独填写，空白不能确认，弹窗焦点不会进入背后页面', () => {
    chatHook.mockReturnValue(chatState([]));
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('button', { name: /添加此刻的感受/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭弹窗' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '其他感受' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '其他感受' }));
    const other = screen.getByRole('textbox', { name: '用自己的话说说' });
    fireEvent.change(other, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '填入输入框' })).toBeDisabled();
    fireEvent.change(other, { target: { value: '期待' } });
    fireEvent.click(screen.getByRole('button', { name: '填入输入框' }));
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue(
      '我此刻的感受：期待。',
    );
  });

  it('空页面开始解读后切回对话输入区，结束后可继续追问', () => {
    const state = chatState([]);
    chatHook.mockReturnValue(state);
    const { rerender } = render(<AgentPage />);
    expect(screen.getByRole('button', { name: '开始解读' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '如何面对选择？' } });
    fireEvent.click(screen.getByRole('button', { name: '开始解读' }));
    expect(state.sendQuestion).toHaveBeenCalledOnce();
    chatHook.mockReturnValue({ ...state, messages: [message] });
    rerender(<AgentPage />);
    expect(screen.queryByRole('button', { name: '不知道怎么开头？' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '具体怎么做？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(state.askFollowUp).toHaveBeenCalledWith('具体怎么做？', {}, undefined);
  });
  it.each(['牌义依据', '查看生成信息'])('展开 %s 暂停跟随，关闭不自动恢复', (title) => {
    const content =
      '<think>思考说明</think>## 核心解读\n事情\n## 可采取的行动\n步骤\n## 各牌说明\n牌义';
    const state = chatState([{ ...message, content, status: 'running' }]);
    chatHook.mockReturnValue(state);
    const { rerender } = render(<AgentPage />);
    fireEvent.click(screen.getByText(title));
    vi.mocked(window.scrollTo).mockClear();
    // 浏览器布局变化可能触发一个仍处于底部的 scroll，不能重新打开跟随。
    fireEvent.scroll(window);
    chatHook.mockReturnValue({
      ...state,
      messages: [{ ...message, content: content + '更多', status: 'running' }],
    });
    rerender(<AgentPage />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(title));
    expect(window.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /回到最新/ }));
    expect(window.scrollTo).toHaveBeenCalledOnce();
  });

  it('输入区变高时保持最新回复可见，用户已上滑时不抢滚动', () => {
    let resize: ResizeObserverCallback = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    chatHook.mockReturnValue(chatState());
    const { container } = render(<AgentPage />);
    const composer = container.querySelector('[data-keyboard-open]')!;
    const bounds = vi.spyOn(composer, 'getBoundingClientRect');
    bounds.mockReturnValue({ height: 220 } as DOMRect);
    vi.mocked(window.scrollTo).mockClear();
    act(() => resize([], {} as ResizeObserver));
    expect(window.scrollTo).toHaveBeenCalledOnce();
    const scrollY = vi.spyOn(window, 'scrollY', 'get');
    scrollY.mockReturnValue(500);
    fireEvent.scroll(window);
    scrollY.mockReturnValue(200);
    fireEvent.scroll(window);
    bounds.mockReturnValue({ height: 280 } as DOMRect);
    vi.mocked(window.scrollTo).mockClear();
    act(() => resize([], {} as ResizeObserver));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('空会话显示对话导航，输入区适应可视区域变短', () => {
    const viewport = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    chatHook.mockReturnValue(chatState([]));
    const { container } = render(<AgentPage />);
    expect(screen.getByRole('link', { name: '对话' })).toHaveAttribute('aria-current', 'page');
    viewport.height = window.innerHeight - 300;
    act(() => viewport.dispatchEvent(new Event('resize')));
    const composer = container.querySelector('[data-keyboard-open]');
    expect(composer).toHaveAttribute('data-keyboard-open', 'true');
    expect(composer).toHaveStyle({ bottom: '300px' });
    viewport.height = window.innerHeight;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(composer).toHaveAttribute('data-keyboard-open', 'false');
  });

  it('空会话首屏不主动滚到底部，也不显示回到最新', () => {
    chatHook.mockReturnValue(chatState([]));
    render(<AgentPage />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    const scrollY = vi.spyOn(window, 'scrollY', 'get');
    scrollY.mockReturnValue(200);
    fireEvent.scroll(window);
    scrollY.mockReturnValue(100);
    fireEvent.scroll(window);
    expect(screen.queryByRole('button', { name: /回到最新/ })).not.toBeInTheDocument();
  });

  it('用户上滑后流式更新不抢滚动，点击回到最新恢复跟随', () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    const scrollY = vi.spyOn(window, 'scrollY', 'get');
    const { rerender } = render(<AgentPage />);
    scrollY.mockReturnValue(500);
    fireEvent.scroll(window);
    scrollY.mockReturnValue(200);
    fireEvent.scroll(window);
    fireEvent.scroll(window); // 同位置的布局 scroll 不能恢复跟随。
    vi.mocked(window.scrollTo).mockClear();
    chatHook.mockReturnValue({ ...state, messages: [{ ...message, content: '更新后的正文' }] });
    rerender(<AgentPage />);
    expect(window.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /回到最新/ }));
    expect(window.scrollTo).toHaveBeenCalledOnce();
  });

  it('手动回到底部隐藏回到最新，再次上滑显示', () => {
    chatHook.mockReturnValue(chatState());
    const scrollY = vi.spyOn(window, 'scrollY', 'get');
    const bottom = 2000 - window.innerHeight;
    scrollY.mockReturnValue(bottom);
    render(<AgentPage />);
    fireEvent.scroll(window);
    scrollY.mockReturnValue(bottom - 300);
    fireEvent.scroll(window);
    expect(screen.getByRole('button', { name: /回到最新/ })).toBeInTheDocument();
    scrollY.mockReturnValue(bottom - 1);
    fireEvent.scroll(window);
    expect(screen.queryByRole('button', { name: /回到最新/ })).not.toBeInTheDocument();
    scrollY.mockReturnValue(bottom - 300);
    fireEvent.scroll(window);
    expect(screen.getByRole('button', { name: /回到最新/ })).toBeInTheDocument();
  });

  it('内容已全部可见时展开详情不显示回到最新，内容增长后显示', () => {
    let resize: ResizeObserverCallback = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const height = vi
      .spyOn(document.documentElement, 'scrollHeight', 'get')
      .mockReturnValue(window.innerHeight);
    chatHook.mockReturnValue(
      chatState([{ ...message, content: '## 核心解读\n事情\n## 各牌说明\n牌义' }]),
    );
    render(<AgentPage />);
    fireEvent.click(screen.getByText('牌义依据'));
    expect(screen.queryByRole('button', { name: /回到最新/ })).not.toBeInTheDocument();
    vi.mocked(window.scrollTo).mockClear();
    height.mockReturnValue(2000);
    act(() => resize([], {} as ResizeObserver));
    expect(screen.getByRole('button', { name: /回到最新/ })).toBeInTheDocument();
    height.mockReturnValue(window.innerHeight);
    act(() => resize([], {} as ResizeObserver));
    expect(screen.queryByRole('button', { name: /回到最新/ })).not.toBeInTheDocument();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('明确区分保留原牌解读与确认后重新抽牌', () => {
    const state = chatState();
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('button', { name: '重新解读（保留原牌）' }));
    expect(state.regenerateAgentMessage).toHaveBeenCalledWith('agent', {});
    fireEvent.click(screen.getByRole('button', { name: '重新抽牌' }));
    expect(state.redrawAgentMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认重新抽牌' }));
    expect(state.redrawAgentMessage).toHaveBeenCalledWith('agent', {});
  });

  it('缺牌失败时提示重试选阵，不声称保留原牌', () => {
    chatHook.mockReturnValue(
      chatState([{ ...message, spread: null, drawnCards: [], status: 'error', error: '连接失败' }]),
    );
    render(<AgentPage />);
    expect(screen.getByRole('button', { name: '重试选阵与抽牌' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '重新解读（保留原牌）' })).not.toBeInTheDocument();
  });

  it('自动推荐凯尔特十字可切换位置并查看原牌详情，不重新抽牌', () => {
    const celtic = getSpreadById('celtic-cross')!;
    const drawnCards = drawCardsForSpread(celtic);
    const snapshot = structuredClone(drawnCards);
    const state = chatState([{ ...message, spread: celtic, drawnCards }]);
    chatHook.mockReturnValue(state);
    render(<AgentPage />);
    expect(screen.getByRole('button', { name: '牌阵图' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '按位置查看' }));
    const positions = within(screen.getByRole('list')).getAllByRole('button');
    expect(positions).toHaveLength(celtic.positions.length);
    positions.forEach((button, index) => {
      expect(button).toBeEnabled();
      expect(button).toHaveTextContent(drawnCards[index].card.nameCn);
    });
    fireEvent.click(positions[1]);
    const detail = screen.getByRole('region', { name: '位置详情' });
    expect(detail).toHaveTextContent(drawnCards[1].card.nameCn);
    expect(detail).toHaveTextContent(drawnCards[1].isReversed ? '逆位' : '正位');
    expect(detail).toHaveTextContent(drawnCards[1].position.description);
    fireEvent.click(screen.getByRole('button', { name: '牌阵图' }));
    expect(drawnCards).toEqual(snapshot);
    expect(state.redrawAgentMessage).not.toHaveBeenCalled();
    expect(state.sendQuestion).not.toHaveBeenCalled();
  });
});
