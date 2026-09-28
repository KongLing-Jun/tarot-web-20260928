import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CelticCrossLayout } from '@/components/cards/CelticCrossLayout';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';
const drawnCards = spreads
  .find((s) => s.id === 'celtic-cross')!
  .positions.map((position, i) => ({ position, card: allCards[i], isReversed: i === 1 }));
afterEach(cleanup);
describe('凯尔特十字揭牌', () => {
  it('十字图全部牌位存在，未来牌位不能越序揭开', () => {
    const onReveal = vi.fn();
    render(
      <CelticCrossLayout
        drawnCards={drawnCards}
        revealedCount={0}
        onReveal={onReveal}
        appearance="ritual"
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const future = screen.getByRole('button', { name: /最终结果，尚未揭牌/ });
    fireEvent.click(future);
    expect(onReveal).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: /现状，点击揭牌/ }), { key: ' ' });
    expect(onReveal).toHaveBeenCalledExactlyOnceWith(0);
  });
  it('两种视图不重置进度，已揭牌可查看详情而不再派发揭牌', () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <CelticCrossLayout
        drawnCards={drawnCards}
        revealedCount={1}
        onReveal={onReveal}
        appearance="ritual"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '按位置查看' }));
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('button')).toHaveLength(10);
    fireEvent.click(within(list).getByRole('button', { name: /1. 现状/ }));
    expect(screen.getByRole('region', { name: '位置详情' })).toHaveTextContent('愚者');
    expect(onReveal).not.toHaveBeenCalled();
    rerender(
      <CelticCrossLayout
        drawnCards={drawnCards}
        revealedCount={9}
        onReveal={onReveal}
        appearance="ritual"
      />,
    );
    fireEvent.click(within(list).getByRole('button', { name: /10. 最终结果/ }));
    expect(onReveal).toHaveBeenCalledExactlyOnceWith(9);
    rerender(
      <CelticCrossLayout
        drawnCards={drawnCards}
        revealedCount={10}
        onReveal={onReveal}
        appearance="ritual"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '牌阵图' }));
    expect(screen.getAllByRole('img')).toHaveLength(10);
    expect(screen.getByText('2 挑战')).toBeVisible();
  });
});
