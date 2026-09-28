import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductTour } from '@/components/onboarding/ProductTour';

const session = vi.hoisted(() => ({
  user: null as null | { createdAt: string },
  loading: false,
  error: '',
}));
vi.mock('@/components/session/UserSession', () => ({ useUser: () => session }));
let stored: 'completed' | 'skipped' | null;
let scope: string;
let lookup: ReturnType<typeof vi.fn<() => Promise<Response>>>;
let fetchMock: ReturnType<typeof vi.fn>;
const writes = () => fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT');

async function settle() {
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
}

function Page() {
  return (
    <main>
      {['conversation', 'manual', 'daily', 'library', 'history'].map((target) => (
        <a href={`/${target}`} data-tour={target} key={target}>
          {target}
        </a>
      ))}
      <ProductTour />
    </main>
  );
}

beforeEach(() => {
  session.user = null;
  session.loading = false;
  session.error = '';
  stored = null;
  scope = 'a'.repeat(64);
  lookup = vi.fn(async () => Response.json({ version: 1, accountScope: scope, status: stored }));
  fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(options.body as string);
      if (body.accountScope !== scope) return Response.json({}, { status: 409 });
      if (stored !== 'completed') stored = body.status;
      return Response.json({ version: 1, accountScope: scope, status: stored });
    }
    return lookup();
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const hidden =
      !(this as HTMLElement).isConnected || (this as HTMLElement).style.display === 'none';
    return {
      x: 20,
      y: 100,
      top: 100,
      left: 20,
      bottom: 144,
      right: 220,
      width: hidden ? 0 : 200,
      height: hidden ? 0 : 44,
      toJSON() {},
    };
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.history.replaceState({}, '', '/');
});

describe('account-persisted first-use eligibility', () => {
  it.each(['2019-01-01', '2026-09-24'])(
    'shows accounts without records, created on %s',
    async (createdAt) => {
      session.user = { createdAt };
      const view = render(<Page />);
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
      await waitFor(() => expect(stored).toBe('skipped'));
      expect(writes()).toHaveLength(1);
      view.unmount();
      render(<Page />);
      await settle();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it.each(['completed', 'skipped'] as const)(
    'suppresses automatic replay for %s but allows explicit replay',
    async (status) => {
      session.user = { createdAt: '2020-01-01' };
      stored = status;
      const view = render(<Page />);
      await settle();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await open();
      fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(stored).toBe(status);
      view.unmount();
      window.history.replaceState({}, '', '/?tour=welcome');
      render(
        <StrictMode>
          <Page />
        </StrictMode>,
      );
      await screen.findByRole('dialog');
      expect(window.location.search).toBe('');
    },
  );

  it('saves completion exactly once in Strict Mode, even followed by pagehide', async () => {
    session.user = { createdAt: '2020-01-01' };
    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    await screen.findByRole('dialog');
    expect(document.querySelectorAll('.driver-overlay')).toHaveLength(1);
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent(window, new Event('pagehide'));
    await waitFor(() => expect(stored).toBe('completed'));
    expect(writes()).toHaveLength(1);
  });

  it.each(['skip', 'escape', 'overlay'])(
    'records explicit %s as skipped, including on the final step',
    async (action) => {
      session.user = { createdAt: '2020-01-01' };
      render(<Page />);
      await screen.findByRole('dialog');
      for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: '下一步' }));
      if (action === 'skip')
        fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
      else if (action === 'escape')
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      else fireEvent.click(document.querySelector('.driver-overlay path')!);
      await waitFor(() => expect(stored).toBe('skipped'));
      expect(writes()).toHaveLength(1);
    },
  );

  it.each(['unmount', 'pagehide', 'hidden', 'missing'])(
    'does not persist an interruption: %s',
    async (cause) => {
      session.user = { createdAt: '2020-01-01' };
      const view = render(<Page />);
      await screen.findByRole('dialog');
      if (cause === 'unmount') view.unmount();
      else if (cause === 'pagehide') fireEvent(window, new Event('pagehide'));
      else if (cause === 'hidden') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
      } else {
        document.querySelector('[data-tour="manual"]')!.remove();
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));
      }
      await settle();
      expect(writes()).toHaveLength(0);
      expect(stored).toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('does not treat session loading or malformed/failed lookups as unseen', async () => {
    session.loading = true;
    session.user = { createdAt: '2020-01-01' };
    const view = render(<Page />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    session.loading = false;
    lookup.mockResolvedValue(Response.json({ status: null }));
    view.rerender(<Page />);
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    lookup.mockImplementation(async () => Response.json({}, { status: 503 }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
    expect(writes()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('未能保存');
  });

  it('manual viewing wins over a late unseen lookup', async () => {
    session.user = { createdAt: '2020-01-01' };
    let resolve!: (response: Response) => void;
    lookup.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    render(<Page />);
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    await open();
    fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
    await act(async () => {
      resolve(Response.json({ version: 1, accountScope: scope, status: null }));
    });
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });

  it('does not restart an interrupted run on same-account profile refresh', async () => {
    session.user = { createdAt: '2020-01-01' };
    const view = render(<Page />);
    await screen.findByRole('dialog');
    fireEvent(window, new Event('pagehide'));
    session.user = { ...session.user };
    view.rerender(<Page />);
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('interrupts the old run when a different account is confirmed', async () => {
    session.user = { createdAt: '2020-01-01' };
    const view = render(<Page />);
    await screen.findByRole('dialog');
    scope = 'b'.repeat(64);
    stored = 'completed';
    session.user = { createdAt: '2021-01-01' };
    view.rerender(<Page />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes()).toHaveLength(0);
  });

  it('does not relabel a run with a replacement cookie account when saving', async () => {
    await render(<Page />);
    await open();
    scope = 'b'.repeat(64);
    fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
    await screen.findByText(/未能保存引导状态/);
    expect(JSON.parse(writes()[0][1].body).accountScope).toBe('a'.repeat(64));
    expect(stored).toBeNull();
  });

  it('restores the pre-tour focus after automatic launch', async () => {
    const focus = document.createElement('button');
    document.body.append(focus);
    focus.focus();
    session.user = { createdAt: '2020-01-01' };
    render(<Page />);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
    await waitFor(() => expect(document.activeElement).toBe(focus));
    focus.remove();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

async function open() {
  fireEvent.click(screen.getByRole('button', { name: '初次相遇 · 新手指引' }));
  return screen.findByRole('dialog');
}

describe('actual Driver.js product tour', () => {
  it.each(['skip', 'missing target'])(
    'restores the page when ending before the first Driver frame: %s',
    async (cause) => {
      render(<Page />);
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
      await open();
      if (cause === 'skip') {
        fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
        await waitFor(() => expect(stored).toBe('skipped'));
        expect(writes()).toHaveLength(1);
      } else {
        document.querySelector('[data-tour="manual"]')!.remove();
        fireEvent.click(screen.getByRole('button', { name: '下一步' }));
        expect(writes()).toHaveLength(0);
        expect(screen.getByRole('status')).toHaveTextContent('入口暂时不可见');
      }
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'conversation' }).closest('[inert]')).toBeNull();
      expect(screen.getByRole('button', { name: '初次相遇 · 新手指引' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    },
  );

  it('is opt-in, has five real feature steps, prevents duplicate starts, and restores focus after completion', async () => {
    render(<Page />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const launcher = screen.getByRole('button', { name: '初次相遇 · 新手指引' });
    fireEvent.click(launcher);
    fireEvent.click(launcher);
    await screen.findByRole('dialog', { name: /第 1 步.*从一句心事开始/ });
    expect(document.querySelectorAll('.driver-popover')).toHaveLength(1);
    for (const title of [
      '亲自选阵与抽牌',
      '留给今天的一张牌',
      '读懂与珍藏牌面',
      '回看走过的轨迹',
    ]) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
      await screen.findByRole('dialog', { name: new RegExp(title) });
    }
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(launcher);
    expect(document.body).not.toHaveClass('driver-active', 'driver-no-scroll');
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('link', { name: 'conversation' })).toBeVisible();
  });

  it('supports back, skip, Escape, focus containment and a clean restart', async () => {
    render(<Page />);
    await open();
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      dialog.focus();
    });
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const background = document.querySelector<HTMLElement>('[data-tour="daily"]')!;
    await act(async () => {
      background.focus();
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(background.closest('[inert]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/第 1 步/);
    fireEvent.click(screen.getByRole('button', { name: '跳过，退出指引' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(background.closest('[inert]')).toBeNull();
  });

  it('consumes replay once in Strict Mode without dropping query parameters or hash', async () => {
    window.history.replaceState(
      { preserved: true },
      '',
      '/?tour=welcome&source=profile#home-title',
    );
    const view = render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    await screen.findByRole('dialog');
    expect(window.location.search).toBe('?source=profile');
    expect(window.location.hash).toBe('#home-title');
    expect(window.history.state).toEqual({ preserved: true });
    view.unmount();
    render(<Page />);
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.driver-overlay')).toBeNull();
  });

  it('unmount and page suspension remove all overlays and restore existing background attributes', async () => {
    const sibling = document.createElement('aside');
    sibling.setAttribute('aria-hidden', 'false');
    document.body.append(sibling);
    const view = render(<Page />);
    await open();
    fireEvent(window, new Event('pagehide'));
    expect(document.querySelector('.driver-overlay')).toBeNull();
    expect(sibling.getAttribute('aria-hidden')).toBe('false');
    expect(sibling.hasAttribute('inert')).toBe(false);
    await open();
    view.unmount();
    expect(document.querySelector('.driver-popover')).toBeNull();
    expect(document.body).not.toHaveClass('driver-no-scroll');
    sibling.remove();
  });

  it('does not open a misleading centered step when a target is missing or hidden', async () => {
    render(<Page />);
    document.querySelector<HTMLElement>('[data-tour="daily"]')!.style.display = 'none';
    fireEvent.click(screen.getByRole('button', { name: '初次相遇 · 新手指引' }));
    await screen.findByText('指引暂时没有准备好，请稍后重试。');
    expect(document.querySelector('.driver-overlay')).toBeNull();
    document.querySelector<HTMLElement>('[data-tour="daily"]')!.style.display = '';
    await open();
    document.querySelector('[data-tour="manual"]')!.remove();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('入口暂时不可见');
  });

  it('cancels a pending lazy import on unmount or page hiding without a late overlay', async () => {
    const view = render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: '初次相遇 · 新手指引' }));
    view.unmount();
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.querySelector('.driver-overlay')).toBeNull();
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: '初次相遇 · 新手指引' }));
    fireEvent(window, new Event('pagehide'));
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(document.querySelector('.driver-overlay')).toBeNull();
    await open();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('waits for the real entry animation to settle before highlighting moving targets', async () => {
    render(<Page />);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    Object.defineProperty(document.querySelector('main'), 'getAnimations', {
      value: () => [
        { playState: 'running', effect: { getComputedTiming: () => ({ endTime: 950 }) }, finished },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: '初次相遇 · 新手指引' }));
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      finish();
    });
    await screen.findByRole('dialog');
  });
});
