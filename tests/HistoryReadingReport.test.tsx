import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingDetailPage from '@/app/history/[id]/page';
import { getReadingById, deleteReadings } from '@/lib/readingStorage';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';
import type { Reading } from '@/lib/tarot/types';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/readingStorage', () => ({ getReadingById: vi.fn(), deleteReadings: vi.fn() }));
const saved: Reading = {
  id: 'saved-1',
  question: '我想聊聊一段让我困惑的关系',
  createdAt: new Date('2026-09-15T19:45:00'),
  spread: spreads[1],
  drawnCards: spreads[1].positions.map((position, i) => ({
    position,
    card: allCards[i],
    isReversed: i === 1,
  })),
  interpretation:
    '## 核心解读\n先看清关系中的感受。\n## 可采取的行动\n表达自己的需要。\n## 各牌说明\n牌义依据保留。',
  followUps: [
    {
      id: 'fu-1',
      question: '怎么表达自己的需要？',
      status: 'done',
      drawCount: 1,
      revealedCount: 1,
      error: null,
      additionalCards: [
        { position: spreads[0].positions[0], card: allCards[3], isReversed: false },
      ],
      interpretation: '先用一件具体的小事开始沟通。',
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(getReadingById).mockResolvedValue(saved);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = () => render(<ReadingDetailPage params={Promise.resolve({ id: saved.id })} />);

describe('历史记录使用新版解读报告', () => {
  it('读取同一记录、切换双卡，保留折叠牌阵、追问和继续聊入口', async () => {
    const { container } = mount();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '正在载入解读详情');
    await screen.findByRole('tablist');
    expect(getReadingById).toHaveBeenCalledWith(saved.id);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('先看清关系中的感受');
    fireEvent.click(screen.getByRole('tab', { name: /02/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('表达自己的需要');
    const spread = container.querySelector('details')!;
    expect(spread).not.toHaveAttribute('open');
    fireEvent.click(spread.querySelector('summary')!);
    expect(spread).toHaveAttribute('open');
    const followUp = screen.getByText('怎么表达自己的需要？').closest('details')!;
    expect(followUp).not.toHaveAttribute('open');
    fireEvent.click(followUp.querySelector('summary')!);
    expect(within(followUp).getByText('先用一件具体的小事开始沟通。')).toBeVisible();
    expect(within(followUp).getByText('补充牌 · 1 张')).toBeVisible();
    expect(screen.getByRole('link', { name: '继续聊这件事' })).toHaveAttribute(
      'href',
      '/agent?readingId=saved-1',
    );
    expect(screen.getByRole('link', { name: '返回轨迹' })).toHaveAttribute('href', '/history');
  });
  it('删除取消不调用接口，失败保留记录，成功才返回轨迹', async () => {
    mount();
    await screen.findByRole('tablist');
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保 留' }));
    expect(deleteReadings).not.toHaveBeenCalled();
    vi.mocked(deleteReadings).mockRejectedValueOnce(new Error('删除失败'));
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删 除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除失败');
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除记录' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删 除' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/history'));
    expect(deleteReadings).toHaveBeenCalledWith([saved.id]);
  });
  it('兼容旧格式正文及未生成记录，不虚构双卡内容', async () => {
    vi.mocked(getReadingById).mockResolvedValueOnce({
      ...saved,
      interpretation: '旧记录原始正文',
      followUps: [],
    });
    const view = mount();
    expect(await screen.findByText('旧记录原始正文')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(getReadingById).mockResolvedValueOnce({ ...saved, interpretation: undefined });
    mount();
    expect(await screen.findByText('尚未保存解读')).toBeVisible();
    expect(screen.queryByText('正在生成解读')).not.toBeInTheDocument();
  });
  it('读取失败可重试，缺失记录有返回轨迹入口', async () => {
    vi.mocked(getReadingById)
      .mockRejectedValueOnce(new Error('网络错误'))
      .mockResolvedValueOnce(undefined);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('网络错误');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('记录不存在')).toBeVisible();
    expect(screen.getByRole('link', { name: /返回轨迹/ })).toHaveAttribute('href', '/history');
  });
});
