import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SpreadSelector } from '@/components/drawing/SpreadSelector';
import { CelticCrossLayout } from '@/components/cards/CelticCrossLayout';
import { spreads } from '@/lib/tarot/spreads';
import { allCards } from '@/lib/tarot/cards';

afterEach(cleanup);

it('择阵页展示中央与相邻牌阵，以滑动和轻点提示替代切换按钮', () => {
  render(<SpreadSelector selectedSpread={spreads[0]} onSelect={vi.fn()} />);
  expect(
    within(screen.getByRole('region', { name: '选择牌阵' }))
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed')),
  ).toHaveLength(3);
  expect(screen.queryByRole('button', { name: '上一个牌阵' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '下一个牌阵' })).not.toBeInTheDocument();
  expect(screen.getByText('左右滑动，寻找心仪的牌阵')).toBeVisible();
  expect(screen.getByRole('region', { name: '选择牌阵' })).toHaveAccessibleDescription(
    /左右方向键切换.*回车确认/,
  );
  expect(screen.getByRole('heading', { name: '单张牌' })).toBeVisible();
});

it('凯尔特位置视图遵守揭牌顺序，详情含完整牌名正逆位，切换不触发重新揭牌', () => {
  const spread = spreads.find((item) => item.id === 'celtic-cross')!;
  const cards = spread.positions.map((position, index) => ({
    position,
    card: allCards[index],
    isReversed: index === 0,
  }));
  const onReveal = vi.fn();
  const { rerender } = render(
    <CelticCrossLayout drawnCards={cards} revealedCount={0} onReveal={onReveal} />,
  );
  fireEvent.click(screen.getByRole('button', { name: '按位置查看' }));
  const positions = within(screen.getByRole('list')).getAllByRole('button');
  expect(positions[0]).toHaveTextContent('点击揭开这张牌');
  expect(positions[1]).toBeDisabled();
  fireEvent.click(positions[0]);
  expect(onReveal).toHaveBeenCalledExactlyOnceWith(0);
  rerender(<CelticCrossLayout drawnCards={cards} revealedCount={1} onReveal={onReveal} />);
  const detail = screen.getByRole('region', { name: '位置详情' });
  expect(detail).toHaveTextContent(cards[0].card.nameCn);
  expect(detail).toHaveTextContent('逆位');
  expect(detail).toHaveTextContent(cards[0].card.meaning.reversed);
  fireEvent.click(screen.getByRole('button', { name: '牌阵图' }));
  fireEvent.click(screen.getByRole('button', { name: '按位置查看' }));
  expect(onReveal).toHaveBeenCalledTimes(1);
});
