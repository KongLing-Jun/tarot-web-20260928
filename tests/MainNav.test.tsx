import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MainNav } from '@/components/layout/MainNav';

afterEach(cleanup);

it('连续切换六个入口和手动占卜时只有所属栏目选中，导航顺序与内容保持一致', () => {
  const entries = [
    ['/', '首页'],
    ['/agent', '对话'],
    ['/daily', '今日'],
    ['/library', '牌典'],
    ['/history', '轨迹'],
    ['/profile', '我的'],
  ];
  const { rerender } = render(<MainNav activePath="/" />);
  for (const [path, label] of [
    ...entries,
    ['/agent', '对话'],
    ['/reading', '对话'],
    entries[2],
    ['/reading', '对话'],
    ['/agent', '对话'],
    entries[0],
    ['/reading/extra'],
    ['/readings'],
    ['/reading/'],
  ]) {
    rerender(<MainNav activePath={path} />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(entries.map(([href]) => href));
    expect(links.map((link) => link.textContent)).toEqual(entries.map(([, name]) => name));
    expect(links.filter((link) => link.getAttribute('aria-current') === 'page')).toEqual(
      label ? [screen.getByRole('link', { name: label })] : [],
    );
  }
});
