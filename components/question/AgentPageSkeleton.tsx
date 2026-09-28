import Link from 'next/link';
import { MainNav } from '../layout/MainNav';
import styles from './QuestionWelcome.module.css';
import transition from '../layout/PageTransition.module.css';

/** 路由和登录等待使用同一布局，导航始终留在原位。 */
export function AgentPageSkeleton() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          data-small-action="icon"
          data-small-icon="back"
          href="/"
          aria-label="返回首页"
          className={styles.back}
        >
          <span aria-hidden="true">〈</span>
        </Link>
        <Link data-small-action="text" href="/history">
          轨迹
        </Link>
      </header>
      <main
        id="main-content"
        aria-busy="true"
        aria-label="正在载入对话"
        className={`${styles.main} ${transition.fade}`}
      >
        <div className={styles.sanctuary} aria-hidden="true">
          <div className={styles.intro}>
            <div className="skeleton-base w-32 h-9 mb-4" />
            <div className="skeleton-base w-52 h-9 mb-5" />
            <div className="skeleton-base w-48 h-4" />
          </div>
          <div className={styles.writing}>
            <div className="skeleton-base w-20 h-5" />
            <div className={`skeleton-base w-full ${styles.inputSkeleton}`} />
            <div className={styles.inputFeedback} />
          </div>
        </div>
        <div className={styles.actions} aria-hidden="true">
          <div className={styles.aidRow}>
            <div className="skeleton-base w-2/3 h-5" />
          </div>
          <div className={styles.aidRow}>
            <div className="skeleton-base w-3/4 h-5" />
          </div>
          <div className="skeleton-base w-full h-[3.25rem] mt-[17px]" />
          <div className="skeleton-base w-32 h-3 mx-auto mt-3" />
        </div>
      </main>
      <div className={styles.nav} style={{ bottom: 0 }}>
        <MainNav activePath="/agent" />
      </div>
    </div>
  );
}
