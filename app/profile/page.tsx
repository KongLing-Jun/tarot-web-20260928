'use client';

import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ProfilePageFrame } from '@/components/profile/ProfilePageFrame';
import { ProfileContentSkeleton } from '@/components/profile/ProfilePageSkeleton';
import { useUser } from '@/components/session/UserSession';
import { ProfileEditor } from '@/components/profile/ProfileEditor';
import { companionDays } from '@/lib/auth/profile';
import styles from './profile.module.css';
import transition from '@/components/layout/PageTransition.module.css';

const JOURNEY_LINKS = [
  {
    art: 'journal',
    title: '聊天记录',
    subtitle: '查看已保存的提问与回复',
    href: '/history/messages',
  },
  { art: 'reading', title: '解读记录', subtitle: '回看你提出的问题与解读', href: '/history' },
  { art: 'daily', title: '每日一牌', subtitle: '留给今天的片刻觉察', href: '/daily' },
  { art: 'atlas', title: '我的牌典', subtitle: '认识七十八张牌中的自己', href: '/library' },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, error, refreshSession } = useUser();
  const initialLoading = loading && !user;
  const nickname = user?.nickname || '星旅人';
  const stats = [
    { label: '占卜次数', value: user?.readingCount ?? 0, unit: '次占卜' },
    { label: '相伴天数', value: companionDays(user?.createdAt), unit: '天相伴' },
    { label: '珍藏牌面', value: user?.favoriteCardIds?.length ?? 0, unit: '张珍藏牌面' },
  ];
  return (
    <ProfilePageFrame loading={initialLoading}>
      {initialLoading ? (
        <ProfileContentSkeleton />
      ) : (
        <>
          <section aria-label="个人资料" className={`${styles.identity} ${transition.rise}`}>
            <div className={styles.identityRow}>
              <button
                type="button"
                onClick={() => router.push('/profile/avatar')}
                disabled={!user}
                aria-label="更换头像"
                className={styles.avatarChange}
              >
                <span className={styles.avatar}>
                  <Image
                    unoptimized
                    src={user?.avatarUrl || '/avatars/default.svg'}
                    width={96}
                    height={96}
                    alt="用户头像"
                    className={styles.avatarImage}
                  />
                </span>
                <span className={styles.avatarLabel} data-small-affordance>
                  更换头像
                </span>
              </button>
              <div className={styles.identityDetails}>
                {user ? (
                  <ProfileEditor user={user} loading={loading} density="compact" />
                ) : (
                  <h2 className={styles.guestName}>{nickname}</h2>
                )}
              </div>
            </div>
            {(loading || !user || error) && (
              <div aria-busy={loading} className={styles.session}>
                {loading ? (
                  <p aria-live="polite" className={styles.message}>
                    正在检查登录状态…
                  </p>
                ) : error ? (
                  <p role="alert" className={styles.message}>
                    {error}
                  </p>
                ) : (
                  !user && (
                    <>
                      <p className={styles.sessionState}>尚未登录</p>
                      <p className={styles.message}>
                        网页会自动使用游客账号；请重试登录，小程序中也可关闭后重新进入。
                      </p>
                    </>
                  )
                )}
                {(!user || error) && (
                  <button
                    data-small-action="text"
                    type="button"
                    className={styles.retry}
                    disabled={loading}
                    onClick={refreshSession}
                  >
                    重新检查登录
                  </button>
                )}
              </div>
            )}
            {user?.isGuest && (
              <p className={styles.message}>
                游客凭证保存在当前浏览器，请勿清除网站数据，以免无法找回账号。
              </p>
            )}
            <dl className={styles.stats}>
              {stats.map(({ label, value, unit }) => (
                <div key={label} className={styles.stat}>
                  <dt className={styles.statLabel}>{label}</dt>
                  <dd className={styles.statValue} aria-label={`${value} ${unit}`}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section
            aria-labelledby="journey-heading"
            className={`${styles.journey} ${transition.actions}`}
          >
            <div className={styles.journeyHeading}>
              <h2 id="journey-heading" className={styles.sectionTitle}>
                我的旅程
              </h2>
              <span className={styles.headingRule} aria-hidden />
              <span className={styles.english} aria-hidden>
                Journey
              </span>
            </div>
            <ul className={styles.journeyList}>
              {JOURNEY_LINKS.map(({ art, title, subtitle, href }) => (
                <li key={href} className={styles.journeyItem}>
                  <Link href={href} className={styles.journeyLink}>
                    <Image
                      src={`/brand/profile-theme/${art}.webp`}
                      width={240}
                      height={200}
                      alt=""
                      aria-hidden
                      sizes="(max-width: 767px) 80px, 100px"
                      className={styles.journeyArt}
                    />
                    <div className={styles.journeyText}>
                      <h3 className={styles.journeyTitle}>{title}</h3>
                      <p className={styles.journeySubtitle}>{subtitle}</p>
                    </div>
                    <Image
                      src="/brand/profile-theme/arrow-v2.webp"
                      width={38}
                      height={16}
                      alt=""
                      aria-hidden
                      className={styles.arrow}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <footer className={`${styles.footer} ${transition.fade}`}>
            <Image
              src="/brand/profile-theme/divider-v2.webp"
              alt=""
              aria-hidden
              width={240}
              height={24}
              className={styles.footerDivider}
            />
            <p className={styles.brand}>{BRAND.name}</p>
            <p className={styles.footerCopy}>{BRAND.tagline}</p>
          </footer>
        </>
      )}
    </ProfilePageFrame>
  );
}
