import type { ReactNode } from 'react';
import Link from 'next/link';
import { MainNav } from '../layout/MainNav';
import { RitualIcon } from '../drawing/RitualScene';
import styles from './HistoryArchive.module.css';
import transition from '../layout/PageTransition.module.css';

export function HistoryPageFrame({
  children,
  controls,
  error,
  loading = false,
  variant = 'readings',
}: {
  children: ReactNode;
  controls?: ReactNode;
  error?: ReactNode;
  loading?: boolean;
  variant?: 'readings' | 'conversations';
}) {
  const conversations = variant === 'conversations';
  return (
    <div className={`${styles.page} ${conversations ? '' : styles.readings}`}>
      <header
        className={`${styles.header} ${conversations ? styles.conversationHeader : ''} ${loading ? '' : transition.fade}`}
      >
        <div className={styles.starlight} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        {conversations && (
          <Link href="/history" className={styles.returnLink}>
            <RitualIcon name="chevron-left" />
            轨迹
          </Link>
        )}
        <div className={styles.tools}>
          {conversations ? (
            <Link data-small-action="text" href="/agent?new=1" className={styles.tool}>
              ＋ 新聊天
            </Link>
          ) : (
            <Link data-small-action="text" href="/history/messages" className={styles.tool}>
              <RitualIcon name="message-circle" />
              聊天记录
            </Link>
          )}
          {controls}
          {loading && !controls && (
            <span className={`${styles.toolPlaceholder} skeleton-base`} aria-hidden="true" />
          )}
        </div>
        <h1>
          {conversations ? '对话' : '轨迹'}
          <span className={styles.titleRule} aria-hidden="true" />
        </h1>
        <p className={styles.english}>{conversations ? 'Conversations' : 'Reading Journey'}</p>
        <p className={styles.intro}>
          {conversations ? '留下的话，可以慢慢回看。' : '回看问题，也看见自己的变化。'}
        </p>
      </header>
      <main
        id="main-content"
        aria-busy={loading}
        className={`${styles.main} ${loading ? '' : transition.rise}`}
      >
        {error}
        {children}
      </main>
      <div className={styles.navigation}>
        <MainNav activePath="/history" />
      </div>
    </div>
  );
}
