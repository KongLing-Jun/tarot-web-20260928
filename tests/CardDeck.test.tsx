import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CardDeck } from '@/components/drawing/CardDeck';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const callbacks = () => ({ onStart: vi.fn(), onFinish: vi.fn(), onDraw: vi.fn() });

it('完整播放分叠、交错与收拢后只通知当前轮次，不自动抽牌', () => {
  const props = callbacks();
  const { rerender } = render(<CardDeck {...props} status="shuffling" round={4} />);
  expect(screen.getByRole('button', { name: '开始抽牌' })).toBeDisabled();
  act(() => vi.advanceTimersByTime(2399));
  expect(props.onFinish).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(props.onFinish).toHaveBeenCalledExactlyOnceWith(4);
  expect(props.onDraw).not.toHaveBeenCalled();
  rerender(<CardDeck {...props} status="ready" round={4} />);
  fireEvent.click(screen.getByRole('button', { name: '开始抽牌' }));
  expect(props.onDraw).toHaveBeenCalledTimes(1);
});

it('可主动洗牌或直接开始，洗牌时禁止重复点击', () => {
  const props = callbacks();
  const { rerender } = render(<CardDeck {...props} status="idle" round={0} />);
  expect(screen.getByRole('button', { name: '开始抽牌' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '开始抽牌' }));
  expect(props.onDraw).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '点击牌堆洗牌' }));
  expect(props.onStart).toHaveBeenCalledTimes(1);
  rerender(<CardDeck {...props} status="shuffling" round={1} />);
  expect(screen.getByRole('button', { name: '点击牌堆洗牌' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '点击牌堆洗牌' }));
  expect(props.onStart).toHaveBeenCalledTimes(1);
  rerender(<CardDeck {...props} status="ready" round={1} />);
  expect(screen.getByRole('button', { name: '开始抽牌' })).toBeEnabled();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.getByText('轻点牌堆，可再洗一次')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '点击牌堆洗牌' }));
  expect(props.onStart).toHaveBeenCalledTimes(2);
  act(() => vi.runAllTimers());
  expect(props.onFinish).not.toHaveBeenCalled();
});

it('新一轮开始或组件卸载时清理上一轮动画的完成回调', () => {
  const props = callbacks();
  const { rerender, unmount } = render(<CardDeck {...props} status="shuffling" round={1} />);
  act(() => vi.advanceTimersByTime(1200));
  rerender(<CardDeck {...props} status="shuffling" round={2} />);
  act(() => vi.advanceTimersByTime(1200));
  expect(props.onFinish).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1200));
  expect(props.onFinish).toHaveBeenCalledExactlyOnceWith(2);
  rerender(<CardDeck {...props} status="shuffling" round={3} />);
  unmount();
  act(() => vi.runAllTimers());
  expect(props.onFinish).toHaveBeenCalledTimes(1);
});

it('减少动态效果时直接就绪，仍需用户主动开始抽牌', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const props = callbacks();
  render(<CardDeck {...props} status="shuffling" round={1} />);
  expect(props.onFinish).toHaveBeenCalledExactlyOnceWith(1);
  expect(props.onDraw).not.toHaveBeenCalled();
});
