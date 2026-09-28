import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CardBack } from '@/components/cards/CardBack';
import { CompactCardBack } from '@/components/cards/CompactCardBack';

afterEach(cleanup);

it('阶段卡背显式启用，默认揭牌卡背不变', () => {
  const { container, rerender } = render(<CardBack />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('Tarot');
  rerender(<CardBack appearance="ritual" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    '/brand/spread-theme/card-back.webp',
  );
  expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
  rerender(<CardBack />);
  expect(container.querySelector('img')).toBeNull();
});

it('紧凑卡背可使用同一主题，舞台与拖出浮层没有不同卡面', () => {
  const { container } = render(<CompactCardBack appearance="ritual" width={40} height={62.4} />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    '/brand/spread-theme/card-back.webp',
  );
});
