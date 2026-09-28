import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DailyCardPreview } from '@/components/daily/DailyCardPreview';
import { getDailyDraw } from '@/lib/tarot/daily';
import { MainNav } from '@/components/layout/MainNav';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('进场自动翻开当日牌，跨过本地午夜后自动更新，仍跳转每日页', async () => {
  vi.useFakeTimers();
  const before = new Date(2026, 8, 9, 23, 59, 59);
  vi.setSystemTime(before);
  render(<DailyCardPreview />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  act(() => {
    vi.advanceTimersByTime(450);
  });
  expect(screen.getByRole('img')).toHaveAttribute('alt', getDailyDraw(before).card.nameCn);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/daily');
  act(() => {
    vi.advanceTimersByTime(550);
  });
  expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  act(() => {
    vi.advanceTimersByTime(450);
  });
  expect(screen.getByRole('img')).toHaveAttribute(
    'alt',
    getDailyDraw(new Date(2026, 8, 10)).card.nameCn,
  );
  expect(screen.getByText('2026-09-10')).toBeInTheDocument();
});

it('从后台回来按当前日期更新，组件卸载后清理计时器', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 9));
  const { unmount } = render(<DailyCardPreview />);
  await act(async () => {
    await Promise.resolve();
  });
  vi.setSystemTime(new Date(2026, 8, 12));
  fireEvent(window, new Event('pageshow'));
  expect(screen.getByText('2026-09-12')).toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('导航每个入口只渲染一个标签，当前页正确标记', () => {
  render(<MainNav activePath="/daily" />);
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(6);
  for (const label of ['首页', '对话', '今日', '牌典', '轨迹', '我的']) {
    expect(screen.getAllByText(label)).toHaveLength(1);
  }
  expect(screen.getByRole('link', { name: '今日' })).toHaveAttribute('aria-current', 'page');
});
