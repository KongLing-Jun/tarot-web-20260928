import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UserSession, useUser } from '@/components/session/UserSession';
import ProfilePage from '@/app/profile/page';
import CreditsPage from '@/app/profile/credits/page';
import { isWechatMiniProgram } from '@/lib/auth/environment';

const navigation = vi.hoisted(() => ({
  pathname: '/profile',
  replace: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: navigation.redirect,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
}));
vi.mock('@/components/layout/MainNav', () => ({ MainNav: () => null }));
vi.mock('@/lib/agentSessionStorage', () => ({
  loadAgentSession: async () => ({ tasks: [], revision: 0 }),
  saveAgentSession: vi.fn(),
}));

const guest = {
  isGuest: true,
  nickname: '游客',
  avatarUrl: '/avatars/default.svg',
  createdAt: '2026-09-18',
  readingCount: 0,
  creditBalance: 0,
  favoriteCardIds: [] as string[],
};
let authenticated: boolean;
let profile: typeof guest;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  navigation.pathname = '/profile';
  navigation.replace.mockClear();
  navigation.redirect.mockClear();
  authenticated = false;
  profile = { ...guest };
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/auth/guest') {
      authenticated = true;
      return Response.json({ ok: true });
    }
    if (!authenticated) return Response.json({ error: '请登录' }, { status: 401 });
    if (url.startsWith('/api/favorites/')) return Response.json({});
    if (options?.method === 'PATCH')
      profile = { ...profile, ...JSON.parse(options.body as string) };
    return Response.json({ user: profile });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('automatically creates a browser guest and enables editing without a WeChat redirect', async () => {
  render(
    <StrictMode>
      <UserSession>
        <ProfilePage />
      </UserSession>
    </StrictMode>,
  );
  expect(await screen.findByText('游客已登录')).toBeVisible();
  expect(screen.queryByRole('link', { name: '购买抽卡次数' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '抽卡次数' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '更换头像' })).toBeEnabled();
  const credential = localStorage.getItem('tarot_guest_credential');
  expect(credential).toMatch(/^[a-f0-9]{64}$/);
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/guest')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '游客，修改昵称' }));
  fireEvent.change(screen.getByRole('textbox', { name: '昵称' }), {
    target: { value: '网页旅人' },
  });
  fireEvent.keyDown(screen.getByRole('textbox', { name: '昵称' }), { key: 'Enter' });
  expect(await screen.findByRole('button', { name: '网页旅人，修改昵称' })).toBeVisible();
  expect(screen.getByText('游客已登录')).toBeVisible();
});

it('redirects the retired purchase page before loading a session or recharge options', () => {
  navigation.pathname = '/profile/credits';
  expect(() => CreditsPage()).toThrow('NEXT_REDIRECT');
  expect(navigation.redirect).toHaveBeenCalledWith('/profile');
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['/agent', '/reading', '/daily', '/history'])(
  'opens protected browser page %s',
  async (pathname) => {
    navigation.pathname = pathname;
    render(
      <UserSession>
        <p>已打开功能</p>
      </UserSession>,
    );
    expect(await screen.findByText('已打开功能')).toBeVisible();
  },
);

it('restores the stored credential after expiration and saves favorites with the guest session', async () => {
  const credential = 'a'.repeat(64);
  localStorage.setItem('tarot_guest_credential', credential);
  function Probe() {
    const { user, setFavorite } = useUser();
    return (
      <button disabled={!user} onClick={() => void setFavorite('the-fool', true)}>
        {user?.favoriteCardIds.join(',') || '收藏'}
      </button>
    );
  }
  render(
    <UserSession>
      <Probe />
    </UserSession>,
  );
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/auth/guest',
    expect.objectContaining({ body: JSON.stringify({ credential }) }),
  );
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByText('the-fool')).toBeVisible();
  cleanup();
  authenticated = false;
  render(
    <UserSession>
      <Probe />
    </UserSession>,
  );
  await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
  const credentials = fetchMock.mock.calls
    .filter(([url]) => url === '/api/auth/guest')
    .map(([, options]) => JSON.parse(options.body).credential);
  expect(credentials).toEqual([credential, credential]);
});

it('keeps an existing session and does not create a guest after a server failure', async () => {
  authenticated = true;
  const view = render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  await screen.findByText('游客已登录');
  expect(localStorage.length).toBe(0);
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }));
  navigation.pathname = '/profile/avatar';
  view.rerender(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取登录状态');
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/guest')).toBe(false);
});

it('allows retrying failed guest login without replacing the credential', async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }));
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法完成登录');
  const credential = localStorage.getItem('tarot_guest_credential');
  fireEvent.click(screen.getByRole('button', { name: '重新检查登录' }));
  expect(await screen.findByText('游客已登录')).toBeVisible();
  expect(localStorage.getItem('tarot_guest_credential')).toBe(credential);
});

it('continues as a guest when browser storage is disabled', async () => {
  const credential = 'b'.repeat(64);
  localStorage.setItem('tarot_guest_credential', credential);
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  await screen.findByText('游客已登录');
  cleanup();
  authenticated = false;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('disabled');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('disabled');
  });
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  expect(await screen.findByText('游客已登录')).toBeVisible();
  expect(
    fetchMock.mock.calls
      .filter(([url]) => url === '/api/auth/guest')
      .map(([, options]) => JSON.parse(options.body).credential),
  ).toEqual([credential, credential]);
});

it('preserves WeChat recovery and never creates a guest inside the mini program', async () => {
  vi.stubGlobal('__wxjs_environment', 'miniprogram');
  const reLaunch = vi.fn(({ success }) => success());
  vi.stubGlobal('wx', {
    miniProgram: {
      getEnv: (done: (env: { miniprogram: boolean }) => void) => done({ miniprogram: true }),
      reLaunch,
    },
  });
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  await waitFor(() => expect(reLaunch).toHaveBeenCalledOnce());
  expect(localStorage.length).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('recognizes the regular WeChat browser as a guest environment', async () => {
  vi.stubGlobal('wx', {
    miniProgram: {
      getEnv: (done: (env: { miniprogram: boolean }) => void) => done({ miniprogram: false }),
    },
  });
  expect(await isWechatMiniProgram()).toBe(false);
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  expect(await screen.findByText('游客已登录')).toBeVisible();
});

it('does not switch identity if WeChat environment detection fails', async () => {
  vi.stubGlobal('wx', {
    miniProgram: {
      getEnv: () => {
        throw new Error('unavailable');
      },
    },
  });
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法完成登录');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
});
