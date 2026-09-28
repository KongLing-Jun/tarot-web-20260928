'use client';

import { type ReactNode } from 'react';
import { BRAND } from '@/lib/brand';
import { LivingFox } from '../effects/LivingFox';
import styles from './RitualScene.module.css';

export function RitualHeader({
  title,
  question,
  spreadName,
  count,
}: {
  title: string;
  question: string;
  spreadName: string;
  count: number;
}) {
  return (
    <>
      <div className={styles.heading} data-ritual-part="heading">
        <h2>{title}</h2>
        <p>{BRAND.name}</p>
      </div>
      <div className={styles.intro} data-ritual-part="intro">
        <div className={styles.context} data-ritual-part="context">
          <p className={styles.question} data-ritual-part="question">
            {question}
          </p>
          <p className={styles.meta}>
            {spreadName} · 共 {count} 张
          </p>
        </div>
        <div className={styles.fox} data-ritual-part="fox" aria-hidden="true">
          <LivingFox />
        </div>
      </div>
    </>
  );
}

export function RitualIcon({
  name,
}: {
  name:
    | 'arrow-back-up'
    | 'feather'
    | 'cards'
    | 'arrows-shuffle'
    | 'chevron-left'
    | 'chevron-right'
    | 'message-circle'
    | 'settings'
    | 'moon-stars'
    | 'compass'
    | 'calendar'
    | 'trash';
}) {
  return (
    <span
      aria-hidden
      className={styles.icon}
      style={{
        maskImage: `url('/brand/ritual-theme/icons/${name}.svg')`,
        WebkitMaskImage: `url('/brand/ritual-theme/icons/${name}.svg')`,
      }}
    />
  );
}

export function RitualDock({ children }: { children: ReactNode }) {
  return <div className={styles.dock}>{children}</div>;
}
