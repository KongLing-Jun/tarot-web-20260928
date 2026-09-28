import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevealStage } from '@/components/drawing/RevealStage';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';

afterEach(cleanup);
const spread = spreads[1];
const drawnCards = spread.positions.map((position, i) => ({
  position,
  card: allCards[i],
  isReversed: i === 1,
}));
function props(revealedCount = 0) {
  return {
    question: '我可以如何行动？',
    spread,
    drawnCards,
    revealedCount,
    canUseApi: true,
    isLoaded: true,
    isInterpreting: false,
    onNext: vi.fn(),
    onAll: vi.fn(),
    onReturn: vi.fn(),
    onRedraw: vi.fn(),
    onInterpret: vi.fn(),
  };
}

function menuAction(name: string) {
  if (!screen.queryByRole('menu'))
    fireEvent.click(screen.getByRole('button', { name: '揭牌更多操作' }));
  return screen.getByRole('menuitem', { name });
}

describe('揭牌舞台行为', () => {
  it('只允许下一张触发揭牌，并呈现问题和真实进度', () => {
    const p = props();
    render(<RevealStage {...p} />);
    expect(screen.getByText(p.question)).toBeInTheDocument();
    expect(screen.getByText('月映卡语', { exact: true })).toBeVisible();
    expect(screen.getByText('已揭 0 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '未来，尚未揭牌' }));
    expect(p.onNext).not.toHaveBeenCalled();
    const first = screen.getByRole('button', { name: '过去，点击揭牌' });
    fireEvent.click(first);
    expect(p.onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(first, { key: 'Enter', repeat: true });
    act(() => {
      fireEvent.keyDown(first, { key: 'Enter' });
      fireEvent.click(first);
    });
    expect(p.onNext).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('部分揭开保留牌名与正逆位，移除返回调整，全揭后不自动解读', () => {
    const p = props(1);
    const { rerender } = render(<RevealStage {...p} />);
    expect(screen.getByText('愚者')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回调整' })).not.toBeInTheDocument();
    const all = menuAction('全部揭牌');
    all.focus();
    fireEvent.click(all);
    expect(p.onAll).toHaveBeenCalledTimes(1);
    rerender(<RevealStage {...p} revealedCount={3} />);
    expect(screen.getByText('已揭 3 / 3')).toBeInTheDocument();
    expect(screen.getByText('逆位')).toBeInTheDocument();
    const interpret = screen.getByRole('button', { name: '解读这些牌' });
    expect(interpret).toHaveFocus();
    expect(p.onInterpret).not.toHaveBeenCalled();
    fireEvent.click(interpret, { detail: 2 });
    expect(p.onInterpret).not.toHaveBeenCalled();
    fireEvent.click(interpret);
    expect(p.onInterpret).toHaveBeenCalledTimes(1);
  });
  it('服务不可用时保留牌面和重抽入口，解读保持禁用', () => {
    render(<RevealStage {...props(3)} canUseApi={false} />);
    expect(screen.getByRole('button', { name: '解读这些牌' })).toBeDisabled();
    expect(screen.getByText('AI 服务暂不可用，已抽出的牌会保留。')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(menuAction('重新抽牌')).toBeEnabled();
  });
  it('未揭牌时仅菜单提供辅助操作，单击揭牌不解读，菜单可取消', () => {
    const p = props();
    render(<RevealStage {...p} />);
    expect(screen.queryByRole('button', { name: '揭开下一张' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(menuAction('返回调整'));
    expect(p.onReturn).toHaveBeenCalledOnce();
    menuAction('全部揭牌');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '揭牌更多操作' })).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '过去，点击揭牌' }));
    expect(p.onNext).toHaveBeenCalledOnce();
    expect(p.onInterpret).not.toHaveBeenCalled();
  });
  it('每张牌单击翻开，连击不会跨牌；已揭牌不可重复翻开', () => {
    const p = props();
    const { rerender } = render(<RevealStage {...p} />);
    const first = screen.getByRole('button', { name: '过去，点击揭牌' });
    fireEvent.click(first);
    fireEvent.click(first);
    rerender(<RevealStage {...p} revealedCount={1} />);
    fireEvent.click(first);
    const second = screen.getByRole('button', { name: '现在，点击揭牌' });
    fireEvent.click(second);
    expect(p.onNext).toHaveBeenCalledTimes(2);
    fireEvent.click(second);
    expect(p.onNext).toHaveBeenCalledTimes(2);
  });
  it('凯尔特十字的牌阵图和位置列表均支持单击揭牌', () => {
    const cross = spreads.find((s) => s.id === 'celtic-cross')!;
    const p = {
      ...props(),
      spread: cross,
      drawnCards: cross.positions.map((position, i) => ({
        position,
        card: allCards[i],
        isReversed: false,
      })),
    };
    const { rerender } = render(<RevealStage {...p} />);
    fireEvent.click(screen.getByRole('button', { name: `${cross.positions[0].nameCn}，点击揭牌` }));
    expect(p.onNext).toHaveBeenCalledOnce();
    rerender(<RevealStage {...p} revealedCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: '按位置查看' }));
    fireEvent.click(screen.getByRole('button', { name: /2\. 挑战/ }));
    expect(p.onNext).toHaveBeenCalledTimes(2);
  });
  it.each(spreads.filter((s) => s.id !== 'celtic-cross'))(
    '$nameCn 始终显示全部真实牌位',
    (spread) => {
      const cards = spread.positions.map((position, i) => ({
        position,
        card: allCards[i],
        isReversed: false,
      }));
      const { container, rerender } = render(
        <RevealStage {...props()} spread={spread} drawnCards={cards} />,
      );
      expect(container.querySelectorAll('[data-reveal-card]')).toHaveLength(cards.length);
      for (const position of spread.positions)
        expect(screen.getByText(position.nameCn)).toBeInTheDocument();
      rerender(<RevealStage {...props(cards.length)} spread={spread} drawnCards={cards} />);
      expect(screen.getAllByRole('img')).toHaveLength(cards.length);
      expect(screen.queryByRole('button', { name: '全部揭牌' })).not.toBeInTheDocument();
    },
  );
});
