import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatHistoryPage from '@/app/history/messages/page';
import { apiFetch } from '@/lib/api/client';
import {
  groupChatExchanges,
  messagePreview,
  messageStatus,
  type ChatHistoryMessage,
} from '@/lib/chatHistory';
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const message = (
  id: string,
  exchangeId: string | undefined,
  role: 'user' | 'assistant',
  content: string,
  createdAt = '2026-09-15T19:45:00+08:00',
): ChatHistoryMessage => ({ id, exchangeId, role, content, createdAt, status: 'done' });
const question = message('u1', 'x1', 'user', '我想聊聊一段让我困惑的关系');
const answer = message(
  'a1',
  'x1',
  'assistant',
  '<think>内部分析</think>这是已经保存的完整回复。'.repeat(20),
);
const second = [
  message('u2', 'x2', 'user', '最近发生了一件让我在意的事', '2026-09-14T17:00:00+08:00'),
  {
    ...message('a2', 'x2', 'assistant', '已保存的部分回复', '2026-09-14T17:00:00+08:00'),
    status: 'cancelled' as const,
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(apiFetch).mockResolvedValue({
    messages: [answer, question, ...second],
    hasMore: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('聊天记录分组与原文展示', () => {
  it('只按 exchangeId 配对，跨页合并、去重，缺失关联不能猜测', () => {
    expect(groupChatExchanges([answer, question, answer])[0].messages.map((m) => m.id)).toEqual([
      'u1',
      'a1',
    ]);
    expect(
      groupChatExchanges([
        message('unknown-1', undefined, 'assistant', 'a'),
        message('unknown-2', undefined, 'user', 'q'),
      ]),
    ).toHaveLength(2);
    expect(messagePreview(answer.content)).not.toContain('内部分析');
    expect(messageStatus({ ...answer, generationStatus: 'truncated' })).toBe('回复被截断');
  });
  it('最新问答默认展开，其他问答可展开，长回复展开后保留原文和状态', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(180);
    render(<ChatHistoryPage />);
    expect(await screen.findByRole('button', { name: /收起对话：我想聊聊/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.queryByText('内部分析')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开完整回复' }));
    expect(screen.getByRole('button', { name: '收起回复' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const toggle = screen.getByRole('button', { name: /展开对话：最近发生/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('已保存的部分回复')).toBeVisible();
    expect(screen.getByText('已停止 · 内容已保存')).toBeVisible();
    expect(screen.getByRole('link', { name: '＋ 新聊天' })).toHaveAttribute('href', '/agent?new=1');
  });
  it('分页按消息条数取偏移，跨页的提问补入同一问答', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ messages: [answer], hasMore: true })
      .mockResolvedValueOnce({ messages: [question], hasMore: false });
    const { container } = render(<ChatHistoryPage />);
    await screen.findByRole('button', { name: /收起对话：回复记录/ });
    fireEvent.click(screen.getByRole('button', { name: '加载更早记录' }));
    await screen.findByRole('button', { name: /收起对话：我想聊聊/ });
    expect(apiFetch).toHaveBeenLastCalledWith('/api/messages?offset=1');
    expect(container.querySelectorAll('article')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '加载更早记录' })).not.toBeInTheDocument();
  });
  it('管理菜单保留清空确认，取消不删除，确认后显示空态', async () => {
    render(<ChatHistoryPage />);
    await screen.findByRole('button', { name: /收起对话：我想聊聊/ });
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '清空聊天记录' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('解读记录仍可单独查看');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '清空聊天记录' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清空' }));
    expect(await screen.findByText('还没有聊天记录')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenLastCalledWith('/api/messages', {
      method: 'DELETE',
      body: JSON.stringify({ all: true }),
    });
  });
  it('加载失败显示错误和重试，不误显示空态', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('连接失败'));
    render(<ChatHistoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('连接失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.queryByText('还没有聊天记录')).not.toBeInTheDocument();
  });
});
