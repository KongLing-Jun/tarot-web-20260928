import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FanDeck } from '@/components/cards/FanDeck';
import { FAN } from '@/components/cards/fan-geometry';
import { TestPointerEvent } from './helpers/pointer-event';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(230);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 390,
    height: 230,
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ selected = [] }: { selected?: number[] }) {
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <FanDeck
      deckSize={78}
      selectedIndices={selected}
      previewIndex={preview}
      onPreview={setPreview}
    />
  );
}

describe('完整半圆环牌堆', () => {
  it('牌堆在大视窗内居中时，缩放锚点包含牌堆顶部偏移', () => {
    render(<Harness />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    const view = region.parentElement!;
    Object.defineProperty(region, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 60, width: 390, height: 230 }) as DOMRect,
    });
    Object.defineProperty(region, 'offsetTop', { value: 60 });
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 250, clientY: 150 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 350, clientY: 150 });
    expect(view.scrollTop).toBeCloseTo(0);
    expect(screen.getByText('双指移动查看 · 捏合缩小牌堆')).toBeInTheDocument();
  });
  it('触摸事件被浏览器调整到邻牌时仍选择触点处可见牌', () => {
    render(<Harness />);
    const visible = screen.getByRole('button', { name: '牌堆第 45 张，未翻开' });
    const neighbor = screen.getByRole('button', { name: '牌堆第 47 张，未翻开' });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => visible,
    });
    try {
      fireEvent.pointerDown(neighbor, {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 195,
        clientY: 65,
      });
      fireEvent.pointerUp(neighbor, {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 195,
        clientY: 65,
      });
      expect(visible).toHaveAttribute('aria-pressed', 'true');
      expect(neighbor).toHaveAttribute('aria-pressed', 'false');
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
  it('首、中、尾牌从相同叠牌中心展开，不依赖卡牌宽度为100', () => {
    render(<Harness />);
    for (const index of [0, 38, 77]) {
      const card = screen.getByRole('button', { name: `牌堆第 ${index + 1} 张，未翻开` });
      const x = (parseFloat(card.style.left) / 100) * FAN.width;
      const y = (parseFloat(card.style.top) / 100) * FAN.height;
      expect(
        x + (parseFloat(card.style.getPropertyValue('--fold-x')) / 100) * FAN.cardWidth,
      ).toBeCloseTo(FAN.cx);
      expect(
        y + (parseFloat(card.style.getPropertyValue('--fold-y')) / 100) * FAN.cardHeight,
      ).toBeCloseTo(FAN.cy);
    }
  });
  it('双指松手消费最终坐标，等距离移动只调整视野', () => {
    render(<Harness />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    const view = region.parentElement!;
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 250, clientY: 150 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 300, clientY: 150 });
    expect(region.style.width).toBe('150%');
    fireEvent.pointerUp(view, { pointerId: 2, clientX: 350, clientY: 150 });
    expect(region.style.width).toBe('200%');
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 250, clientY: 150 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 130, clientY: 150 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 230, clientY: 150 });
    expect(region.style.width).toBe('200%');
    expect(view.scrollLeft).toBeCloseTo(20);
  });

  it.each([0, 77])('端牌 %s 沿自身径向拖出，仍可确认抽牌', (index) => {
    const extract = vi.fn();
    render(
      <FanDeck
        deckSize={78}
        selectedIndices={[]}
        previewIndex={index}
        onPreview={vi.fn()}
        onExtract={extract}
      />,
    );
    const view = screen.getByRole('region', { name: '半圆环牌堆' }).parentElement!;
    const x = index === 0 ? 60 : 330;
    const end = x + (index === 0 ? -60 : 60);
    fireEvent.pointerDown(screen.getByRole('button', { name: `牌堆第 ${index + 1} 张，未翻开` }), {
      pointerId: 1,
      clientX: x,
      clientY: 199,
    });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: end, clientY: 199 });
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      index,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it('双指缩放有边界，保留预选；不再显示缩放按钮', () => {
    render(<Harness selected={[1]} />);
    fireEvent.click(screen.getByRole('button', { name: '牌堆第 43 张，未翻开' }));
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    const view = region.parentElement!;
    fireEvent.pointerDown(view, { pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 250, clientY: 150 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 450, clientY: 150 });
    expect(region.style.width).toBe('200%');
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 155, clientY: 150 });
    expect(region.style.width).toBe('75%');
    expect(screen.getByRole('button', { name: '牌堆第 43 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '牌堆第 2 张，已抽取' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '放大牌堆' })).toBeNull();
    expect(screen.queryByRole('button', { name: '缩小牌堆' })).toBeNull();
  });

  it('一次展示全部78张，只提供牌背，已抽位置保留且不可选', () => {
    const preview = vi.fn();
    const { container } = render(
      <FanDeck deckSize={78} selectedIndices={[1]} previewIndex={null} onPreview={preview} />,
    );
    expect(
      within(screen.getByRole('region', { name: '半圆环牌堆' })).getAllByRole('button'),
    ).toHaveLength(78);
    expect(screen.getByRole('button', { name: '牌堆第 78 张，未翻开' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '牌堆第 2 张，已抽取' })).toBeDisabled();
    const backs = [...container.querySelectorAll('img')];
    expect(backs).toHaveLength(77);
    expect(
      backs.every(
        (image) =>
          image.getAttribute('src') === '/brand/spread-theme/card-back.webp' && image.alt === '',
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' }));
    expect(preview).toHaveBeenLastCalledWith(0);
  });

  it('双指结束后的剩余单指不能误抽，新手势仍可拨牌', () => {
    const extract = vi.fn();
    render(
      <FanDeck
        deckSize={78}
        selectedIndices={[]}
        previewIndex={38}
        onPreview={vi.fn()}
        onExtract={extract}
      />,
    );
    const view = screen.getByRole('region', { name: '半圆环牌堆' }).parentElement!;
    const card = screen.getByRole('button', { name: '牌堆第 39 张，未翻开' });
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 195, clientY: 65 });
    fireEvent.pointerDown(view, { pointerId: 2, clientX: 250, clientY: 65 });
    fireEvent.pointerMove(view, { pointerId: 2, clientX: 300, clientY: 65 });
    fireEvent.pointerUp(view, { pointerId: 2, clientX: 300, clientY: 65 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 195, clientY: -30 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 195, clientY: -30 });
    expect(extract).not.toHaveBeenCalled();
    fireEvent.pointerDown(card, { pointerId: 3, clientX: 195, clientY: 65 });
    fireEvent.pointerMove(view, { pointerId: 3, clientX: 195, clientY: -10 });
    expect(extract).not.toHaveBeenCalled();
    fireEvent.pointerUp(view, { pointerId: 3, clientX: 195, clientY: -10 });
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      38,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it.each(['short', 'cancel', 'return', 'tangent', 'lost', 'third'])(
    '%s 拖动不会提交抽牌',
    (mode) => {
      const extract = vi.fn();
      render(
        <FanDeck
          deckSize={78}
          selectedIndices={[]}
          previewIndex={38}
          onPreview={vi.fn()}
          onExtract={extract}
        />,
      );
      const view = screen.getByRole('region', { name: '半圆环牌堆' }).parentElement!;
      const card = screen.getByRole('button', { name: '牌堆第 39 张，未翻开' });
      fireEvent.pointerDown(card, { pointerId: 1, clientX: 195, clientY: 65 });
      fireEvent.pointerMove(view, {
        pointerId: 1,
        clientX: mode === 'tangent' ? 270 : 195,
        clientY: mode === 'short' ? 45 : mode === 'tangent' ? 90 : -10,
      });
      if (mode === 'cancel') fireEvent.pointerCancel(view, { pointerId: 1 });
      if (mode === 'lost') fireEvent.lostPointerCapture(view, { pointerId: 1 });
      if (mode === 'third') {
        fireEvent.pointerDown(view, { pointerId: 2, clientX: 250, clientY: 65 });
        fireEvent.pointerDown(view, { pointerId: 3, clientX: 300, clientY: 65 });
      }
      fireEvent.pointerUp(view, {
        pointerId: 1,
        clientX: mode === 'tangent' ? 270 : 195,
        clientY: mode === 'short' ? 45 : mode === 'return' ? 65 : mode === 'tangent' ? 90 : -10,
      });
      expect(extract).not.toHaveBeenCalled();
    },
  );

  it('松手的最终位置达到阈值时只确认一次，取消合成点击', () => {
    const extract = vi.fn();
    const preview = vi.fn();
    render(
      <FanDeck
        deckSize={78}
        selectedIndices={[]}
        previewIndex={38}
        onPreview={preview}
        onExtract={extract}
      />,
    );
    const view = screen.getByRole('region', { name: '半圆环牌堆' }).parentElement!;
    const card = screen.getByRole('button', { name: '牌堆第 39 张，未翻开' });
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 195, clientY: 65 });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 195, clientY: 45 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 195, clientY: -10 });
    fireEvent.pointerUp(view, { pointerId: 1, clientX: 195, clientY: -10 });
    fireEvent.click(card, { detail: 1 });
    expect(extract).toHaveBeenCalledExactlyOnceWith(
      38,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
    expect(preview).not.toHaveBeenCalled();
  });

  it('首尾预选始终留在自己的扇区，不滚动居中', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });
    render(<Harness />);
    const first = screen.getByRole('button', { name: '牌堆第 1 张，未翻开' });
    const last = screen.getByRole('button', { name: '牌堆第 78 张，未翻开' });
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(Number.parseFloat(first.style.left)).toBeLessThan(25);
    fireEvent.click(last);
    expect(last).toHaveAttribute('aria-pressed', 'true');
    expect(Number.parseFloat(last.style.left)).toBeGreaterThan(75);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('精确调整跳过已抽牌，首末有边界，全部牌可达', () => {
    render(<Harness selected={[1, 76]} />);
    fireEvent.keyDown(screen.getByRole('region', { name: '半圆环牌堆' }), { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: '上一张' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('region', { name: '半圆环牌堆' }), { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '牌堆第 3 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    fireEvent.keyDown(region, { key: 'End' });
    expect(screen.getByRole('button', { name: '牌堆第 78 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '牌堆第 78 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: '牌堆第 76 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(region, { key: 'Home' });
    expect(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('取消手势恢复原预选，随后指针点击被抑制，语义激活仍可用', () => {
    const preview = vi.fn();
    render(<FanDeck deckSize={78} selectedIndices={[]} previewIndex={3} onPreview={preview} />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 390,
      height: 238,
    } as DOMRect);
    fireEvent.pointerDown(region, { clientX: 195, clientY: 55, pointerId: 1 });
    fireEvent.pointerMove(region, { clientX: 220, clientY: 65, pointerId: 1 });
    fireEvent.pointerCancel(region, { pointerId: 1 });
    expect(preview).toHaveBeenLastCalledWith(3);
    const first = screen.getByRole('button', { name: '牌堆第 1 张，未翻开' });
    fireEvent.click(first, { detail: 1 });
    expect(preview).toHaveBeenLastCalledWith(3);
    fireEvent.click(first, { detail: 0 });
    expect(preview).toHaveBeenLastCalledWith(0);
  });

  it('圆环内留白不选牌，禁用状态不响应浏览或键盘', () => {
    const preview = vi.fn();
    const { rerender } = render(
      <FanDeck deckSize={78} selectedIndices={[]} previewIndex={null} onPreview={preview} />,
    );
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 390,
      height: 238,
    } as DOMRect);
    fireEvent.pointerDown(region, { clientX: 195, clientY: 195, pointerId: 1 });
    fireEvent.pointerUp(region, { clientX: 195, clientY: 195, pointerId: 1 });
    expect(preview).not.toHaveBeenCalled();
    rerender(
      <FanDeck
        deckSize={78}
        selectedIndices={[]}
        previewIndex={null}
        disabled
        onPreview={preview}
      />,
    );
    expect(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' })).toBeDisabled();
    fireEvent.keyDown(region, { key: 'Home' });
    expect(screen.queryByRole('button', { name: '下一张' })).not.toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it('重叠区域按可见牌命中，开始滑动时不会跳到被遮挡的另一张', () => {
    const preview = vi.fn();
    render(<FanDeck deckSize={78} selectedIndices={[]} previewIndex={null} onPreview={preview} />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 390,
      height: 230,
    } as DOMRect);
    const visible = screen.getByRole('button', { name: '牌堆第 43 张，未翻开' });
    fireEvent.pointerDown(visible, { clientX: 195, clientY: 65, pointerId: 1 });
    expect(preview).toHaveBeenLastCalledWith(42);
    fireEvent.pointerMove(region, { clientX: 195, clientY: 65, pointerId: 1 });
    expect(preview).toHaveBeenLastCalledWith(42);
    fireEvent.pointerUp(region, { clientX: 195, clientY: 65, pointerId: 1 });
    fireEvent.click(visible, { detail: 1 });
    expect(preview.mock.calls.every(([index]) => index === 42)).toBe(true);
  });
});
