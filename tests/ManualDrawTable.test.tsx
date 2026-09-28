import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualDrawTable } from '@/components/drawing/ManualDrawTable';
import { getSpreadById } from '@/lib/tarot/spreads';
import { TestPointerEvent } from './helpers/pointer-event';

const confirm = vi.fn();
const reveal = vi.fn();

function Harness({ spreadId = 'single', initial = [] }: { spreadId?: string; initial?: number[] }) {
  const spread = getSpreadById(spreadId)!;
  const [slots, setSlots] = useState<(number | null)[]>(() =>
    spread.positions.map((_, i) => initial[i] ?? null),
  );
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <ManualDrawTable
      spread={spread}
      deckSize={78}
      slots={slots}
      previewIndex={preview}
      onPreview={setPreview}
      onConfirm={() => {
        confirm(preview);
        setSlots((current) =>
          current.map((value, i) => (i === current.indexOf(null) ? preview : value)),
        );
        setPreview(null);
      }}
      onUndo={(slot) => {
        setSlots((current) => current.map((value, i) => (i === slot ? null : value)));
        setPreview(null);
      }}
      onReveal={reveal}
      onEdit={vi.fn()}
      onReshuffle={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(39);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(61);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 20,
    top: 40,
    width: 39,
    height: 61,
  } as DOMRect);
  vi.stubGlobal(
    'getComputedStyle',
    vi.fn(() => ({ transform: 'none', getPropertyValue: () => '' })),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  confirm.mockReset();
  reveal.mockReset();
});

function menuAction(name: string) {
  if (!screen.queryByRole('menu'))
    fireEvent.click(screen.getByRole('button', { name: '抽牌更多操作' }));
  return screen.getByRole('menuitem', { name });
}

function select(index: number) {
  if (screen.queryByRole('menu')) fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: `牌堆第 ${index + 1} 张，未翻开` }));
  fireEvent.click(screen.getByRole('button', { name: `牌堆第 ${index + 1} 张，未翻开` }));
}

describe('以牌堆为中心的抽取界面', () => {
  it('第一次触屏轻点只高亮，同一张第二次轻点抽取，合成 click 不重复提交', () => {
    render(<Harness spreadId="three-card" />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    Object.defineProperty(region, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 390, height: 230 }) as DOMRect,
    });
    const card = screen.getByRole('button', { name: '牌堆第 39 张，未翻开' });
    const tap = (id: number) => {
      fireEvent.pointerDown(card, { pointerId: id, clientX: 195, clientY: 65 });
      fireEvent.pointerUp(region.parentElement!, { pointerId: id, clientX: 195, clientY: 65 });
    };
    tap(1);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(confirm).not.toHaveBeenCalled();
    tap(2);
    fireEvent.click(card, { detail: 1 });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(38);
    expect(card).toBeDisabled();
  });

  it('改点其他牌只更新高亮，第二次激活才抽取', () => {
    render(<Harness spreadId="three-card" />);
    fireEvent.click(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' }));
    const other = screen.getByRole('button', { name: '牌堆第 2 张，未翻开' });
    fireEvent.click(other);
    expect(confirm).not.toHaveBeenCalled();
    expect(other).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(other);
    expect(confirm).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('辅助操作默认收起，菜单支持方向键、Escape 与外部点击', () => {
    render(<Harness />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '抽取这张' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: '抽牌更多操作' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: '撤回上一张' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '修改问题' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: '修改牌阵' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('没有顶部牌位或待抽取占位，尚未抽取时不能撤回', () => {
    render(<Harness spreadId="three-card" />);
    expect(screen.queryByRole('list', { name: '已选阵位' })).not.toBeInTheDocument();
    expect(screen.queryByText('待抽取')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '半圆环牌堆' }).style.width).toBe('100%');
    expect(menuAction('撤回上一张')).toBeDisabled();
    expect(screen.getByText('已抽 0 / 3')).toBeInTheDocument();
  });

  it('沿弧换牌后向外拖出，不支持动画时仍提交正确牌', () => {
    render(<Harness spreadId="three-card" />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    Object.defineProperty(region, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 390, height: 230 }) as DOMRect,
    });
    const view = region.parentElement!;
    fireEvent.pointerDown(screen.getByRole('button', { name: '牌堆第 39 张，未翻开' }), {
      pointerId: 1,
      clientX: 195,
      clientY: 65,
    });
    fireEvent.pointerMove(view, { pointerId: 1, clientX: 225, clientY: 68 });
    const selected = region.querySelector('[aria-pressed="true"]') as HTMLButtonElement;
    const index = Number(selected.dataset.deckIndex);
    expect(index).toBeGreaterThan(38);
    const angle =
      (Number(selected.style.transform.match(/rotate\(([^)]+)deg\)/)![1]) * Math.PI) / 180;
    const move = (distance: number) => ({
      pointerId: 1,
      clientX: 225 + Math.sin(angle) * distance,
      clientY: 68 - Math.cos(angle) * distance,
    });
    fireEvent.pointerMove(view, move(20));
    expect(document.querySelector('[data-draw-pull]')).not.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.pointerUp(view, move(70));
    expect(confirm).toHaveBeenCalledExactlyOnceWith(index);
    expect(document.querySelector('[data-draw-pull], [data-draw-flight]')).toBeNull();
    expect(screen.getByRole('button', { name: `牌堆第 ${index + 1} 张，已抽取` })).toBeDisabled();
    expect(screen.getByText('已抽 1 / 3')).toBeInTheDocument();
  });

  it('同一批连续拨牌、拖出和松手不会因旧回调丢失抽牌', () => {
    render(<Harness />);
    const region = screen.getByRole('region', { name: '半圆环牌堆' });
    Object.defineProperty(region, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 390, height: 230 }) as DOMRect,
    });
    const view = region.parentElement!;
    fireEvent.pointerDown(screen.getByRole('button', { name: '牌堆第 39 张，未翻开' }), {
      pointerId: 1,
      clientX: 195,
      clientY: 65,
    });
    act(() => {
      view.dispatchEvent(
        new TestPointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: 225,
          clientY: 68,
        }),
      );
      view.dispatchEvent(
        new TestPointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: 240,
          clientY: -5,
        }),
      );
      view.dispatchEvent(
        new TestPointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          clientX: 240,
          clientY: -5,
        }),
      );
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toBeGreaterThan(38);
  });

  it('同步连续点击只确认一次，下一次预选后可正常继续', () => {
    render(<Harness spreadId="three-card" />);
    fireEvent.click(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' }));
    const button = screen.getByRole('button', { name: '牌堆第 1 张，未翻开' });
    act(() => {
      button.click();
      button.click();
    });
    expect(confirm).toHaveBeenCalledExactlyOnceWith(0);
    select(1);
    expect(confirm.mock.calls.map((call) => call[0])).toEqual([0, 1]);
    expect(screen.getByText('已抽 2 / 3')).toBeInTheDocument();
  });

  it('撤回最后抽取的牌并归还原索引，不影响更早的选择', () => {
    render(<Harness spreadId="three-card" />);
    select(6);
    select(30);
    fireEvent.click(menuAction('撤回上一张'));
    expect(screen.getByText('已抽 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('下一张 · 现在')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '牌堆第 7 张，已抽取' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '牌堆第 31 张，未翻开' })).toBeEnabled();
    select(30);
    expect(confirm.mock.calls.map((call) => call[0])).toEqual([6, 30, 30]);
  });

  it('已选齐的页面重新挂载不会跳转，可返回揭牌或撤回', () => {
    render(<Harness spreadId="three-card" initial={[6, 12, 30]} />);
    expect(reveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回揭牌' }));
    expect(reveal).toHaveBeenCalledTimes(1);
    fireEvent.click(menuAction('撤回上一张'));
    expect(screen.getByText('已抽 2 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '抽取这张' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回揭牌' })).not.toBeInTheDocument();
  });
});

describe('抽牌完成动画', () => {
  function animation(duration = '950ms') {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ finished, cancel }));
    const original = HTMLElement.prototype.animate;
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        transform: 'none',
        getPropertyValue: (name: string) =>
          name === '--dur-veil' ? duration : name === '--dur-quick' ? '200ms' : 'ease-in-out',
      })),
    );
    return {
      finish,
      cancel,
      animate,
      restore: () => {
        if (original)
          Object.defineProperty(HTMLElement.prototype, 'animate', {
            configurable: true,
            value: original,
          });
        else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      },
    };
  }

  it.each(['950ms', '0.95s'])('主题时长 %s 均转换为可见的 950ms 动画', async (duration) => {
    const motion = animation(duration);
    try {
      render(<Harness />);
      select(0);
      const [, options] = motion.animate.mock.calls[0] as unknown as [
        Keyframe[],
        KeyframeAnimationOptions,
      ];
      expect(options.duration).toBe(950);
      expect(confirm).not.toHaveBeenCalled();
      await act(async () => {
        motion.finish();
      });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      motion.restore();
    }
  });

  it('展示牌背后才计数，动画期间重复点击和修改均不能打断抽牌', async () => {
    const motion = animation();
    try {
      render(<Harness spreadId="three-card" />);
      select(0);
      expect(document.querySelector('[data-draw-flight]')).not.toBeNull();
      expect(confirm).not.toHaveBeenCalled();
      expect(screen.getByText('已抽 0 / 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '牌堆第 2 张，未翻开' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: '牌堆第 1 张，未翻开' }));
      expect(menuAction('修改问题')).toBeDisabled();
      await act(async () => {
        motion.finish();
      });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(0);
      expect(document.querySelector('[data-draw-flight]')).toBeNull();
      expect(screen.getByText('已抽 1 / 3')).toBeInTheDocument();
    } finally {
      motion.restore();
    }
  });

  it('最后一张完成动画后才进入可揭牌状态', async () => {
    const motion = animation();
    try {
      render(<Harness />);
      select(4);
      expect(screen.queryByRole('button', { name: '返回揭牌' })).not.toBeInTheDocument();
      await act(async () => {
        motion.finish();
      });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(4);
      expect(screen.getByRole('button', { name: '返回揭牌' })).toBeEnabled();
    } finally {
      motion.restore();
    }
  });

  it('离开页面取消动画，完成信号不能再提交旧抽牌', async () => {
    const motion = animation();
    try {
      const { unmount } = render(<Harness />);
      select(2);
      unmount();
      await act(async () => {
        motion.finish();
      });
      expect(motion.cancel).toHaveBeenCalledOnce();
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      motion.restore();
    }
  });

  it('减少动态效果时只做定点淡入淡出且仍可完成', async () => {
    const motion = animation();
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    try {
      render(<Harness />);
      select(1);
      const [frames, options] = motion.animate.mock.calls[0] as unknown as [
        Keyframe[],
        KeyframeAnimationOptions,
      ];
      expect(new Set(frames.map((frame) => frame.transform)).size).toBe(1);
      expect(options.duration).toBe(200);
      await act(async () => {
        motion.finish();
      });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      motion.restore();
    }
  });

  it('调整窗口提前结束动画，与稍后结束信号不会重复提交', async () => {
    const motion = animation();
    try {
      render(<Harness />);
      select(3);
      fireEvent(window, new Event('resize'));
      await act(async () => {
        motion.finish();
      });
      expect(confirm).toHaveBeenCalledExactlyOnceWith(3);
    } finally {
      motion.restore();
    }
  });
});
