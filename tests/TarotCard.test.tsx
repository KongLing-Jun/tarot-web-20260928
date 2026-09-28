import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TarotCardComponent } from '@/components/cards/TarotCard';
import { CardBack } from '@/components/cards/CardBack';
import { allCards } from '@/lib/tarot/cards';

beforeEach(() => {
  vi.stubGlobal('React', React);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('卡牌展示与重试', () => {
  it('揭牌外观独立使用仪式卡背，关闭重复牌名并保留默认外观', () => {
    const { container, rerender } = render(
      <TarotCardComponent card={allCards[0]} appearance="ritual" />,
    );
    expect(container.querySelector('img[src="/brand/spread-theme/card-back.webp"]')).not.toBeNull();
    rerender(<TarotCardComponent card={allCards[0]} isRevealed isReversed appearance="ritual" />);
    expect(
      new URL(screen.getByRole('img').getAttribute('src')!, window.location.href).pathname,
    ).toBe(allCards[0].image);
    expect(screen.queryByText('逆 位')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    rerender(<TarotCardComponent card={allCards[0]} isRevealed isReversed />);
    expect(container.querySelector('img[src="/brand/spread-theme/card-back.webp"]')).toBeNull();
    expect(screen.getByText('逆 位')).toBeInTheDocument();
  });

  it('阶段可访问名称不暴露未揭身份，禁用牌不能被点击或键盘触发', () => {
    const click = vi.fn();
    render(
      <TarotCardComponent
        card={allCards[0]}
        onClick={click}
        disabled
        ariaLabel="未来，尚未揭牌"
        appearance="ritual"
      />,
    );
    const card = screen.getByRole('button', { name: '未来，尚未揭牌' });
    expect(card).toHaveAttribute('aria-disabled', 'true');
    expect(card).toHaveAttribute('tabindex', '-1');
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('扇形的静态卡背不加载牌面或运行持续旋转', () => {
    const { container } = render(<CardBack compact animated={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.anim-lunar')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
  it('未揭牌的可访问名称和正面均不透露结果', () => {
    const { container, rerender } = render(
      <TarotCardComponent card={allCards[0]} isReversed onClick={() => {}} />,
    );
    expect(screen.getByRole('button')).toHaveAccessibleName('未翻开的塔罗牌');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('img')?.closest('[aria-hidden="true"]')).not.toBeNull();
    rerender(<TarotCardComponent card={allCards[0]} isReversed isRevealed onClick={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(
      `${allCards[0].nameCn} (${allCards[0].name}) · 逆位`,
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('失败后重试原图，重试不会触发卡牌点击', () => {
    const click = vi.fn();
    render(<TarotCardComponent card={allCards[0]} isRevealed isReversed onClick={click} />);
    const source = screen.getByRole('img').getAttribute('src');
    fireEvent.error(screen.getByRole('img'));
    const retry = screen.getByRole('button', { name: '重试加载牌面' });
    fireEvent.keyDown(retry, { key: 'Enter' });
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(screen.getByRole('img')).toHaveAttribute('src', source);
    expect(screen.getByText('逆 位')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
  });

  it('更换卡牌后不会沿用前一张牌的加载失败状态', () => {
    const { rerender } = render(<TarotCardComponent card={allCards[0]} isRevealed />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<TarotCardComponent card={allCards[1]} isRevealed />);
    expect(
      new URL(screen.getByRole('img').getAttribute('src')!, window.location.href).pathname,
    ).toBe(allCards[1].image);
  });
});
