'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Reading } from '@/lib/tarot/types';
import { getReadingById, deleteReadings } from '@/lib/readingStorage';
import { HistoryReadingReport } from '@/components/history/HistoryReadingReport';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { ReadingDetailSkeleton } from '@/components/common/Skeletons';
import report from '@/components/reading/ReadingReport.module.css';
import styles from '@/components/history/HistoryReadingReport.module.css';

export default function ReadingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  const { dialog, confirm, handleConfirm, handleCancel } = useConfirm();

  useEffect(() => {
    let active = true;
    params
      .then((resolved) => getReadingById(resolved.id))
      .then((value) => {
        if (active) setReading(value || null);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : '读取失败');
      })
      .finally(() => {
        if (active) setIsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [params, attempt]);

  const handleDelete = async () => {
    if (!reading) return;
    const ok = await confirm({
      title: '删 除 记 录',
      message: '将删除这条解读记录，此操作不可撤回。',
      confirmLabel: '删 除',
      cancelLabel: '保 留',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteReadings([reading.id]);
    } catch (error) {
      setError(error instanceof Error ? error.message : '删除失败');
      return;
    }
    router.push('/history');
  };

  if (!isLoaded) return <ReadingDetailSkeleton />;
  if (!reading)
    return (
      <div className={report.page}>
        <header className={report.header}>
          <Link
            data-small-action="icon"
            data-small-icon="back"
            href="/history"
            className={styles.back}
          >
            <span aria-hidden="true">〈</span>返回轨迹
          </Link>
        </header>
        <main id="main-content" className={report.main}>
          <section className={styles.state}>
            <h1>{error ? '暂时无法读取记录' : '记录不存在'}</h1>
            <p role={error ? 'alert' : undefined}>
              {error || '未找到这条解读记录，它可能已被删除。'}
            </p>
            {error && (
              <button
                data-small-action="text"
                type="button"
                onClick={() => {
                  setError('');
                  setIsLoaded(false);
                  setAttempt((value) => value + 1);
                }}
              >
                重试
              </button>
            )}
          </section>
        </main>
      </div>
    );

  return (
    <>
      <HistoryReadingReport reading={reading} error={error} onDelete={handleDelete} />
      <ConfirmDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        message={dialog.message}
        confirmLabel={dialog.confirmLabel}
        cancelLabel={dialog.cancelLabel}
        tone={dialog.tone}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
