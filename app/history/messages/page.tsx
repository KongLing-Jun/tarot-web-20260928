'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api/client';
import type { ChatHistoryMessage, ChatHistoryPage as MessagePage } from '@/lib/chatHistory';
import { ChatHistoryArchive } from '@/components/history/ChatHistoryArchive';
import { HistoryPageFrame } from '@/components/history/HistoryPageFrame';
import { RitualMoreMenu } from '@/components/drawing/RitualMoreMenu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import theme from '@/components/history/HistoryArchive.module.css';
import styles from '@/components/history/ChatHistoryArchive.module.css';

export default function ChatHistoryPage() {
  const [messages, setMessages] = useState<ChatHistoryMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { dialog, confirm, handleConfirm, handleCancel } = useConfirm();

  useEffect(() => {
    let active = true;
    apiFetch<MessagePage>('/api/messages')
      .then((page) => {
        if (active) {
          setMessages(page.messages);
          setHasMore(page.hasMore);
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadMore() {
    if (loading) return;
    setLoading(true);
    try {
      const page = await apiFetch<MessagePage>(`/api/messages?offset=${messages.length}`);
      setMessages((current) => [...current, ...page.messages]);
      setHasMore(page.hasMore);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }

  async function clearMessages() {
    if (
      !(await confirm({
        title: '清空聊天记录',
        message: '将删除当前账号的全部聊天消息，已收藏的解读记录仍可单独查看。',
        confirmLabel: '清空',
        cancelLabel: '取消',
        tone: 'danger',
      }))
    )
      return;
    setLoading(true);
    try {
      await apiFetch('/api/messages', { method: 'DELETE', body: JSON.stringify({ all: true }) });
      setMessages([]);
      setHasMore(false);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '删除失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <HistoryPageFrame
        variant="conversations"
        loading={loading}
        controls={
          <RitualMoreMenu
            label="聊天记录"
            triggerLabel="管理"
            className={theme.manage}
            actions={[
              {
                label: '清空聊天记录',
                icon: 'trash',
                disabled: loading || !messages.length,
                onSelect: clearMessages,
              },
            ]}
          />
        }
        error={
          error && (
            <p role="alert" className={theme.error}>
              {error}{' '}
              <button data-small-action="text" onClick={() => window.location.reload()}>
                重试
              </button>
            </p>
          )
        }
      >
        <ChatHistoryArchive messages={messages} />
        {loading && (
          <p role="status" className={styles.loading}>
            正在读取…
          </p>
        )}
        {!loading && !error && !messages.length && (
          <div className={theme.empty}>
            <p className={theme.english}>A New Conversation</p>
            <h2>还没有聊天记录</h2>
            <p>从一件想说的小事开始。</p>
            <Link href="/agent?new=1" className={theme.start}>
              开始聊天 →
            </Link>
          </div>
        )}
        {hasMore && (
          <button
            data-small-action="text"
            disabled={loading}
            onClick={loadMore}
            className={styles.loadMore}
          >
            加载更早记录
          </button>
        )}
      </HistoryPageFrame>
      <ConfirmDialog {...dialog} onConfirm={handleConfirm} onCancel={handleCancel} />
    </>
  );
}
