import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RitualMoreMenu } from '@/components/drawing/RitualMoreMenu';

afterEach(cleanup);

it('触摸时先发生无目标失焦，随后点击仍执行全部揭牌一次', () => {
  const reveal = vi.fn();
  render(
    <RitualMoreMenu
      label="揭牌"
      actions={[{ label: '全部揭牌', icon: 'cards', onSelect: reveal }]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '揭牌更多操作' }));
  const item = screen.getByRole('menuitem', { name: '全部揭牌' });
  fireEvent.pointerDown(item, { pointerType: 'touch' });
  fireEvent.blur(item, { relatedTarget: null });
  fireEvent.pointerUp(item, { pointerType: 'touch' });
  expect(fireEvent.mouseDown(item)).toBe(false); // 阻止 Safari 将焦点转给菜单外的父容器。
  fireEvent.click(item);
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('实际移到外部的键盘焦点和外部触摸仍关闭菜单', () => {
  render(
    <>
      <RitualMoreMenu
        label="揭牌"
        actions={[{ label: '全部揭牌', icon: 'cards', onSelect: vi.fn() }]}
      />
      <button>外部</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: '揭牌更多操作' });
  fireEvent.click(trigger);
  fireEvent.focusIn(screen.getByRole('button', { name: '外部' }));
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body, { pointerType: 'touch' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});
