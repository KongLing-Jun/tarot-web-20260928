import Image from 'next/image';
import Link from 'next/link';
import { readingScenes } from '@/lib/readingEntry';
import { getSpreadById } from '@/lib/tarot/spreads';
import styles from '../../_styles/home/home-scenes.module.css';

export function HomeScenes() {
  return (
    <section className={styles.section} aria-labelledby="home-scenes-title">
      <div className={styles.inner}>
        <header className={styles.heading}>
          <h2 id="home-scenes-title">场景占卜</h2>
          <p>选一个主题，先说说你的情况。</p>
        </header>
        <div className={styles.grid}>
          {readingScenes.map((scene) => (
            <Link key={scene.id} href={`/reading?scene=${scene.id}`} className={styles.scene}>
              <Image
                src={`/brand/scenes/${scene.id}.webp`}
                alt=""
                width={400}
                height={400}
                className={styles.art}
                unoptimized
              />
              <h3>{scene.title}</h3>
              <p>{scene.description}</p>
              <small>
                {getSpreadById(scene.spreadId)?.nameCn} ·{' '}
                {getSpreadById(scene.spreadId)?.positions.length} 张
              </small>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
