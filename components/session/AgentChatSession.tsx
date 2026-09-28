'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAgentChat } from '@/hooks/useAgentChat';
import { AgentPageSkeleton } from '@/components/question/AgentPageSkeleton';

function useSessionState(authenticated: boolean) {
  const chat = useAgentChat(authenticated);
  const [draft, setDraft] = useState('');
  const [directDraft, setDirectDraft] = useState(false);
  useEffect(() => {
    if (authenticated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft('');
    setDirectDraft(false);
  }, [authenticated]);
  const resetChat = chat.reset;
  const restoreChat = chat.restoreReading;
  const reset = useCallback(() => {
    resetChat();
    setDraft('');
    setDirectDraft(false);
  }, [resetChat]);
  const restoreReading = useCallback(
    (...args: Parameters<typeof restoreChat>) => {
      restoreChat(...args);
      setDraft('');
      setDirectDraft(false);
    },
    [restoreChat],
  );

  return { ...chat, reset, restoreReading, draft, setDraft, directDraft, setDirectDraft };
}

const AgentChatContext = createContext<ReturnType<typeof useSessionState> | null>(null);

/** 与登录会话同寿命；路由页面卸载只移除视图，不终止生成。 */
export function AgentChatSession({
  children,
  authenticated,
}: {
  children: ReactNode;
  authenticated: boolean;
}) {
  const session = useSessionState(authenticated);
  const onAgentPage = usePathname() === '/agent';
  return (
    <AgentChatContext.Provider value={session}>
      {authenticated && onAgentPage && session.sessionError && (
        <div role="alert" className="ink-panel p-4 text-bone">
          对话同步失败：{session.sessionError}{' '}
          <button
            data-small-action="text"
            type="button"
            className="text-gold underline"
            onClick={() => window.location.reload()}
          >
            重新读取
          </button>
        </div>
      )}
      {authenticated && onAgentPage && !session.sessionReady
        ? !session.sessionError && <AgentPageSkeleton />
        : children}
    </AgentChatContext.Provider>
  );
}

export function useAgentChatSession() {
  const session = useContext(AgentChatContext);
  if (!session) throw new Error('对话页面必须位于 AgentChatSession 中');
  return session;
}
