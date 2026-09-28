import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryPage from '@/app/library/page';
import HistoryPage from '@/app/history/page';
import HistoryLoading from '@/app/history/loading';
import ProfilePage from '@/app/profile/page';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';
import type { Reading } from '@/lib/tarot/types';

const storage = vi.hoisted(() => ({
  getReadings: vi.fn(),
  deleteReadings: vi.fn(),
  clearAll: vi.fn(),
}));
vi.mock('@/lib/readingStorage', () => storage);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/session/UserSession', () => ({
  useUser: () => ({ user: null, loading: false, error: '', refreshSession: vi.fn() }),
}));

const reading: Reading = {
  id: 'mobile-layout-fixture',
  question: '如何更好地安排接下来的工作与学习？',
  createdAt: new Date(2026, 8, 9, 12),
  spread: spreads[0],
  drawnCards: [{ card: allCards[0], position: spreads[0].positions[0], isReversed: false }],
  interpretation: '先明确最重要的目标，再给每一步留出时间。',
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.getReadings.mockResolvedValue([]);
});
afterEach(cleanup);

it('牌典分类显示对应牌，并链接到独立详情页', () => {
  render(<LibraryPage />);
  expect(screen.getByRole('link', { name: '牌典' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: /圣杯\s*14/ }));
  expect(screen.queryByRole('region', { name: /大阿卡纳/ })).not.toBeInTheDocument();
  const cards = within(screen.getByRole('region', { name: /圣杯/ })).getAllByRole('link', {
    name: /^查看/,
  });
  expect(cards).toHaveLength(14);
  const selected = allCards.find((card) => card.suit === 'cups')!;
  expect(cards[0]).toHaveAttribute('href', '/library/' + selected.id);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('轨迹空状态提供开始探索与当前导航', async () => {
  render(<HistoryPage />);
  expect(await screen.findByRole('link', { name: '开始探索 →' })).toHaveAttribute(
    'href',
    '/reading',
  );
  expect(screen.getByRole('link', { name: '轨迹' })).toHaveAttribute('aria-current', 'page');
});

it.each(['empty', 'records', 'error'] as const)(
  '轨迹加载完成后保留标题、导航与焦点：%s',
  async (result) => {
    let resolve!: (readings: Reading[]) => void;
    let reject!: (error: Error) => void;
    storage.getReadings.mockReturnValue(
      new Promise<Reading[]>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );
    render(<HistoryPage />);
    const title = screen.getByRole('heading', { name: '轨迹' });
    const nav = screen.getByRole('navigation', { name: '主导航' });
    const historyLink = within(nav).getByRole('link', { name: '轨迹' });
    const main = screen.getByRole('main');
    historyLink.focus();
    expect(main).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: '正在载入解读记录' })).toBeInTheDocument();
    expect(screen.queryByText('这里还没有解读记录')).not.toBeInTheDocument();

    await act(async () => {
      if (result === 'error') reject(new Error('暂时无法读取记录'));
      else resolve(result === 'records' ? [reading] : []);
    });

    expect(screen.getByRole('heading', { name: '轨迹' })).toBe(title);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBe(nav);
    expect(screen.getByRole('main')).toBe(main);
    expect(main).toHaveAttribute('aria-busy', 'false');
    expect(historyLink).toHaveFocus();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    if (result === 'error') expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取记录');
    else if (result === 'records')
      expect(screen.getByRole('article')).toHaveTextContent(reading.question);
    else expect(screen.getByText('这里还没有解读记录')).toBeVisible();
  },
);

it('轨迹路由占位与客户端等待数据时使用相同布局', () => {
  storage.getReadings.mockReturnValue(new Promise<Reading[]>(() => {}));
  const loading = render(<HistoryLoading />);
  const markup = loading.container.innerHTML;
  loading.unmount();
  const page = render(<HistoryPage />);
  expect(page.container.innerHTML).toBe(markup);
});

it.each([
  '<think>内部分析</think>\n\n**先明确目标。**',
  '<thinking>内部分析</thinking>\n\n**先明确目标。**',
])('轨迹档案保留问题和详情入口，不展示内部思考：%s', async (interpretation) => {
  storage.getReadings.mockResolvedValue([{ ...reading, interpretation }]);
  render(<HistoryPage />);
  const entry = await screen.findByRole('article');
  expect(within(entry).getByRole('heading', { name: reading.question })).toBeVisible();
  expect(
    within(entry).getByRole('link', { name: `回看解读：${reading.question}` }),
  ).toHaveAttribute('href', `/history/${reading.id}`);
  expect(entry).not.toHaveTextContent('内部分析');
  expect(entry).not.toHaveTextContent('<think');
});

it('轨迹只有未结束的思考时不把思考当作摘要', async () => {
  storage.getReadings.mockResolvedValue([
    { ...reading, interpretation: '<think>内部分析尚未结束' },
  ]);
  render(<HistoryPage />);
  const entry = await screen.findByRole('article');
  expect(entry).not.toHaveTextContent('内部分析');
  expect(
    within(entry).getByRole('link', { name: `回看解读：${reading.question}` }),
  ).toHaveAttribute('href', `/history/${reading.id}`);
});

it('轨迹列表保留详情入口，选择记录后取消删除不会改动记录', async () => {
  storage.getReadings.mockResolvedValue([reading]);
  render(<HistoryPage />);
  expect(
    await screen.findByRole('link', { name: `回看解读：${reading.question}` }),
  ).toHaveAttribute('href', `/history/${reading.id}`);
  expect(screen.getByRole('link', { name: `继续聊：${reading.question}` })).toHaveAttribute(
    'href',
    `/agent?readingId=${reading.id}`,
  );
  fireEvent.click(screen.getByRole('button', { name: '管理' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '选择记录' }));
  const entry = screen.getByRole('button', { name: new RegExp(reading.question) });
  fireEvent.click(entry);
  expect(entry).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '保 留' }));
  expect(storage.deleteReadings).not.toHaveBeenCalled();
  expect(storage.clearAll).not.toHaveBeenCalled();
});

it('我的页面保留真实入口及登录提示，不伪造个人统计', () => {
  render(<ProfilePage />);
  expect(screen.getByRole('link', { name: '我的' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: /解读记录/ })).toHaveAttribute('href', '/history');
  expect(screen.getByRole('link', { name: /每日一牌/ })).toHaveAttribute('href', '/daily');
  expect(screen.getByRole('link', { name: /我的牌典/ })).toHaveAttribute('href', '/library');
  expect(screen.getByRole('link', { name: /聊天记录/ })).toHaveAttribute(
    'href',
    '/history/messages',
  );
  expect(screen.getByText('尚未登录')).toBeVisible();
  expect(screen.getByRole('button', { name: '更换头像' })).toBeDisabled();
  expect(screen.getByLabelText('0 次占卜')).toHaveTextContent('0');
  expect(screen.getByLabelText('0 天相伴')).toHaveTextContent('0');
  expect(screen.getByLabelText('0 张珍藏牌面')).toHaveTextContent('0');
});
