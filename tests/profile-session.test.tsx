vi.mock('@/lib/agentSessionStorage', () => ({
  loadAgentSession: async () => ({ tasks: [], revision: 0 }),
  saveAgentSession: vi.fn(),
}));
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/profile/page';
import ProfileLoading from '@/app/profile/loading';
import { UserSession, useUser } from '@/components/session/UserSession';

const navigation = vi.hoisted(() => ({ pathname: '/profile' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/auth/environment', () => ({ isWechatMiniProgram: async () => true }));

const user = {
  nickname: '月映卡语测试用户',
  avatarUrl: '/avatars/default.svg',
  createdAt: '2026-09-09T18:30:00.000Z',
};
let fetchMock: ReturnType<typeof vi.fn>;
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function openProfile() {
  return render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
}

describe('profile login information', () => {
  beforeEach(() => {
    navigation.pathname = '/profile';
    fetchMock = vi.fn().mockResolvedValue(Response.json({ user }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('waits for the session before showing signed-out information', async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    openProfile();
    const main = screen.getByRole('main');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    const profileLink = within(nav).getByRole('link', { name: '我的' });
    profileLink.focus();
    expect(main).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status', { name: '正在载入个人资料' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '个人资料' })).not.toBeInTheDocument();
    expect(screen.queryByText('尚未登录')).not.toBeInTheDocument();
    pending.resolve(Response.json({ user }));
    expect(await screen.findByText('微信已登录')).toBeInTheDocument();
    expect(screen.getByText('月映卡语')).toBeVisible();
    expect(screen.getByRole('main')).toBe(main);
    expect(main).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('navigation', { name: '主导航' })).toBe(nav);
    expect(profileLink).toHaveFocus();
    expect(screen.queryByRole('status', { name: '正在载入个人资料' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '账号信息' })).not.toBeInTheDocument();
    expect(screen.queryByText('聊天与解读记录随当前账号保存。')).not.toBeInTheDocument();
    expect(screen.queryByText('不必急于寻找答案，先听见自己的声音。')).not.toBeInTheDocument();
  });

  it('recovers from an expired session without duplicating requests while pending', async () => {
    const pending = deferred();
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: '登录已过期' }, { status: 401 }))
      .mockReturnValueOnce(pending.promise);
    openProfile();
    expect(await screen.findByText('尚未登录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更换头像' })).toBeDisabled();
    const retry = screen.getByRole('button', { name: '重新检查登录' });
    fireEvent.click(retry);
    expect(screen.queryByRole('button', { name: '重新检查登录' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在载入个人资料' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(Response.json({ user }));
    expect(await screen.findByText('微信已登录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更换头像' })).toBeEnabled();
    expect(screen.getByRole('button', { name: `${user.nickname}，修改昵称` })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('uses the same profile skeleton for route loading and the initial session request', () => {
    const route = render(<ProfileLoading />);
    const markup = route.container.innerHTML;
    route.unmount();
    fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}));
    const page = openProfile();
    expect(page.container.innerHTML).toBe(markup);
  });

  it.each(['network', 'server'])(
    'keeps %s errors distinct from signed-out state and supports recovery',
    async (kind) => {
      if (kind === 'network') fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      else
        fetchMock.mockResolvedValueOnce(
          Response.json({ error: 'service unavailable' }, { status: 503 }),
        );
      openProfile();
      expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取登录状态，请重试');
      expect(screen.queryByText('尚未登录')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '重新检查登录' }));
      expect(await screen.findByText('微信已登录')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('ignores the abandoned request after an effect restart', async () => {
    const first = deferred();
    const second = deferred();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(
      <StrictMode>
        <UserSession>
          <ProfilePage />
        </UserSession>
      </StrictMode>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    second.resolve(Response.json({ user }));
    await screen.findByText('微信已登录');
    await act(async () => {
      first.resolve(Response.json({ error: 'expired' }, { status: 401 }));
    });
    expect(screen.getByText('微信已登录')).toBeInTheDocument();
    expect(screen.queryByText('尚未登录')).not.toBeInTheDocument();
  });

  it('uses the same refresh operation for protected pages', async () => {
    navigation.pathname = '/agent';
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }));
    render(
      <UserSession>
        <p>受保护内容</p>
      </UserSession>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '重新检查登录' }));
    expect(await screen.findByText('受保护内容')).toBeInTheDocument();
  });

  it('coalesces simultaneous calls to the shared refresh operation', async () => {
    function Probe() {
      const { loading, refreshSession } = useUser();
      return (
        <button
          disabled={loading}
          onClick={() => {
            refreshSession();
            refreshSession();
          }}
        >
          检查两次
        </button>
      );
    }
    render(
      <UserSession>
        <Probe />
      </UserSession>,
    );
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    pending.resolve(Response.json({ user }));
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
  });

  it.each([
    [503, '尚未保存的札记'],
    [401, ''],
  ])(
    'refresh status %i preserves drafts unless the session has expired',
    async (status, expectedNote) => {
      function Probe() {
        const { loading, refreshSession, dailyDrafts } = useUser();
        return (
          <>
            <output aria-label="札记草稿">{dailyDrafts.get('2026-09-10')?.note ?? ''}</output>
            <button
              disabled={loading}
              onClick={() => {
                dailyDrafts.set('2026-09-10', {
                  note: '尚未保存的札记',
                  dirty: true,
                  revision: 1,
                  writes: Promise.resolve(false),
                });
                refreshSession();
              }}
            >
              保存草稿并检查登录
            </button>
          </>
        );
      }
      render(
        <UserSession>
          <Probe />
        </UserSession>,
      );
      await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
      fetchMock.mockResolvedValueOnce(Response.json({ error: 'session unavailable' }, { status }));
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('札记草稿').textContent).toBe(expectedNote);
    },
  );
});
