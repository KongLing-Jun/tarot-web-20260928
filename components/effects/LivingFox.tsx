import Image from 'next/image';
import { BlinkingEyes } from './BlinkingEyes';
import styles from './LivingFox.module.css';

export function LivingFox() {
  return (
    <div className={styles.fox} aria-hidden="true">
      <Image
        className={styles.image}
        src="/brand/miying-fox.webp"
        width={650}
        height={445}
        sizes="(min-width: 768px) 360px, 62vw"
        alt=""
        priority
        unoptimized
      />
      <BlinkingEyes />
    </div>
  );
}
