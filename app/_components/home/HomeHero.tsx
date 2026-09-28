import Image from 'next/image';
import { BRAND } from '@/lib/brand';
import Link from 'next/link';
import { LivingFox } from '@/components/effects/LivingFox';
import { ProductTour } from '@/components/onboarding/ProductTour';
import styles from '../../_styles/home/home-hero.module.css';
import transition from '@/components/layout/PageTransition.module.css';

export function HomeHero() {
  const characters = Array.from(BRAND.name);
  const titleLines =
    characters.length === 4
      ? [characters.slice(0, 2).join(''), characters.slice(2).join('')]
      : [BRAND.name];
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={styles.content}>
        <Image
          className={styles.cornerLeft}
          src="/brand/hero-corner.webp"
          width={114}
          height={120}
          alt=""
          aria-hidden
          unoptimized
        />
        <Image
          className={styles.cornerRight}
          src="/brand/hero-corner.webp"
          width={114}
          height={120}
          alt=""
          aria-hidden
          unoptimized
        />

        <p className={`${styles.eyebrow} ${transition.fade}`}>Tarot &amp; AI Reflection</p>

        <div className={`${styles.brand} ${transition.rise}`}>
          <div className={styles.wordmark}>
            <h1 id="home-title" className={styles.title} aria-label={BRAND.name}>
              {titleLines.map((line, index) => (
                <span key={index}>{line}</span>
              ))}
            </h1>
            <p className={styles.english} lang="en">
              {BRAND.englishTitle} Tarot
            </p>
          </div>
          <div className={styles.mascot} aria-hidden="true">
            <LivingFox />
          </div>
        </div>

        <p
          className={`${styles.description} ${transition.rise}`}
          style={{ animationDelay: '60ms' }}
        >
          {BRAND.description}
        </p>

        <div
          className={`${styles.actions} ${transition.actions}`}
          role="group"
          aria-label="开始探索"
        >
          <Link
            data-tour="conversation"
            href="/agent?new=1"
            className={`${styles.button} ${styles.primary}`}
          >
            <span>说说正在困扰你的事</span>
          </Link>
          <Link
            data-tour="manual"
            href="/reading"
            className={`${styles.button} ${styles.secondary}`}
          >
            自己选择牌阵
          </Link>
        </div>

        <ProductTour />

        <Image
          className={`${styles.divider} ${transition.fade}`}
          src="/brand/hero-divider.webp"
          width={1044}
          height={68}
          alt=""
          aria-hidden
          unoptimized
        />
      </div>
    </section>
  );
}
