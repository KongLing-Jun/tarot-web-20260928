'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { TarotCard } from '@/lib/tarot/types';
import { allCards, majorArcanaCards, getCardsBySuit } from '@/lib/tarot/cards';
import { MainNav } from '@/components/layout/MainNav';
import { useUser } from '@/components/session/UserSession';
import styles from '@/components/cards/CardLibrary.module.css';
import transition from '@/components/layout/PageTransition.module.css';

const SECTIONS = [
  { key: 'major', title: '大阿卡纳', english: 'Major Arcana', cards: majorArcanaCards },
  { key: 'wands', title: '权杖', english: 'Wands · 火', cards: getCardsBySuit('wands') },
  { key: 'cups', title: '圣杯', english: 'Cups · 水', cards: getCardsBySuit('cups') },
  { key: 'swords', title: '宝剑', english: 'Swords · 风', cards: getCardsBySuit('swords') },
  {
    key: 'pentacles',
    title: '星币',
    english: 'Pentacles · 土',
    cards: getCardsBySuit('pentacles'),
  },
] as const;
type FilterKey = 'all' | (typeof SECTIONS)[number]['key'];
const FILTER_TABS = [
  { key: 'all' as const, title: '全部', count: allCards.length },
  ...SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    count: section.cards.length,
  })),
];

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 大阿卡纳沿用牌面罗马数字，愚者保留 0；小阿卡纳使用数字。 */
function catalogNumber(card: TarotCard): string {
  if (card.type !== 'major') return String(card.number).padStart(2, '0');
  if (card.number === 0) return '0';
  let remaining = card.number;
  let result = '';
  for (const [numeral, glyph] of ROMAN_NUMERALS) {
    while (remaining >= numeral) {
      result += glyph;
      remaining -= numeral;
    }
  }
  return result;
}

export default function LibraryPage() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const { user, loading, error: sessionError, retryLogin, setFavorite } = useUser();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [favoriteError, setFavoriteError] = useState('');
  const [notice, setNotice] = useState('');
  const favorites = new Set(user?.favoriteCardIds ?? []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 1000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function toggleFavorite(card: TarotCard) {
    if (saveLock.current) return;
    setFavoriteError('');
    setNotice('');
    if (!user) {
      setFavoriteError('请登录后收藏喜欢的牌');
      return;
    }
    const next = !favorites.has(card.id);
    saveLock.current = true;
    setSaving(true);
    try {
      await setFavorite(card.id, next);
      setNotice(next ? `已收藏「${card.nameCn}」` : `已取消收藏「${card.nameCn}」`);
    } catch (error) {
      setFavoriteError(error instanceof Error ? error.message : '收藏保存失败，请重试');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  const matchingSections = SECTIONS.filter((section) => filter === 'all' || section.key === filter);
  const sections = favoritesOnly
    ? matchingSections
        .map((section) => ({
          ...section,
          cards: section.cards.filter((card) => favorites.has(card.id)),
        }))
        .filter((section) => section.cards.length)
    : matchingSections;
  const totalCount = sections.reduce((sum, section) => sum + section.cards.length, 0);

  return (
    <div className={styles.page}>
      <main id="main-content" className={styles.main}>
        <header className={`${styles.header} ${transition.fade}`}>
          <Image
            src="/brand/profile-theme/moon-cloud.webp"
            alt=""
            aria-hidden
            width={360}
            height={320}
            className={styles.moon}
          />
          <h1 className={styles.pageTitle}>
            牌典
            <span className={styles.titleRule} aria-hidden />
          </h1>
          <p className={styles.english}>Tarot Library</p>
          <p className={styles.intro}>七十八张牌，七十八种看见自己的方式。</p>
          <div className={styles.headerFoot}>
            <button
              data-small-action="text"
              type="button"
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((value) => !value)}
              className={styles.collectionButton}
            >
              <span className={styles.starIcon} aria-hidden />
              我的收藏 {favorites.size}
              <span className={styles.chevronIcon} aria-hidden />
            </button>
            <p className={styles.headerNote} aria-hidden>
              在牌的光下，
              <br />
              看见更真实的自己。
            </p>
          </div>
        </header>
        {sessionError && (
          <p role="alert" className={styles.message}>
            {sessionError}
          </p>
        )}
        <div className={`${styles.filters} ${transition.fade}`} aria-label="牌典分类">
          {FILTER_TABS.map((tab) => (
            <button
              data-small-action="tab"
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              aria-pressed={filter === tab.key}
            >
              {tab.title}
              <span>{tab.count}</span>
            </button>
          ))}
        </div>
        <div
          key={`${filter}-${favoritesOnly}`}
          className={`${styles.collections} ${transition.rise}`}
        >
          {favoritesOnly && !sections.length && (
            <div className={styles.empty}>
              <Image src="/brand/profile-theme/atlas.webp" alt="" width={120} height={100} />
              <p>
                {loading
                  ? '正在读取收藏…'
                  : sessionError
                    ? '暂时无法读取收藏，请重试。'
                    : !user
                      ? '登录后，喜欢的牌会随账号保存。'
                      : filter === 'all'
                        ? '还没有收藏，点击牌面旁的书签即可珍藏。'
                        : '这个分类还没有收藏的牌。'}
              </p>
              {!loading && (!user || sessionError) && (
                <button data-small-action="text" type="button" onClick={retryLogin}>
                  重新检查登录
                </button>
              )}
              <button
                data-small-action="text"
                type="button"
                onClick={() => {
                  setFavoritesOnly(false);
                  setFilter('all');
                }}
              >
                浏览全部牌面
              </button>
            </div>
          )}
          {sections.map((section, sectionIndex) => (
            <section key={section.key} aria-labelledby={`section-${section.key}`}>
              <div className={styles.sectionHeading}>
                <h2 id={`section-${section.key}`}>
                  {section.title}
                  <span> · {section.cards.length}张</span>
                </h2>
                <span className={styles.sectionAside} aria-hidden>
                  {sectionIndex === 0 ? '月下索引' : section.english}
                </span>
              </div>
              <ul className={styles.cardList}>
                {section.cards.map((card, cardIndex) => (
                  <CardEntry
                    key={card.id}
                    card={card}
                    catalogNo={catalogNumber(card)}
                    eager={sectionIndex === 0 && cardIndex < 3}
                    favorited={favorites.has(card.id)}
                    favoriteDisabled={loading || saving}
                    onFavorite={() => void toggleFavorite(card)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <footer className={styles.footer}>
          <Image
            src="/brand/profile-theme/divider-v2.webp"
            width={240}
            height={24}
            alt=""
            aria-hidden
          />
          <p aria-live="polite">
            共 {totalCount} 张牌 · <span className="brand-name">{BRAND.name}</span>
          </p>
        </footer>
      </main>
      {(favoriteError || notice) && (
        <div className={styles.toast}>
          <p role={favoriteError ? 'alert' : 'status'}>{favoriteError || notice}</p>
          <button
            data-small-action="icon"
            data-small-icon="close"
            type="button"
            aria-label="关闭收藏提示"
            onClick={() => {
              setFavoriteError('');
              setNotice('');
            }}
          >
            <span className={styles.closeIcon} aria-hidden />
          </button>
        </div>
      )}
      <div className={styles.navigation}>
        <MainNav activePath="/library" />
      </div>
    </div>
  );
}

interface CardEntryProps {
  card: TarotCard;
  catalogNo: string;
  eager: boolean;
  favorited: boolean;
  favoriteDisabled: boolean;
  onFavorite: () => void;
}

function CardEntry({
  card,
  catalogNo,
  eager,
  favorited,
  favoriteDisabled,
  onFavorite,
}: CardEntryProps) {
  const [imageError, setImageError] = useState(false);
  return (
    <li className={styles.entry}>
      <Link
        href={`/library/${card.id}`}
        prefetch={false}
        aria-label={`查看${card.nameCn}`}
        className={styles.entryMain}
      >
        <span className={styles.thumbnail}>
          {imageError ? (
            <span className={styles.imageFallback}>
              {card.nameCn}
              <small>牌面暂时无法加载</small>
            </span>
          ) : (
            <Image
              unoptimized
              src={card.image}
              alt={`${card.nameCn} ${card.name}`}
              fill
              sizes="(min-width: 768px) 112px, 80px"
              loading={eager ? 'eager' : 'lazy'}
              onError={() => setImageError(true)}
            />
          )}
        </span>
        <span className={styles.entryText}>
          <span className={styles.cardTitle}>
            <span>{catalogNo}</span>
            {card.nameCn}
          </span>
          <span className={styles.cardEnglish}>{card.name}</span>
          <span className={styles.keywords}>{card.keywords.upright.slice(0, 3).join(' · ')}</span>
          <span className={styles.summary}>{card.meaning.upright}</span>
          <span className={styles.readLink}>
            查看牌义
            <span className={styles.arrowIcon} aria-hidden />
          </span>
        </span>
      </Link>
      <button
        data-small-action="icon"
        type="button"
        onClick={onFavorite}
        disabled={favoriteDisabled}
        aria-pressed={favorited}
        aria-label={`${favorited ? '取消收藏' : '收藏'}${card.nameCn}`}
        className={styles.favoriteButton}
      >
        <span className={styles.bookmarkIcon} aria-hidden />
      </button>
    </li>
  );
}
