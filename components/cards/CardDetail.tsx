'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { useUser } from '../session/UserSession';
import { TarotCard } from '@/lib/tarot/types';
import styles from './CardLibrary.module.css';

interface CardDetailProps {
  card: TarotCard;
}

const SUIT_META = {
  wands: { name: '权杖', element: '火' },
  cups: { name: '圣杯', element: '水' },
  swords: { name: '宝剑', element: '风' },
  pentacles: { name: '星币', element: '土' },
};

export function CardDetail({ card }: CardDetailProps) {
  const { user, loading, setFavorite } = useUser();
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [favoriteNotice, setFavoriteNotice] = useState('');
  const favorited = user?.favoriteCardIds.includes(card.id) ?? false;
  const favoriteDisabled = loading || saving;

  useEffect(() => {
    if (!favoriteNotice) return;
    const timer = window.setTimeout(() => setFavoriteNotice(''), 2000);
    return () => window.clearTimeout(timer);
  }, [favoriteNotice]);

  async function toggleFavorite() {
    if (saveLock.current || loading) return;
    setFavoriteError('');
    setFavoriteNotice('');
    if (!user) {
      setFavoriteError('请登录后收藏喜欢的牌');
      return;
    }
    const next = !favorited;
    saveLock.current = true;
    setSaving(true);
    try {
      await setFavorite(card.id, next);
      setFavoriteNotice(next ? `已收藏「${card.nameCn}」` : `已取消收藏「${card.nameCn}」`);
    } catch (error) {
      setFavoriteError(error instanceof Error ? error.message : '收藏保存失败，请重试');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  const suitMeta = card.suit ? SUIT_META[card.suit] : null;
  const typeLabel = card.type === 'major' ? '大阿卡纳' : (suitMeta?.name ?? '小阿卡纳');

  return (
    <div className={`${styles.page} ${styles.detailPage}`}>
      <main id="main-content" className={styles.detailPanel} aria-labelledby="card-title">
        <header className={styles.detailHeader}>
          <Link
            href="/library"
            data-small-action="text"
            aria-label="返回牌典"
            className={styles.detailBack}
          >
            <span className={styles.arrowIcon} aria-hidden />
            <span>返回</span>
          </Link>
          <div className={styles.detailHeaderDescription}>
            <span className={styles.starIcon} aria-hidden />
            <span>{typeLabel}</span>
            <span className={styles.detailHeaderEnglish}>Card Meanings</span>
          </div>
        </header>
        <div className={styles.detailBody}>
          <div className={styles.detailHero}>
            <CardFace key={card.id} card={card} />
            <div className={styles.detailIdentity}>
              <p className={styles.cardNumber}>
                No. {String(card.number).padStart(2, '0')}
                {suitMeta && <span> · {suitMeta.element}元素</span>}
              </p>
              <h1 id="card-title">{card.nameCn}</h1>
              <p className={styles.cardEnglish}>{card.name}</p>
              <Image
                src="/brand/profile-theme/divider-v2.webp"
                width={240}
                height={24}
                alt=""
                aria-hidden
                className={styles.identityDivider}
              />
              <p className={styles.detailLead}>{card.keywords.upright.slice(0, 3).join(' · ')}</p>
              <button
                data-small-action="text"
                type="button"
                onClick={() => void toggleFavorite()}
                disabled={favoriteDisabled}
                aria-pressed={favorited}
                className={styles.detailFavorite}
              >
                <span className={styles.bookmarkIcon} aria-hidden />
                {favoriteDisabled ? '请稍候…' : favorited ? '取消收藏' : '收藏这张牌'}
              </button>
            </div>
          </div>
          {favoriteError && (
            <p role="alert" className={styles.message}>
              {favoriteError}
            </p>
          )}
          {favoriteNotice && (
            <p role="status" className={styles.message}>
              {favoriteNotice}
            </p>
          )}
          <div className={styles.meanings}>
            <Meaning
              title="正位"
              english="Upright"
              keywords={card.keywords.upright}
              meaning={card.meaning.upright}
            />
            <Meaning
              title="逆位"
              english="Reversed"
              keywords={card.keywords.reversed}
              meaning={card.meaning.reversed}
              reversed
            />
          </div>
          <footer className={styles.detailFooter}>
            <Image
              src="/brand/profile-theme/divider-v2.webp"
              width={240}
              height={24}
              alt=""
              aria-hidden
            />
            <p><span className="brand-name">{BRAND.name}</span></p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Meaning({
  title,
  english,
  keywords,
  meaning,
  reversed = false,
}: {
  title: string;
  english: string;
  keywords: string[];
  meaning: string;
  reversed?: boolean;
}) {
  return (
    <section
      className={`${styles.meaning} ${reversed ? styles.reversed : ''}`}
      aria-label={`${title}牌义`}
    >
      <div className={styles.meaningHeading}>
        <h2>{title}</h2>
        <span>{english}</span>
      </div>
      <ul className={styles.meaningKeywords} aria-label={`${title}关键词`}>
        {keywords.map((word) => (
          <li key={word}>{word}</li>
        ))}
      </ul>
      <p className={styles.meaningText}>{meaning}</p>
    </section>
  );
}

function CardFace({ card }: { card: TarotCard }) {
  const [imageError, setImageError] = useState(false);
  return (
    <div className={styles.detailFace}>
      {imageError ? (
        <div className={styles.imageFallback}>
          {card.nameCn}
          <small>牌面暂时无法加载</small>
        </div>
      ) : (
        <Image
          unoptimized
          src={card.image}
          alt={card.name}
          fill
          sizes="(min-width: 768px) 180px, 128px"
          onError={() => setImageError(true)}
        />
      )}
    </div>
  );
}
