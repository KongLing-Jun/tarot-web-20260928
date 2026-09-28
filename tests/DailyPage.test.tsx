import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DailyCardPage from '@/app/daily/page';
import { getDailyDraw } from '@/lib/tarot/daily';
import { getDailyNote } from '@/lib/dailyStorage';
import { mockDailyApi, makeEntry } from './helpers/daily-api';
import { streamInterpret } from '@/lib/api/stream-client';

const drafts = vi.hoisted(() => new Map());
let api: ReturnType<typeof mockDailyApi>;
vi.mock('@/components/session/UserSession', () => ({ useUser: () => ({ dailyDrafts: drafts }) }));

vi.mock('@/hooks/useApiConfig', () => ({ useApiConfig: () => ({ config: {} }) }));
vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));
vi.mock('@/components/cards/TarotCard', () => ({ TarotCardComponent: () => <div>牌面</div> }));

beforeEach(() => {
  vi.mocked(streamInterpret).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 9, 12));
  localStorage.clear();
  drafts.clear();
  api = mockDailyApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

it('仅有思考不显示为已完成，保存失败后的重试不重新生成', async () => {
  vi.mocked(streamInterpret).mockResolvedValueOnce({
    fullText: '<think>分析中</think>',
    truncated: false,
    usingFallback: false,
    receivedError: false,
  });
  render(<DailyCardPage />);
  await settle();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /生成今日解读/ }));
  });
  expect(screen.getByText(/未收到有效解读/)).toBeInTheDocument();
  vi.mocked(streamInterpret).mockResolvedValueOnce({
    fullText: '当日指引',
    truncated: false,
    usingFallback: false,
    receivedError: false,
    generationStatus: 'completed',
    persistenceStatus: 'failed',
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '重 试' }));
  });
  expect(screen.getByText('当日指引')).toBeInTheDocument();
  expect(screen.getByText(/历史记录保存失败/)).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '重 试' }));
  });
  expect(streamInterpret).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/历史记录仍未保存/)).toBeInTheDocument();
});

it('重新进入页面恢复数据库中的每日解读与札记', async () => {
  api.entries.set('2026-09-09', {
    ...makeEntry('2026-09-09'),
    interpretation: '数据库保存的每日指引',
    interpretationStatus: 'done',
    note: '数据库保存的札记',
    updatedAt: new Date().toISOString(),
  });
  render(<DailyCardPage />);
  await settle();
  expect(screen.getByText('数据库保存的每日指引')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '每日札记' })).toHaveValue('数据库保存的札记');
});

it('提供今日导航、全部关键词及解读、札记和轨迹入口', async () => {
  render(<DailyCardPage />);
  await settle();
  expect(screen.getByRole('link', { name: '今日' })).toHaveAttribute('aria-current', 'page');
  const draw = getDailyDraw(new Date());
  const keywords = draw.isReversed ? draw.card.keywords.reversed : draw.card.keywords.upright;
  const list = screen.getByRole('list', { name: '牌面关键词' });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual(keywords);
  expect(screen.getByRole('button', { name: /生成今日解读/ })).toBeEnabled();
  expect(
    screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent?.replace(/\s/g, '')),
  ).toEqual(['今日解读', '心之札记', '近期轨迹']);
  expect(screen.getByRole('textbox', { name: '每日札记' })).toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: '最近十四日的牌' })).getAllByRole('button'),
  ).toHaveLength(14);
});

it('切换过去日期保留最近十四日范围，札记按日期保存并可回到今天', async () => {
  render(<DailyCardPage />);
  await settle();
  const history = screen.getByRole('list', { name: '最近十四日的牌' });
  const originalDates = within(history)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'));
  fireEvent.change(screen.getByRole('textbox', { name: '每日札记' }), {
    target: { value: '今天的感受' },
  });
  fireEvent.click(within(history).getAllByRole('button')[1]);
  await settle();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('昔日之牌');
  expect(within(history).getAllByRole('button')[1]).toHaveAttribute('aria-current', 'date');
  expect(
    within(history)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')?.replace(' · 有札记', '')),
  ).toEqual(originalDates);
  expect(screen.getByRole('textbox', { name: '每日札记' })).toHaveValue('');
  expect((await getDailyNote('2026-09-09'))?.note).toBe('今天的感受');
  fireEvent.click(screen.getByRole('button', { name: '回 到 今 日' }));
  await settle();
  expect(screen.getByRole('textbox', { name: '每日札记' })).toHaveValue('今天的感受');
  expect(within(history).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'date');
});
