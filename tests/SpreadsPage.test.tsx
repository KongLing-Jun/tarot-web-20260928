import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SpreadsPage from '@/app/spreads/page';
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('目录横向切换后确认当前牌阵，不提前跳转', () => {
  render(<SpreadsPage />);
  expect(screen.getByRole('heading', { name: '牌阵与视角' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('region', { name: '选择牌阵' }), { key: 'ArrowRight' });
  act(() => vi.runAllTimers());
  expect(screen.getByRole('button', { pressed: true })).toHaveAttribute(
    'data-spread-id',
    'timeline',
  );
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '选择此牌阵' }));
  act(() => vi.runAllTimers());
  expect(push).toHaveBeenCalledWith('/reading?spread=timeline');
});
it('牌位说明可展开且不会确认牌阵', () => {
  render(<SpreadsPage />);
  fireEvent.click(screen.getByRole('button', { name: '查看牌位说明' }));
  expect(screen.getByRole('region', { name: '三张牌阵牌位说明' })).toHaveTextContent(
    '用牌面主题回看你已说明的经历，不补写未知的过去。',
  );
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '收起牌位说明' }));
  expect(screen.queryByRole('region', { name: '三张牌阵牌位说明' })).not.toBeInTheDocument();
});

it('场景牌阵单独进入可编辑的问题页', () => {
  render(<SpreadsPage />);
  expect(screen.getByRole('link', { name: '关系走向 · 5 张' })).toHaveAttribute(
    'href',
    '/reading?scene=relationship',
  );
  expect(screen.getByRole('link', { name: '二选一 · 5 张' })).toHaveAttribute(
    'href',
    '/reading?scene=two-options',
  );
  expect(screen.getByRole('link', { name: '事情进展 · 3 张' })).toHaveAttribute(
    'href',
    '/reading?scene=progress',
  );
  expect(screen.getByRole('link', { name: '临场准备 · 1 张' })).toHaveAttribute(
    'href',
    '/reading?scene=preparation',
  );
  expect(screen.getByRole('link', { name: '反复卡住 · 5 张' })).toHaveAttribute(
    'href',
    '/reading?scene=stuck',
  );
});
