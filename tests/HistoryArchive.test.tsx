import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryPage from '@/app/history/page';
import { HistoryArchive } from '@/components/history/HistoryArchive';
import { getReadings, deleteReadings, clearAll } from '@/lib/readingStorage';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';
import type { Reading } from '@/lib/tarot/types';

vi.mock('@/lib/readingStorage', () => ({
  getReadings: vi.fn(),
  deleteReadings: vi.fn(),
  clearAll: vi.fn(),
}));
const reading = (id: string, date: string): Reading => ({
  id,
  question: `问题${id}`,
  createdAt: new Date(date),
  spread: spreads[1],
  drawnCards: spreads[1].positions.map((position, index) => ({
    position,
    card: allCards[index],
    isReversed: index === 1,
  })),
});
const records = [reading('a', '2026-09-15T19:45:00'), reading('b', '2026-08-31T09:00:00')];
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getReadings).mockResolvedValue(records);
});

describe('轨迹档案', () => {
  it('按真实月份倒序分组，保留两种入口和真实牌面', () => {
    const { container } = render(
      <HistoryArchive
        readings={[records[1], records[0]]}
        isSelectionMode={false}
        selectedIds={new Set()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      '2026年9月',
      '2026年8月',
    ]);
    expect(screen.getByText('共 2 次解读')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回看解读：问题a' })).toHaveAttribute(
      'href',
      '/history/a',
    );
    expect(screen.getByRole('link', { name: '继续聊：问题a' })).toHaveAttribute(
      'href',
      '/agent?readingId=a',
    );
    expect(container.querySelectorAll('article img')).toHaveLength(6);
    expect(
      new URL(container.querySelector('article img')!.getAttribute('src')!, window.location.href)
        .pathname,
    ).toBe(allCards[0].image);
    expect(container.querySelector('article img')).not.toHaveAttribute('srcset');
  });
  it('牌图失败时使用牌背，图片地址更新后重新加载牌面', () => {
    const props = {
      readings: [records[0]],
      isSelectionMode: false,
      selectedIds: new Set<string>(),
      onToggle: vi.fn(),
    };
    const { container, rerender } = render(<HistoryArchive {...props} />);
    fireEvent.error(container.querySelector('article img')!);
    expect(container.querySelector('article img')).toHaveAttribute(
      'src',
      '/brand/spread-theme/card-back.webp',
    );
    expect(
      new URL(
        container.querySelectorAll('article img')[1].getAttribute('src')!,
        window.location.href,
      ).pathname,
    ).toBe(allCards[1].image);
    const updated = {
      ...records[0],
      drawnCards: records[0].drawnCards.map((drawn, index) =>
        index === 0 ? { ...drawn, card: allCards[3] } : drawn,
      ),
    };
    rerender(<HistoryArchive {...props} readings={[updated]} />);
    expect(
      new URL(container.querySelector('article img')!.getAttribute('src')!, window.location.href)
        .pathname,
    ).toBe(allCards[3].image);
  });
  it('选择模式不会导航，取消确认不删除，确认后更新计数', async () => {
    render(<HistoryPage />);
    await screen.findByText('共 2 次解读');
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '选择记录' }));
    expect(screen.queryByRole('link', { name: '回看解读：问题a' })).not.toBeInTheDocument();
    const entry = screen.getByRole('button', { name: '选择记录：问题a' });
    fireEvent.click(entry);
    expect(entry).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '保 留' }));
    expect(deleteReadings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
    vi.mocked(getReadings).mockResolvedValue([records[1]]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删 除' }));
    await waitFor(() => expect(deleteReadings).toHaveBeenCalledWith(['a']));
    expect(await screen.findByText('共 1 次解读')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '记录选择' })).not.toBeInTheDocument();
  });
  it('清空仍需确认，完成后显示开始探索入口', async () => {
    render(<HistoryPage />);
    await screen.findByText('共 2 次解读');
    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '清空记录' }));
    expect(clearAll).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '清 空' }));
    expect(await screen.findByText('这里还没有解读记录')).toBeInTheDocument();
    expect(clearAll).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: '开始探索 →' })).toHaveAttribute('href', '/reading');
  });
  it('加载失败不会误显示无记录，保留重试和聊天记录入口', async () => {
    vi.mocked(getReadings).mockRejectedValue(new Error('加载失败'));
    render(<HistoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.queryByText('这里还没有解读记录')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.getByRole('link', { name: '聊天记录' })).toHaveAttribute(
      'href',
      '/history/messages',
    );
  });
});
