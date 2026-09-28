'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import type { CurrentUser } from '@/lib/auth/types';
import { apiFetch, ApiError } from '@/lib/api/client';
import type { ProfileUpdate } from '@/lib/auth/profile';
import type { DailyDraft } from '@/lib/dailyStorage';
import { clearWechatRecovery, recoverWechatSession } from '@/lib/auth/wechat-recovery';
import { isWechatMiniProgram } from '@/lib/auth/environment';
import { loginAsGuest } from '@/lib/auth/guest';
import { AgentChatSession } from '@/components/session/AgentChatSession';
import { AgentPageSkeleton } from '@/components/question/AgentPageSkeleton';
import { HistoryListSkeleton } from '@/components/common/Skeletons';

const UserContext = createContext<{
  user: CurrentUser | null;
  loading: boolean;
  error: string;
  retryLogin: () => void;
  dailyDrafts: Map<string, DailyDraft>;
  refreshSession: () => void;
  updateProfile: (changes: ProfileUpdate) => Promise<void>;
  setFavorite: (cardId: string, favorited: boolean) => Promise<void>;
}>({
  user: null,
  loading: true,
  error: '',
  retryLogin: () => {},
  refreshSession: () => {},
  dailyDrafts: new Map(),
  updateProfile: async () => {
    throw new Error('用户会话尚未就绪');
  },
  setFavorite: async () => {
    throw new Error('请先登录');
  },
});
export const useUser = () => useContext(UserContext);

export function UserSession({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const recoveryAttempted = useRef(false);
  const favoriteRevision = useRef(0);
  const pending = useRef(true);
  const [dailyDrafts] = useState(() => new Map<string, DailyDraft>());
  const protectedPage = /^\/(agent|reading|daily|history)(\/|$)/.test(pathname);

  function refreshSession() {
    if (pending.current) return;
    pending.current = true;
    recoveryAttempted.current = false;
    clearWechatRecovery();
    setLoading(true);
    setError('');
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    pending.current = true;
    const controller = new AbortController();
    const revision = favoriteRevision.current;
    apiFetch<{ user: CurrentUser }>('/api/auth/me')
      .then((data) => {
        if (active) {
          setUser((current) =>
            current && favoriteRevision.current !== revision
              ? { ...data.user, favoriteCardIds: current.favoriteCardIds }
              : data.user,
          );
          setError('');
          recoveryAttempted.current = false;
          clearWechatRecovery();
        }
      })
      .catch(async (error) => {
        if (!active) return;
        if (!(error instanceof ApiError && error.status === 401)) {
          setError('暂时无法读取登录状态，请重试');
          return;
        }
        setUser(null);
        dailyDrafts.clear();
        setError('');
        const miniProgram = await isWechatMiniProgram(controller.signal);
        if (!active) return;
        if (!miniProgram) {
          await loginAsGuest();
          if (!active) return;
          const data = await apiFetch<{ user: CurrentUser }>('/api/auth/me');
          if (active) {
            setUser(data.user);
            clearWechatRecovery();
          }
          return;
        }
        if (!recoveryAttempted.current) {
          recoveryAttempted.current = true;
          setLoading(true);
          await recoverWechatSession(controller.signal);
          if (controller.signal.aborted) recoveryAttempted.current = false;
        }
      })
      .catch(() => {
        if (active) setError('暂时无法完成登录，请重试');
      })
      .finally(() => {
        if (active) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, dailyDrafts, pathname]);

  function retryLogin() {
    refreshSession();
  }

  return (
    <UserContext.Provider
      value={{
        user,
        loading,
        error,
        retryLogin,
        refreshSession,
        dailyDrafts: dailyDrafts,
        setFavorite: async (cardId, favorited) => {
          if (!user) throw new Error('请登录后收藏');
          await apiFetch(`/api/favorites/${encodeURIComponent(cardId)}`, {
            method: favorited ? 'PUT' : 'DELETE',
          });
          favoriteRevision.current += 1;
          setUser((current) => {
            if (!current) return current;
            const ids = current.favoriteCardIds ?? [];
            return {
              ...current,
              favoriteCardIds: favorited
                ? Array.from(new Set([cardId, ...ids]))
                : ids.filter((id) => id !== cardId),
            };
          });
        },
        updateProfile: async (changes) => {
          const data = await apiFetch<{ user: CurrentUser }>('/api/auth/me', {
            method: 'PATCH',
            body: JSON.stringify(changes),
          });
          setUser(data.user);
        },
      }}
    >
      <AgentChatSession authenticated={Boolean(user)}>
        {pathname === '/agent' && loading ? (
          <AgentPageSkeleton />
        ) : pathname === '/history' && loading ? (
          <HistoryListSkeleton />
        ) : protectedPage && (loading || !user) ? (
          <main
            id="main-content"
            className="min-h-screen flex flex-col items-center justify-center gap-6 px-8 text-center"
          >
            <h1 className="text-2xl text-bone">
              {loading
                ? <>正在连接<span className="brand-name">{BRAND.name}</span>…</>
                : error
                  ? '暂时无法读取登录状态'
                  : '登录后开始探索'}
            </h1>
            {!loading && (
              <>
                <p role={error ? 'alert' : undefined} className="text-bone-dim">
                  {error ||
                    '网页会自动使用游客账号，微信小程序使用微信账号。请重试登录；小程序中也可关闭后重新进入。'}
                </p>
                <button
                  data-small-action="text"
                  type="button"
                  className="btn-ink px-6 py-3"
                  disabled={loading}
                  onClick={refreshSession}
                >
                  重新检查登录
                </button>
                <Link data-small-action="text" href="/" className="text-gold">
                  返回首页
                </Link>
              </>
            )}
          </main>
        ) : (
          children
        )}
      </AgentChatSession>
    </UserContext.Provider>
  );
}
