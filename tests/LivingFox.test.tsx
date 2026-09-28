import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LivingFox } from '@/components/effects/LivingFox';
import { BlinkingEyes } from '@/components/effects/BlinkingEyes';

let motion: MediaQueryList;
let frames: Map<number, FrameRequestCallback>;
let timestamp: number;

function advanceTo(time: number) {
  while (timestamp < time) {
    timestamp += 20;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(timestamp));
  }
}

beforeEach(() => {
  motion = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  frames = new Map();
  timestamp = 0;
  let frameId = 0;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => motion),
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the transparent original image visible and blinks without a canvas or GPU context', () => {
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const { container } = render(<LivingFox />);
  const image = container.querySelector('img')!;
  const [far, near] = container.querySelectorAll('svg rect');
  expect(image).toHaveAttribute('src', '/brand/miying-fox.webp');
  expect(image).toBeVisible();
  expect(container.querySelector('canvas')).toBeNull();
  expect(far).toHaveAttribute('height', '0');

  advanceTo(2300);
  expect(Number(far.getAttribute('height'))).toBeGreaterThan(0);
  expect(Number(near.getAttribute('height'))).toBeGreaterThan(0);
  advanceTo(2400);
  expect(far).toHaveAttribute('height', '49');
  expect(near).toHaveAttribute('height', '43');
  advanceTo(2780);
  expect(far).toHaveAttribute('height', '0');
  expect(near).toHaveAttribute('height', '0');
  expect(image).toBeVisible();
  expect(getContext).not.toHaveBeenCalled();
});

it('opens the eyes and stops animation when reduced motion is enabled', () => {
  const { container, unmount } = render(<LivingFox />);
  advanceTo(2400);
  const lids = container.querySelectorAll('svg rect');
  expect(lids[0]).toHaveAttribute('height', '49');
  Object.assign(motion, { matches: true });
  motion.dispatchEvent(new Event('change'));
  lids.forEach((lid) => expect(lid).toHaveAttribute('height', '0'));
  expect(frames.size).toBe(0);
  unmount();
  expect(frames.size).toBe(0);
});

it('uses the question illustration coordinates with the same slow blink timing', () => {
  const { container } = render(<BlinkingEyes variant="question" />);
  expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 1200 660');
  expect(container.querySelector('image')).toHaveAttribute(
    'href',
    '/brand/question-fox-eyelids.svg',
  );
  const [far, near] = container.querySelectorAll('rect');
  advanceTo(2400);
  expect(far).toHaveAttribute('height', '67');
  expect(near).toHaveAttribute('height', '47');
  advanceTo(2780);
  expect(far).toHaveAttribute('height', '0');
  expect(near).toHaveAttribute('height', '0');
});
