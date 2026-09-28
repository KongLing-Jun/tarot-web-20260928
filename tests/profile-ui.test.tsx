vi.mock('@/lib/agentSessionStorage', () => ({
  loadAgentSession: async () => ({ tasks: [], revision: 0 }),
  saveAgentSession: vi.fn(),
}));
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilePage from '@/app/profile/page';
import AvatarPage from '@/app/profile/avatar/page';
import { UserSession, useUser } from '@/components/session/UserSession';
import { ProfileEditor } from '@/components/profile/ProfileEditor';
import { prepareAvatar } from '@/lib/auth/avatar';

const { push, navigation } = vi.hoisted(() => ({
  push: vi.fn(),
  navigation: { pathname: '/profile' },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push }),
}));
vi.mock('@/components/layout/MainNav', () => ({ MainNav: () => null }));
vi.mock('@/lib/auth/avatar', () => ({ prepareAvatar: vi.fn() }));
vi.mock('@/lib/auth/environment', () => ({ isWechatMiniProgram: async () => true }));
const original = {
  id: 'immutable-uuid',
  publicId: 'seeker',
  nickname: '星旅人',
  avatarUrl: '/avatars/default.svg',
  createdAt: '2026-09-09',
  readingCount: 0,
  creditBalance: 0,
};
let stored: typeof original;
let fetchMock: ReturnType<typeof vi.fn>;

async function openEditor() {
  render(
    <UserSession>
      <ProfilePage />
    </UserSession>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '星旅人，修改昵称' }));
  return screen.getByRole('textbox', { name: '昵称' });
}

describe('profile editing in 我的', () => {
  beforeEach(() => {
    navigation.pathname = '/profile';
    stored = { ...original };
    fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'PATCH')
        stored = { ...stored, ...JSON.parse(options.body as string) };
      return Response.json({ user: stored });
    });
    vi.stubGlobal('fetch', fetchMock);
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('exposes both edit actions and opens the same inline editor from its visible hint', async () => {
    render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    const trigger = await screen.findByRole('button', { name: '星旅人，修改昵称' });
    expect(screen.getByText('修改昵称').closest('button')).toBe(trigger);
    expect(screen.getByAltText('用户头像').closest('button')).toBe(
      screen.getByRole('button', { name: '更换头像' }),
    );
    fireEvent.click(screen.getByText('修改昵称'));
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveFocus();
    expect(screen.queryByText('修改昵称')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '昵称' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: '星旅人，修改昵称' })).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the default editor presentation unchanged and disables compact editing while loading', () => {
    const user = { ...original, favoriteCardIds: [] };
    const view = render(<ProfileEditor user={user} loading={false} />);
    expect(screen.getByRole('button', { name: '星旅人，重命名' })).toBeVisible();
    expect(screen.queryByText('修改昵称')).not.toBeInTheDocument();
    view.rerender(<ProfileEditor user={user} loading density="compact" />);
    fireEvent.click(screen.getByText('修改昵称'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '星旅人，修改昵称' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows zero for a new user and refreshes the count when returning from a reading', async () => {
    const view = render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    expect(await screen.findByLabelText('0 次占卜')).toHaveTextContent('0');
    expect(screen.queryByRole('region', { name: '抽卡次数' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /购买抽卡次数/ })).not.toBeInTheDocument();
    navigation.pathname = '/reading';
    view.rerender(
      <UserSession>
        <div>占卜页面</div>
      </UserSession>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    stored = { ...stored, readingCount: 12, creditBalance: 300 };
    navigation.pathname = '/profile';
    view.rerender(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    expect(await screen.findByLabelText('12 次占卜')).toHaveTextContent('12');
    expect(screen.queryByText('可用抽卡次数')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '星旅人，修改昵称' }));
    const input = screen.getByRole('textbox', { name: '昵称' });
    fireEvent.change(input, { target: { value: '新名字' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('昵称已保存');
    expect(screen.getByLabelText('12 次占卜')).toHaveTextContent('12');
    expect(screen.queryByText('可用抽卡次数')).not.toBeInTheDocument();
  });

  it.each([0, 503])(
    'keeps the signed-in profile when a background refresh fails with %s',
    async (status) => {
      stored = { ...stored, nickname: '已登录用户', readingCount: 8 };
      const view = render(
        <UserSession>
          <ProfilePage />
        </UserSession>,
      );
      await screen.findByText('已登录用户');
      if (status === 0) fetchMock.mockRejectedValueOnce(new TypeError('offline'));
      else fetchMock.mockResolvedValueOnce(Response.json({ error: '服务暂不可用' }, { status }));
      navigation.pathname = '/profile/avatar';
      view.rerender(
        <UserSession>
          <ProfilePage />
        </UserSession>,
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取登录状态');
      expect(screen.getByText('已登录用户')).toBeVisible();
      expect(screen.getByLabelText('8 次占卜')).toBeVisible();
      expect(screen.queryByText('请从微信小程序登录')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '重新检查登录' }));
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
      expect(screen.getByText('已登录用户')).toBeVisible();
    },
  );

  it.each([false, true])(
    'preserves a balance refreshed during nickname editing (save failure: %s)',
    async (failSave) => {
      function RefreshControl() {
        const { refreshSession, user } = useUser();
        return (
          <>
            <output aria-label="Session balance">{user?.creditBalance}</output>
            <button onClick={refreshSession}>Refresh test session</button>
          </>
        );
      }
      render(
        <UserSession>
          <ProfilePage />
          <RefreshControl />
        </UserSession>,
      );
      fireEvent.click(await screen.findByRole('button', { name: '星旅人，修改昵称' }));
      const input = screen.getByRole('textbox', { name: '昵称' });
      fireEvent.change(input, { target: { value: '刷新后保存' } });
      stored = { ...stored, creditBalance: 300 };
      fireEvent.click(screen.getByRole('button', { name: 'Refresh test session' }));
      await waitFor(() =>
        expect(screen.getByLabelText('Session balance')).toHaveTextContent('300'),
      );
      expect(input).toHaveValue('刷新后保存');
      if (failSave)
        fetchMock.mockResolvedValueOnce(Response.json({ error: '保存失败' }, { status: 503 }));
      fireEvent.keyDown(input, { key: 'Enter' });
      if (failSave) expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
      else await screen.findByText('昵称已保存');
      expect(screen.getByLabelText('Session balance')).toHaveTextContent('300');
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ nickname: '刷新后保存' });
    },
  );

  it('automatically returns to the native WeChat login after a confirmed 401', async () => {
    const reLaunch = vi.fn(({ success }) => success());
    vi.stubGlobal('__wxjs_environment', 'miniprogram');
    vi.stubGlobal('wx', {
      miniProgram: {
        getEnv: (callback: (data: { miniprogram: boolean }) => void) =>
          callback({ miniprogram: true }),
        reLaunch,
      },
    });
    fetchMock.mockResolvedValue(Response.json({ error: '登录已过期' }, { status: 401 }));
    render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    await waitFor(() => expect(reLaunch).toHaveBeenCalledOnce());
    expect(reLaunch.mock.calls[0][0].url).toContain('/pages/index/index?returnTo=');
  });

  it('shows an initial service failure as a retryable error, not as a signed-out profile', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: '服务暂不可用' }, { status: 503 }));
    render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取登录状态');
    expect(screen.queryByText('请从微信小程序登录')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新检查登录' }));
    expect(await screen.findByRole('button', { name: '星旅人，修改昵称' })).toBeVisible();
  });

  it('saves the username, refreshes the visible profile and retains it after remount', async () => {
    const input = await openEditor();
    fireEvent.change(input, { target: { value: '你好1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('昵称已保存');
    expect(screen.getByText('你好1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '你好1，修改昵称' })).toHaveFocus();
    expect(screen.queryByText(/ID：|immutable-uuid|seeker/)).not.toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ nickname: '你好1' });
    expect(stored.id).toBe(original.id);
    expect(screen.queryByRole('textbox', { name: '昵称' })).not.toBeInTheDocument();
    cleanup();
    render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    expect(await screen.findByText('你好1')).toBeInTheDocument();
  });

  it('discards cancelled edits without making a write', async () => {
    const input = await openEditor();
    fireEvent.change(input, { target: { value: 'discard_me' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(screen.getByText('星旅人')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '星旅人，修改昵称' })).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replaces the nickname in place and selects it without opening a profile form', async () => {
    const input = await openEditor();
    expect(screen.queryByText('昵称:')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-labelledby');
    expect(screen.queryByText('The Seeker')).not.toBeInTheDocument();
    expect(screen.getByText('微信已登录')).toBeVisible();
    expect(screen.queryByText('修改用户')).not.toBeInTheDocument();
    expect(screen.queryByText('编辑个人资料')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /，修改昵称$/ })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect((input as HTMLInputElement).selectionStart).toBe(0);
    expect((input as HTMLInputElement).selectionEnd).toBe(original.nickname.length);
    expect(input.closest('h2')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Escape' });
    const trigger = screen.getByRole('button', { name: '星旅人，修改昵称' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-disabled', 'false');
    expect(trigger).not.toHaveAttribute('aria-expanded');
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it.each(
    ['', '   ', '\u3000', '\u00a0'].flatMap((value) =>
      ['Enter', 'blur'].map((action) => ({ value, action })),
    ),
  )('cancels blank nickname $value on $action without saving', async ({ value, action }) => {
    stored = { ...stored, nickname: '星' };
    render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '星，修改昵称' }));
    const input = screen.getByRole('textbox', { name: '昵称' });
    const avatar = screen.getByRole('button', { name: '更换头像' });
    fireEvent.change(input, { target: { value } });
    if (action === 'Enter') {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    } else {
      act(() => {
        avatar.focus();
      });
    }
    const trigger = screen.getByRole('button', { name: '星，修改昵称' });
    expect(input).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('昵称已保存')).not.toBeInTheDocument();
    expect(stored.nickname).toBe('星');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(action === 'Enter' ? trigger : avatar).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveValue('星');
  });

  it.each(['validation', 'request'])(
    'clears a previous %s failure when cancelling a blank draft',
    async (failure) => {
      const input = await openEditor();
      if (failure === 'request')
        fetchMock.mockResolvedValueOnce(
          Response.json({ error: '保存失败，请重试' }, { status: 503 }),
        );
      fireEvent.change(input, {
        target: { value: failure === 'validation' ? 'M'.repeat(41) : '新昵称' },
      });
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByRole('alert');
      const requests = fetchMock.mock.calls.length;
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.getByRole('button', { name: '星旅人，修改昵称' })).toHaveFocus();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByText('昵称已保存')).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(requests);
      expect(stored.nickname).toBe(original.nickname);
    },
  );

  it('displays the current saved nickname after cancelling rather than restoring an old snapshot', () => {
    const user = { ...original, favoriteCardIds: [] };
    const view = render(<ProfileEditor user={user} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: '星旅人，重命名' }));
    const input = screen.getByRole('textbox', { name: '昵称' });
    fireEvent.change(input, { target: { value: '' } });
    view.rerender(<ProfileEditor user={{ ...user, nickname: '最新昵称' }} loading={false} />);
    fireEvent.keyDown(input, { key: 'Enter' });
    const trigger = screen.getByRole('button', { name: '最新昵称，重命名' });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: '昵称' })).toHaveValue('最新昵称');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates nonempty names locally and retains edits on server failure', async () => {
    const input = await openEditor();
    fireEvent.change(input, { target: { value: `\t${original.nickname}` } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('请去掉换行或控制字符');
    expect(screen.getByRole('alert').closest('h2')).toBeNull();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ error: '保存失败，请重试' }, { status: 503 }));
    fireEvent.change(input, { target: { value: 'taken' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(input).toHaveValue('taken');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(stored.nickname).toBe(original.nickname);
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('昵称已保存');
    expect(stored.nickname).toBe('taken');
  });

  it('saves on blur without taking focus from the outside target', async () => {
    const input = await openEditor();
    fireEvent.change(input, { target: { value: '  新昵称  ' } });
    const avatar = screen.getByRole('button', { name: '更换头像' });
    avatar.focus();
    await screen.findByText('昵称已保存');
    expect(stored.nickname).toBe('新昵称');
    expect(avatar).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closes unchanged names without writing or saving on the subsequent blur', async () => {
    const input = await openEditor();
    fireEvent.change(input, { target: { value: ` ${original.nickname} ` } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('locks pending saves against repeated Enter, blur and Escape and revokes focus return', async () => {
    const input = await openEditor();
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.change(input, { target: { value: '待保存昵称' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('status')).toHaveTextContent('正在保存昵称');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    const avatar = screen.getByRole('button', { name: '更换头像' });
    avatar.focus();
    expect(input).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish(Response.json({ user: { ...original, nickname: '待保存昵称' } }));
    await screen.findByText('昵称已保存');
    expect(avatar).toHaveFocus();
  });

  it('does not interpret composition keys or ambiguous composition blur as a commit', async () => {
    const input = await openEditor();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(input).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '输入中' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '完整昵称' } });
    expect(input).toHaveValue('完整昵称');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('昵称已保存');
    expect(stored.nickname).toBe('完整昵称');
  });

  it('does not impose a UTF-16 input limit on forty Unicode code points', async () => {
    const input = await openEditor();
    const name = String.fromCodePoint(0x1f31f).repeat(40);
    expect(input).not.toHaveAttribute('maxlength');
    fireEvent.change(input, { target: { value: `${name}a` } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('昵称最多 40 个字符');
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('昵称已保存');
    expect(stored.nickname).toBe(name);
  });

  it('opens the dedicated avatar page, saves the preview, and returns to 我的', async () => {
    const avatar = 'data:image/jpeg;base64,dGVzdA==';
    vi.mocked(prepareAvatar).mockResolvedValue(avatar);
    const view = render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    await screen.findByText('星旅人');
    fireEvent.click(screen.getByRole('button', { name: '更换头像' }));
    expect(push).toHaveBeenCalledWith('/profile/avatar');
    expect(screen.queryByRole('textbox', { name: '昵称' })).not.toBeInTheDocument();
    view.rerender(
      <UserSession>
        <AvatarPage />
      </UserSession>,
    );
    expect(screen.getByRole('heading', { name: '更换头像' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '昵称' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('上传头像'), {
      target: { files: [new File(['test'], 'avatar.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(screen.getByAltText('新头像预览')).toHaveAttribute('src', avatar));
    expect(stored.avatarUrl).toBe('/avatars/default.svg');
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }));
    await waitFor(() => expect(push).toHaveBeenLastCalledWith('/profile'));
    view.rerender(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    expect(screen.getByAltText('用户头像')).toHaveAttribute('src', avatar);
    view.rerender(
      <UserSession>
        <AvatarPage />
      </UserSession>,
    );
    fireEvent.click(screen.getByRole('button', { name: '恢复默认头像' }));
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }));
    await waitFor(() => expect(stored.avatarUrl).toBe('/avatars/default.svg'));
    expect(stored.publicId).toBe('seeker');
  });

  it('keeps the avatar preview on save failure and cancels without saving', async () => {
    const avatar = 'data:image/jpeg;base64,dGVzdA==';
    vi.mocked(prepareAvatar).mockResolvedValue(avatar);
    render(
      <UserSession>
        <AvatarPage />
      </UserSession>,
    );
    fireEvent.change(await screen.findByLabelText('上传头像'), {
      target: { files: [new File(['test'], 'avatar.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(screen.getByAltText('新头像预览')).toHaveAttribute('src', avatar));
    fetchMock.mockResolvedValueOnce(Response.json({ error: '保存失败，请重试' }, { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByAltText('新头像预览')).toHaveAttribute('src', avatar);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(push).toHaveBeenCalledWith('/profile');
    expect(stored.avatarUrl).toBe('/avatars/default.svg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps editing unavailable for visitors', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: '请登录' }, { status: 401 }));
    render(
      <UserSession>
        <ProfilePage />
      </UserSession>,
    );
    await screen.findByText('尚未登录');
    expect(screen.getByRole('button', { name: '更换头像' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /，修改昵称$/ })).not.toBeInTheDocument();
    cleanup();
    render(
      <UserSession>
        <AvatarPage />
      </UserSession>,
    );
    await screen.findByText('请登录后更换头像。');
    expect(screen.queryByLabelText('上传头像')).not.toBeInTheDocument();
  });
});
