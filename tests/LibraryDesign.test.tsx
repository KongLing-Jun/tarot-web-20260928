import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LibraryPage from '@/app/library/page';
import { CardDetail } from '@/components/cards/CardDetail';
import CardMeaningPage, { generateMetadata, generateStaticParams } from '@/app/library/[id]/page';
import { allCards } from '@/lib/tarot/cards';

vi.mock('@/components/session/UserSession', () => ({
  useUser: () => ({
    user: null,
    loading: false,
    error: '',
    retryLogin: vi.fn(),
    setFavorite: vi.fn(),
  }),
}));
afterEach(cleanup);
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

it('图文索引在打开详情前呈现真实关键词与牌义摘要', () => {
  render(<LibraryPage />);
  const brand = screen.getByText('月映卡语');
  expect(brand).toBeVisible();
  expect(brand).toHaveClass('brand-name');
  expect(brand.parentElement).toHaveTextContent(/^共 78 张牌 · 月映卡语$/);
  const card = allCards[0];
  const entry = screen.getByRole('link', { name: `查看${card.nameCn}` });
  expect(within(entry).getByText(card.keywords.upright.slice(0, 3).join(' · '))).toBeVisible();
  expect(within(entry).getByText(card.meaning.upright)).toBeVisible();
  expect(within(entry).getByText('查看牌义')).toBeVisible();
  expect(entry).toHaveAttribute('href', `/library/${card.id}`);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('详情牌面不可用时保留名称与完整牌义', () => {
  const card = allCards[0];
  render(<CardDetail card={card} />);
  const brand = screen.getByText('月映卡语');
  expect(brand).toBeVisible();
  expect(brand).toHaveClass('brand-name');
  expect(brand.parentElement).toHaveTextContent(/^月映卡语$/);
  fireEvent.error(screen.getByRole('img', { name: card.name }));
  expect(screen.getByText('牌面暂时无法加载')).toBeVisible();
  expect(screen.getByText(card.meaning.upright)).toBeVisible();
  expect(screen.getByText(card.meaning.reversed)).toBeVisible();
});

it('独立详情路由支持直接访问，提供完整牌义和返回链接', async () => {
  const card = allCards[2];
  const params = Promise.resolve({ id: card.id });
  render(await CardMeaningPage({ params }));
  expect(screen.getByRole('heading', { name: card.nameCn, level: 1 })).toBeVisible();
  expect(screen.getByRole('heading', { name: '正位', level: 2 })).toBeVisible();
  expect(screen.getByRole('heading', { name: '逆位', level: 2 })).toBeVisible();
  expect(screen.getByRole('link', { name: '返回牌典' })).toHaveAttribute('href', '/library');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(document.body.style.overflow).not.toBe('hidden');
  expect((await generateMetadata({ params })).title).toBe(`${card.nameCn} · 牌义 | 月映卡语`);
  expect(generateStaticParams()).toEqual(allCards.map((card) => ({ id: card.id })));
});

it('无效的牌 ID 返回 404', async () => {
  await expect(
    CardMeaningPage({ params: Promise.resolve({ id: 'missing-card' }) }),
  ).rejects.toThrow('NEXT_NOT_FOUND');
});
