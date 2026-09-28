'use client';

import type { IntentSnapshot } from '@/lib/intent/types';
import styles from './QuestionWelcome.module.css';

interface Props {
  busy: boolean;
  error: string | null;
  snapshot: IntentSnapshot | null;
}

export function IntentFeedback({ busy, error, snapshot }: Props) {
  if (busy) {
    return (
      <p className={styles.hint} role="status">
        正在梳理你想讨论的问题…
      </p>
    );
  }
  if (error) {
    return (
      <div className={styles.hint} role="alert">
        <p>{error}</p>
        <p>请再次提交问题以重试。</p>
      </div>
    );
  }
  if (snapshot?.plan.mode === 'clarify' && snapshot.plan.clarification) {
    return (
      <div className={styles.hint} role="status">
        <p>{snapshot.plan.clarification}</p>
        <p>请在原输入中补充，然后再次提交。</p>
      </div>
    );
  }
  return null;
}
