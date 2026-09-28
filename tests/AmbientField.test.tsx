import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmbientField } from '@/components/effects/AmbientField';

describe('AmbientField lifecycle', () => {
  let reduced: MediaQueryList;
  let touch: MediaQueryList;
  let context: CanvasRenderingContext2D;
  let frames: Map<number, FrameRequestCallback>;

  function runFrame(time: number): void {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }

  function media(matches: boolean): MediaQueryList {
    return Object.assign(new EventTarget(), { matches }) as MediaQueryList;
  }

  function setVisibility(value: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    fireEvent(document, new Event('visibilitychange'));
  }

  beforeEach(() => {
    reduced = media(false);
    touch = media(false);
    vi.stubGlobal('React', React);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => (query.includes('reduced-motion') ? reduced : touch)),
    );
    frames = new Map();
    let nextFrameId = 1;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => frames.delete(id)),
    );
    context = {
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    setVisibility('visible');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setVisibility('visible');
  });

  it.each([false, true])(
    'pauses hidden pages and resumes the atmosphere (touch: %s)',
    (isTouch) => {
      Object.assign(touch, { matches: isTouch });
      setVisibility('hidden');
      const { container } = render(<AmbientField />);
      expect(requestAnimationFrame).not.toHaveBeenCalled();
      expect(container.querySelector('.ambient-field')).toHaveAttribute('data-paused', 'true');
      setVisibility('visible');
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      expect(container.querySelector('.ambient-field')).toHaveAttribute('data-paused', 'false');
      setVisibility('hidden');
      expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
      runFrame(100);
      expect(context.arc).not.toHaveBeenCalled();
    },
  );

  it('animates touch stars without driving the pointer-following aura', () => {
    Object.assign(touch, { matches: true });
    const { container } = render(<AmbientField />);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    for (const pointerType of ['touch', 'mouse']) {
      const event = Object.assign(new Event('pointermove'), {
        pointerType,
        clientX: 20,
        clientY: 30,
      });
      fireEvent(window, event);
    }
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    const aura = container.querySelector('.candle-aura') as HTMLElement;
    expect(aura.style.getPropertyValue('--mx')).toBe('50%');
    expect(aura.style.getPropertyValue('--my')).toBe('32%');

    runFrame(100);
    expect(context.arc).toHaveBeenCalled();
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);

    fireEvent(window, new Event('resize'));
    runFrame(134);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(1);
  });

  it('moves touch stars upward at about 30 fps using elapsed time and caps long frame gaps', () => {
    Object.assign(touch, { matches: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<AmbientField />);

    runFrame(100);
    const firstY = vi.mocked(context.arc).mock.calls[0][1];
    vi.mocked(context.arc).mockClear();

    runFrame(116);
    runFrame(132);
    expect(context.arc).not.toHaveBeenCalled();
    expect(context.clearRect).toHaveBeenCalledTimes(1);

    runFrame(134);
    const secondY = vi.mocked(context.arc).mock.calls[0][1];
    expect(secondY).toBeLessThan(firstY);
    expect(context.clearRect).toHaveBeenCalledTimes(2);
    vi.mocked(context.arc).mockClear();

    runFrame(150);
    expect(context.arc).not.toHaveBeenCalled();
    runFrame(168);
    const thirdY = vi.mocked(context.arc).mock.calls[0][1];
    expect(thirdY).toBeLessThan(secondY);
    expect(secondY - thirdY).toBeCloseTo(firstY - secondY);
    vi.mocked(context.arc).mockClear();

    runFrame(1168);
    const fourthY = vi.mocked(context.arc).mock.calls[0][1];
    expect(fourthY).toBeLessThan(thirdY);
    expect((thirdY - fourthY) / (secondY - thirdY)).toBeCloseTo(50 / 34);
    expect(context.clearRect).toHaveBeenCalledTimes(4);
    expect(frames.size).toBe(1);
  });

  it.each([false, true])(
    'keeps reduced-motion stars static and redraws only when visible (touch: %s)',
    (isTouch) => {
      Object.assign(touch, { matches: isTouch });
      Object.assign(reduced, { matches: true });
      setVisibility('hidden');
      render(<AmbientField />);
      expect(context.clearRect).not.toHaveBeenCalled();
      expect(requestAnimationFrame).not.toHaveBeenCalled();

      setVisibility('visible');
      expect(context.arc).toHaveBeenCalled();
      expect(context.clearRect).toHaveBeenCalledTimes(1);

      setVisibility('hidden');
      fireEvent(window, new Event('resize'));
      expect(context.clearRect).toHaveBeenCalledTimes(1);
      setVisibility('visible');
      expect(context.clearRect).toHaveBeenCalledTimes(2);
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'responds to reduced motion changes without restarting while hidden (touch: %s)',
    (isTouch) => {
      Object.assign(touch, { matches: isTouch });
      render(<AmbientField />);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      Object.assign(reduced, { matches: true });
      reduced.dispatchEvent(new Event('change'));
      expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
      expect(context.arc).toHaveBeenCalled();
      setVisibility('hidden');
      Object.assign(reduced, { matches: false });
      reduced.dispatchEvent(new Event('change'));
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      setVisibility('visible');
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    },
  );
});
