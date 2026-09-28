import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Home from '@/app/page';

vi.mock('@/components/daily/DailyCardPreview', () => ({
  DailyCardPreview: () => <div>每日牌预览</div>,
}));
afterEach(cleanup);

it('首页主入口直达对话，手动选阵为次入口且先于每日牌预览', () => {
  render(<Home />);
  expect(screen.getByRole('heading', { name: '月映卡语', level: 1 })).toHaveTextContent('月映卡语');
  expect(screen.getByText('Moonlit Tarot')).toBeVisible();
  const brand = screen.getByText('月映卡语');
  expect(brand).toBeVisible();
  expect(brand).toHaveClass('brand-name');
  expect(brand.parentElement).toHaveTextContent(/^月映卡语 · MOONLIT$/);
  const main = screen.getByRole('link', { name: /说说正在困扰你的事/ });
  expect(main).toHaveAttribute('href', '/agent?new=1');
  const manual = screen.getByRole('link', { name: '自己选择牌阵' });
  expect(manual).toHaveAttribute('href', '/reading');
  expect(main).toHaveTextContent(/^说说正在困扰你的事$/);
  expect(manual).toHaveTextContent(/^自己选择牌阵$/);
  expect(
    manual.compareDocumentPosition(screen.getByText('每日牌预览')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: '开始探索' })).not.toBeInTheDocument();
});

it('场景入口位于每日牌之前，首页不展示通用牌数选择器', () => {
  render(<Home />);
  for (const [title, id, label] of [
    ['关系走向', 'relationship', '关系牌阵 · 5 张'],
    ['二选一', 'two-options', '二择一牌阵 · 5 张'],
    ['事情进展', 'progress', '三张牌阵 · 3 张'],
    ['临场准备', 'preparation', '单张牌 · 1 张'],
    ['反复卡住', 'stuck', '时间之流 · 5 张'],
  ]) {
    const link = screen.getByRole('link', { name: new RegExp(title) });
    expect(link).toHaveAttribute('href', `/reading?scene=${id}`);
    expect(link).toHaveTextContent(label);
    expect(
      link.compareDocumentPosition(screen.getByText('每日牌预览')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  expect(screen.queryByRole('region', { name: '选择牌阵' })).not.toBeInTheDocument();
});
