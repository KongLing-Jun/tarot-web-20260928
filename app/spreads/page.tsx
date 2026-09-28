'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SpreadSelector } from '@/components/drawing/SpreadSelector';
import { generalSpreads, readingScenes } from '@/lib/readingEntry';
import { getDefaultSpread, getSpreadById } from '@/lib/tarot/spreads';
import flow from '../reading/reading-flow.module.css';
import styles from './spreads.module.css';

export default function SpreadsPage() {
  const [spread, setSpread] = useState(getDefaultSpread);
  const router = useRouter();
  return (
    <div className={styles.page}>
      <header className={flow.spreadHeader}>
        <Link data-small-action="text" href="/">
          返回首页
        </Link>
      </header>
      <main id="main-content" className={`${flow.spread} ${styles.main}`}>
        <div className={flow.spreadPanel}>
          <SpreadSelector
            choices={generalSpreads}
            title="牌阵与视角"
            selectedSpread={spread}
            onSelect={setSpread}
            confirmLabel="选择此牌阵"
            onConfirm={() => router.push(`/reading?spread=${encodeURIComponent(spread.id)}`)}
          />
          <nav
            aria-label="场景专属牌阵"
            className="flex flex-wrap justify-center gap-6 py-8 text-gold"
          >
            {readingScenes.map((scene) => (
              <Link key={scene.id} href={`/reading?scene=${scene.id}`} data-small-action="text">
                {scene.title} · {getSpreadById(scene.spreadId)?.positions.length} 张
              </Link>
            ))}
          </nav>
        </div>
      </main>
    </div>
  );
}
