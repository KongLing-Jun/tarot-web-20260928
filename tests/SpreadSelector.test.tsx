import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpreadSelector } from '@/components/drawing/SpreadSelector';
import { getDefaultSpread, spreads } from '@/lib/tarot/spreads';
import { getSpreadGuidance, getSpreadPositionGuidance } from '@/lib/tarot/spread-guidance';
import { generalSpreads } from '@/lib/readingEntry';
import { TestPointerEvent } from './helpers/pointer-event';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  vi.stubGlobal('getComputedStyle', () => ({
    fontSize: '16px',
    getPropertyValue: (name: string) =>
      ({
        '--card-step': '0.94',
        '--dur-soft': '450ms',
        '--dur-quick': '200ms',
        '--confirm-duration': '350ms',
      })[name] ?? '',
  }));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ initial = getDefaultSpread(), onSelect = vi.fn() } = {}) {
  const [spread, setSpread] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <SpreadSelector
        selectedSpread={spread}
        onSelect={(value) => {
          onSelect(value);
          setSpread(value);
        }}
        onInteractionChange={setBusy}
      />
      <button disabled={busy}>就此落阵</button>
    </>
  );
}
const stage = () => screen.getByRole('region', { name: '选择牌阵' });
const selected = () => within(stage()).getByRole('button', { pressed: true });

it.each(spreads)('$nameCn 在确认前展示适用场景、必要背景、示例和边界', (spread) => {
  render(<Harness initial={spread} />);
  const guidance = getSpreadGuidance(spread.id)!;
  const panel = screen.getByRole('region', { name: `${spread.nameCn}适用场景` });
  expect(selected()).toHaveTextContent(guidance.summary);
  expect(panel).toHaveTextContent(guidance.suitableFor);
  expect(panel).toHaveTextContent(guidance.requiredContext);
  expect(panel).toHaveTextContent(guidance.exampleQuestion);
  expect(panel).toHaveTextContent(guidance.boundary);
  expect(screen.getByText(/牌数代表观察角度，不代表准确程度。/)).toBeVisible();
});

it('切换牌阵同时更新说明，不保留上一个牌阵的条件', () => {
  render(<Harness initial={spreads[0]} />);
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  finish();
  expect(screen.queryByRole('region', { name: '单张牌适用场景' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: '三张牌阵适用场景' })).toHaveTextContent(
    getSpreadGuidance('three-card')!.requiredContext,
  );
});

it.each(spreads)('$nameCn 展开的牌位说明使用象征视角，不承诺现实事实', (spread) => {
  render(<Harness initial={spread} />);
  fireEvent.click(screen.getByRole('button', { name: '查看牌位说明' }));
  const panel = screen.getByRole('region', { name: `${spread.nameCn}牌位说明` });
  for (const position of spread.positions) {
    expect(panel).toHaveTextContent(getSpreadPositionGuidance(position.id)!);
    expect(panel).not.toHaveTextContent(position.description);
  }
});
function finish() {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'transform' });
  fireEvent(selected(), event);
}
function drag(dx: number, end: 'up' | 'cancel' = 'up') {
  const element = stage();
  element.setPointerCapture = vi.fn();
  fireEvent.pointerDown(element, { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(element, { pointerId: 1, clientX: 200 + dx, clientY: 100 });
  if (end === 'up') fireEvent.pointerUp(element, { pointerId: 1, clientX: 200 + dx, clientY: 100 });
  else fireEvent.pointerCancel(element, { pointerId: 1 });
}

it('默认三张牌阵居中，停稳才回传原对象并解锁确认', () => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  expect(selected()).toHaveAttribute('data-spread-id', 'three-card');
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  expect(screen.getByRole('button', { name: '就此落阵' })).toBeDisabled();
  expect(onSelect).not.toHaveBeenCalled();
  // Ignore rapid input while the previous card is settling.
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  finish();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(spreads[2]);
  expect(selected()).toHaveAttribute('data-spread-id', 'two-options');
  expect(screen.getByRole('button', { name: '就此落阵' })).toBeEnabled();
});

it('六种牌阵依序循环，第一张向前回到第六张', () => {
  const onSelect = vi.fn();
  render(<Harness initial={spreads[0]} onSelect={onSelect} />);
  for (let i = 1; i <= spreads.length; i++) {
    fireEvent.keyDown(stage(), { key: 'ArrowRight' });
    finish();
    expect(onSelect).toHaveBeenLastCalledWith(spreads[i % spreads.length]);
  }
  fireEvent.keyDown(stage(), { key: 'ArrowLeft' });
  finish();
  expect(onSelect).toHaveBeenLastCalledWith(spreads[5]);
  expect(screen.getByRole('status')).toHaveTextContent('6 / 6');
});

it('侧卡点击与方向键切换，中央点击不重复改变选择', () => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  fireEvent.click(selected());
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(within(stage()).getByRole('button', { name: /单张牌/ }));
  finish();
  expect(selected()).toHaveAttribute('data-spread-id', 'single');
  stage().focus();
  fireEvent.keyDown(stage(), { key: 'ArrowLeft' });
  finish();
  expect(selected()).toHaveAttribute('data-spread-id', 'celtic-cross');
  expect(stage()).toHaveFocus();
});

it('轻点中央牌阵确认，滑动松手和过渡中的点击不能误确认', () => {
  const onConfirm = vi.fn();
  const onSelect = vi.fn();
  render(<SpreadSelector selectedSpread={spreads[1]} onSelect={onSelect} onConfirm={onConfirm} />);
  fireEvent.click(selected());
  expect(onConfirm).not.toHaveBeenCalled();
  expect(stage()).toHaveAttribute('data-phase', 'confirming');
  fireEvent.click(selected());
  act(() => vi.advanceTimersByTime(350));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  drag(-100);
  fireEvent.click(selected());
  expect(onConfirm).toHaveBeenCalledTimes(1);
  finish();
  fireEvent.click(selected(), { detail: 1 });
  expect(onConfirm).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(selected(), { pointerId: 2, clientX: 200, clientY: 100 });
  fireEvent.pointerUp(selected(), { pointerId: 2, clientX: 200, clientY: 100 });
  fireEvent.click(selected(), { detail: 1 });
  act(() => vi.advanceTimersByTime(350));
  expect(onConfirm).toHaveBeenCalledTimes(2);
});

it('纵向滚动后的点击不确认，键盘激活仍可确认', () => {
  const onConfirm = vi.fn();
  render(<SpreadSelector selectedSpread={spreads[1]} onSelect={vi.fn()} onConfirm={onConfirm} />);
  fireEvent.pointerDown(selected(), { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(selected(), { pointerId: 1, clientX: 201, clientY: 180 });
  fireEvent.pointerUp(selected(), { pointerId: 1, clientX: 201, clientY: 180 });
  fireEvent.click(selected(), { detail: 1 });
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(selected(), { detail: 0 });
  act(() => vi.advanceTimersByTime(350));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it.each([-100, -900])('横拖 %s 像素只前进一张，拖动后的 click 不再切牌', (dx) => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  drag(dx);
  expect(screen.getByRole('button', { name: '就此落阵' })).toBeDisabled();
  finish();
  fireEvent.click(within(stage()).getByRole('button', { name: /关系牌阵/ }), { detail: 1 });
  act(() => vi.runAllTimers());
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(spreads[2]);
});

it.each(['short', 'cancel', 'lost'] as const)('%s 手势回弹，不改变选择并恢复确认', (kind) => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  if (kind === 'lost') {
    stage().setPointerCapture = vi.fn();
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.lostPointerCapture(stage(), { pointerId: 1 });
  } else drag(kind === 'short' ? -10 : -100, kind === 'cancel' ? 'cancel' : 'up');
  finish();
  expect(onSelect).not.toHaveBeenCalled();
  expect(selected()).toHaveAttribute('data-spread-id', 'three-card');
  expect(screen.getByRole('button', { name: '就此落阵' })).toBeEnabled();
});

it('使用抬手的最终坐标判断是否越过切换阈值', () => {
  render(<Harness />);
  stage().setPointerCapture = vi.fn();
  fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 180, clientY: 100 });
  fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 90, clientY: 100 });
  finish();
  expect(selected()).toHaveAttribute('data-spread-id', 'two-options');
});

it('触屏从子卡牌转移隐式捕获时，不把子元素的 lostpointercapture 当作手势取消', () => {
  render(<Harness />);
  stage().setPointerCapture = vi.fn();
  fireEvent.pointerDown(selected(), { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(selected(), { pointerId: 1, clientX: 180, clientY: 100 });
  fireEvent.lostPointerCapture(selected(), { pointerId: 1 });
  expect(stage()).toHaveAttribute('data-phase', 'dragging');
  fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 90, clientY: 100 });
  fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 90, clientY: 100 });
  finish();
  expect(selected()).toHaveAttribute('data-spread-id', 'two-options');
});

it('纵向手势和纵向滚轮不切牌、不阻止默认滚动', () => {
  render(<Harness />);
  fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 202, clientY: 200 });
  fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 202, clientY: 200 });
  const wheel = new WheelEvent('wheel', { deltaY: 200, cancelable: true });
  fireEvent(stage(), wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(stage()).toHaveAttribute('data-phase', 'idle');
});

it('鼠标按下后移出舞台而未拖动，不会阻塞之后的切换', () => {
  render(<Harness />);
  fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 1, clientY: 100 });
  fireEvent.pointerLeave(stage(), { pointerId: 1, clientX: -1, clientY: 100 });
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  finish();
  expect(selected()).toHaveAttribute('data-spread-id', 'two-options');
});

it('横向滚轮每次手势只切一张，新的手势可以继续', () => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  fireEvent.wheel(stage(), { deltaX: 100 });
  finish();
  fireEvent.wheel(stage(), { deltaX: 100 });
  expect(onSelect).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(200));
  fireEvent.wheel(stage(), { deltaX: 100 });
  finish();
  expect(onSelect).toHaveBeenLastCalledWith(spreads[3]);
});

it('拖动中外部改选并切回，不恢复过期手势或延迟回调', () => {
  const onSelect = vi.fn();
  const busy = vi.fn();
  const { rerender } = render(
    <SpreadSelector selectedSpread={spreads[1]} onSelect={onSelect} onInteractionChange={busy} />,
  );
  stage().setPointerCapture = vi.fn();
  fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 100, clientY: 100 });
  rerender(
    <SpreadSelector selectedSpread={spreads[0]} onSelect={onSelect} onInteractionChange={busy} />,
  );
  rerender(
    <SpreadSelector selectedSpread={spreads[1]} onSelect={onSelect} onInteractionChange={busy} />,
  );
  expect(stage()).toHaveAttribute('data-phase', 'idle');
  expect(selected().parentElement!.style.getPropertyValue('--position')).toBe('0');
  expect(busy).toHaveBeenLastCalledWith(false);
  act(() => vi.runAllTimers());
  expect(onSelect).not.toHaveBeenCalled();
});

it('没有 transitionend 时按主题时长解锁，卸载取消回调', () => {
  const onSelect = vi.fn();
  const { unmount } = render(<Harness onSelect={onSelect} />);
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  act(() => vi.runAllTimers());
  expect(selected()).toHaveAttribute('data-spread-id', 'two-options');
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  unmount();
  act(() => vi.runAllTimers());
  expect(onSelect).toHaveBeenCalledTimes(1);
});

it('减少动态效果时无须等待过渡事件', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  render(<Harness />);
  fireEvent.keyDown(stage(), { key: 'ArrowRight' });
  act(() => vi.advanceTimersByTime(0));
  expect(selected()).toHaveAttribute('data-spread-id', 'two-options');
  expect(screen.getByRole('button', { name: '就此落阵' })).toBeEnabled();
});

it.each(spreads)('$nameCn 示意图的牌数、编号、牌位名与数据一致', (spread) => {
  render(<Harness initial={spread} />);
  const diagram = within(selected()).getByRole('img');
  const positions = diagram.querySelectorAll('g');
  expect(positions).toHaveLength(spread.positions.length);
  positions.forEach((position, index) => {
    expect(selected().querySelector(`[data-position-label="${index + 1}"]`)).toHaveTextContent(
      spread.positions.length <= 3 ? spread.positions[index].nameCn : String(index + 1),
    );
    expect(position.querySelector('image')).toHaveAttribute(
      'href',
      '/brand/spread-theme/card-back.webp',
    );
    expect(position.querySelector('title')).toHaveTextContent(spread.positions[index].nameCn);
  });
  if (spread.id === 'celtic-cross') {
    expect(positions[0].getAttribute('transform')).toBe(positions[1].getAttribute('transform'));
    expect(positions[1].querySelector('image')).toHaveAttribute('transform', 'rotate(90)');
    expect(diagram).toHaveAttribute('viewBox', '0 -8 240 162');
    expect(diagram.querySelectorAll('line, path')).toHaveLength(0);
    const cards = [...positions].map((position, index) => {
      const [x, y] = position
        .getAttribute('transform')!
        .match(/[\d.]+/g)!
        .map(Number);
      const image = position.querySelector('image')!;
      const width = Number(image.getAttribute('width'));
      const height = Number(image.getAttribute('height'));
      expect(width).toBe(22);
      expect(height / width).toBe(7 / 4);
      if (index !== 1) expect(image).not.toHaveAttribute('transform');
      return { x, y, width: index === 1 ? height : width, height: index === 1 ? width : height };
    });
    cards.forEach((card, index) => {
      const label = selected().querySelector(`[data-position-label="${index + 1}"]`) as HTMLElement;
      const anchorX = (parseFloat(label.style.left) / 100) * 240;
      if ([0, 2, 4, 5].includes(index)) {
        expect(anchorX).toBeCloseTo(card.x - card.width / 2);
        expect(label.style.transform).toBe('translate(calc(-100% - 4px), -50%)');
      } else {
        expect(anchorX).toBeCloseTo(card.x + card.width / 2);
        expect(label.style.transform).toBe('translate(4px, -50%)');
      }
      for (let otherIndex = index + 1; otherIndex < cards.length; otherIndex++) {
        if (index === 0 && otherIndex === 1) continue; // The central cross intentionally overlaps.
        const other = cards[otherIndex];
        expect(
          Math.abs(card.x - other.x) >= (card.width + other.width) / 2 ||
            Math.abs(card.y - other.y) >= (card.height + other.height) / 2,
        ).toBe(true);
      }
    });
  }
});

it('确认过渡期间外部改选或卸载会取消进入洗牌', () => {
  const onConfirm = vi.fn();
  const { rerender, unmount } = render(
    <SpreadSelector selectedSpread={spreads[1]} onSelect={vi.fn()} onConfirm={onConfirm} />,
  );
  fireEvent.click(selected());
  rerender(<SpreadSelector selectedSpread={spreads[2]} onSelect={vi.fn()} onConfirm={onConfirm} />);
  act(() => vi.runAllTimers());
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(selected());
  unmount();
  act(() => vi.runAllTimers());
  expect(onConfirm).not.toHaveBeenCalled();
});
it('减少动态效果时确认不额外等待动画', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const onConfirm = vi.fn();
  render(<SpreadSelector selectedSpread={spreads[1]} onSelect={vi.fn()} onConfirm={onConfirm} />);
  fireEvent.click(selected());
  act(() => vi.advanceTimersByTime(0));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it('四个通用选项完整循环，五个视觉槽位无重复 key 或额外焦点', () => {
  const errors = vi.spyOn(console, 'error');
  function General() {
    const [spread, setSpread] = useState(generalSpreads[0]);
    return <SpreadSelector choices={generalSpreads} selectedSpread={spread} onSelect={setSpread} />;
  }
  render(<General />);
  for (const id of ['three-card', 'timeline', 'celtic-cross', 'single']) {
    fireEvent.keyDown(stage(), { key: 'ArrowRight' });
    finish();
    expect(selected()).toHaveAttribute('data-spread-id', id);
    expect(stage().querySelectorAll('button[data-spread-id][tabindex="0"]')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('/ 4');
  }
  expect(errors).not.toHaveBeenCalled();
});

it('空选择列表不允许确认或崩溃', () => {
  render(
    <SpreadSelector
      choices={[]}
      selectedSpread={spreads[0]}
      onSelect={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('暂无可选牌阵');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
