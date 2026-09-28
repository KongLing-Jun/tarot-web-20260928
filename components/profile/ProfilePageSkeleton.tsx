import { ProfilePageFrame } from './ProfilePageFrame';
import styles from '@/app/profile/profile.module.css';
import transition from '../layout/PageTransition.module.css';

export function ProfileContentSkeleton() {
  return (
    <>
      <div role="status" aria-label="正在载入个人资料" className="sr-only" />
      <div className={`${styles.identity} ${transition.fade}`} aria-hidden="true">
        <div className={styles.identityRow}>
          <div className={styles.avatarChange}>
            <div className={`${styles.avatar} skeleton-base`} />
            <div className="skeleton-base w-12 h-4" />
          </div>
          <div className={styles.identityDetails}>
            <div className="skeleton-base w-32 h-8 mb-2" />
            <div className="skeleton-base w-24 h-4" />
          </div>
        </div>
        <div className={styles.stats}>
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className={styles.stat}>
              <div className="skeleton-base w-16 h-4 mx-auto" />
              <div className="skeleton-base w-8 h-8 mx-auto mt-1" />
            </div>
          ))}
        </div>
      </div>
      <div className={`${styles.journey} ${transition.fade}`} aria-hidden="true">
        <div className={styles.journeyHeading}>
          <div className="skeleton-base w-24 h-6" />
        </div>
        <div className={styles.journeyList}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.journeyItem}>
              <div className={styles.journeyLink}>
                <div className={`${styles.journeyArt} skeleton-base`} />
                <div className={styles.journeyText}>
                  <div className="skeleton-base w-24 h-5 mb-2" />
                  <div className="skeleton-base w-3/4 h-4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.footer} aria-hidden="true">
        <div className="skeleton-base w-32 h-8 mx-auto" />
      </div>
    </>
  );
}

export function ProfilePageSkeleton() {
  return (
    <ProfilePageFrame loading>
      <ProfileContentSkeleton />
    </ProfilePageFrame>
  );
}
