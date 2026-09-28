import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import tourStyles from '@/components/onboarding/ProductTour.module.css';
import { MainNav } from '../layout/MainNav';
import styles from '@/app/profile/profile.module.css';
import transition from '../layout/PageTransition.module.css';

export function ProfilePageFrame({
  children,
  loading = false,
}: {
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className={styles.surface}>
      <MainNav activePath="/profile" />
      <main id="main-content" aria-busy={loading} className={styles.main}>
        <div className={styles.content}>
          <Image
            src="/brand/profile-theme/moon-cloud.webp"
            alt=""
            aria-hidden
            width={333}
            height={277}
            sizes="(max-width: 767px) 170px, 230px"
            className={styles.moon}
          />
          <header className={`${styles.header} ${loading ? '' : transition.fade}`}>
            <div className={styles.titleGroup}>
              <h1 className={styles.title}>我的</h1>
              <p lang="en" className={styles.subtitle}>
                My Place
              </p>
            </div>
            <p className={styles.intro}>留一处属于自己的角落，回看每一次思考。</p>
            <Link href="/?tour=welcome" className={tourStyles.replay}>
              新手指引 · 再看一次
            </Link>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
