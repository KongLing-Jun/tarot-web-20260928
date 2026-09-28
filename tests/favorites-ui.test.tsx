vi.mock('@/lib/agentSessionStorage', () => ({
  loadAgentSession: async () => ({ tasks: [], revision: 0 }),
  saveAgentSession: vi.fn(),
}));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryPage from '@/app/library/page';
import ProfilePage from '@/app/profile/page';
import { UserSession } from '@/components/session/UserSession';
import { CardDetail } from '@/components/cards/CardDetail';
import { allCards } from '@/lib/tarot/cards';

const navigation = vi.hoisted(() => ({ pathname: '/library' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/layout/MainNav', () => ({ MainNav: () => null }));
vi.mock('@/lib/auth/environment', () => ({ isWechatMiniProgram: async () => true }));
let saved: Set<string>;
let fetchMock: ReturnType<typeof vi.fn>;
const card = allCards[0];

beforeEach(() => {
  navigation.pathname = '/library';
  saved = new Set();
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/auth/me')
      return Response.json({
        user: {
          nickname: '收藏用户',
          avatarUrl: '/avatars/default.svg',
          createdAt: '2026-09-09',
          readingCount: 0,
          favoriteCardIds: [...saved],
        },
      });
    const cardId = decodeURIComponent(url.split('/').pop()!);
    if (options?.method === 'PUT') saved.add(cardId);
    if (options?.method === 'DELETE') saved.delete(cardId);
    return Response.json({ cardId, favorited: saved.has(cardId) });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('saves a card without opening the detail, filters favorites, and restores them after remount', async () => {
  render(
    <UserSession>
      <LibraryPage />
    </UserSession>,
  );
  const button = screen.getByLabelText(`收藏${card.nameCn}`);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByLabelText(`取消收藏${card.nameCn}`);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '我的收藏 1' }));
  expect(screen.getAllByRole('link', { name: /^查看/ })).toHaveLength(1);
  cleanup();
  render(
    <UserSession>
      <LibraryPage />
    </UserSession>,
  );
  expect(await screen.findByLabelText(`取消收藏${card.nameCn}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '我的收藏 1' }));
  fireEvent.click(screen.getByRole('button', { name: /圣杯\s*14/ }));
  expect(screen.getByText('这个分类还没有收藏的牌。')).toBeVisible();
});

it('updates favorites in the detail and reflects the count on 我的', async () => {
  const view = render(
    <UserSession>
      <LibraryPage />
    </UserSession>,
  );
  await waitFor(() => expect(screen.getByLabelText(`收藏${card.nameCn}`)).toBeEnabled());
  expect(screen.getByLabelText(`查看${card.nameCn}`)).toHaveAttribute(
    'href',
    `/library/${card.id}`,
  );
  view.rerender(
    <UserSession>
      <CardDetail card={card} />
    </UserSession>,
  );
  fireEvent.click(screen.getByRole('button', { name: '收藏这张牌' }));
  expect(await screen.findByRole('button', { name: '取消收藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('link', { name: '返回牌典' })).toHaveAttribute('href', '/library');
  view.rerender(
    <UserSession>
      <LibraryPage />
    </UserSession>,
  );
  expect(screen.getByLabelText(`取消收藏${card.nameCn}`)).toHaveAttribute('aria-pressed', 'true');
  navigation.pathname = '/profile';
  view.rerender(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  expect(await screen.findByLabelText('1 张珍藏牌面')).toHaveTextContent('1');
});

it('retains a saved favorite on failed removal and shows an empty collection after retry succeeds', async () => {
  saved.add(card.id);
  render(
    <UserSession>
      <LibraryPage />
    </UserSession>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '我的收藏 1' }));
  fetchMock.mockResolvedValueOnce(Response.json({ error: '保存失败，请重试' }, { status: 503 }));
  fireEvent.click(screen.getByLabelText(`取消收藏${card.nameCn}`));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  const button = screen.getByLabelText(`取消收藏${card.nameCn}`);
  expect(button).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(button);
  expect(await screen.findByText('还没有收藏，点击牌面旁的书签即可珍藏。')).toBeVisible();
  expect(saved.size).toBe(0);
});

it('asks visitors to log in and never writes a favorite without a session', async () => {
  fetchMock.mockResolvedValue(Response.json({ error: '请登录' }, { status: 401 }));
  render(
    <UserSession>
      <LibraryPage />
    </UserSession>,
  );
  const button = screen.getByLabelText(`收藏${card.nameCn}`);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('请登录后收藏');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
