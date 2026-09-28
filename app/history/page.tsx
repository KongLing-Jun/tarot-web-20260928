'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Reading } from '@/lib/tarot/types';
import { getReadings, deleteReadings, clearAll } from '@/lib/readingStorage';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConfirm } from '@/hooks/useConfirm';
import { HistoryTimelineSkeleton } from '@/components/common/Skeletons';
import { HistoryPageFrame } from '@/components/history/HistoryPageFrame';
import { HistoryArchive } from '@/components/history/HistoryArchive';
import { RitualMoreMenu } from '@/components/drawing/RitualMoreMenu';
import styles from '@/components/history/HistoryArchive.module.css';

export default function HistoryPage() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState('');
  const { dialog, confirm, handleConfirm, handleCancel } = useConfirm();

  useEffect(() => {
    let active = true;
    getReadings()
      .then((readings) => {
        if (active) setReadings(readings);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setIsLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleSelect = (id: string): void => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteSelected = async (): Promise<void> => {
    if (selectedIds.size === 0) return;

    const ok = await confirm({
      title: '删 除 选 中',
      message: `将 删 除 选 中 的 ${selectedIds.size} 条 记 录 ， 此 举 不 可 撤 回 。`,
      confirmLabel: '删 除',
      cancelLabel: '保 留',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await deleteReadings(Array.from(selectedIds));
      setReadings(await getReadings());
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '删除失败');
      return;
    }
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  const handleClearAll = async (): Promise<void> => {
    const ok = await confirm({
      title: '清 空 所 有',
      message: '将删除当前账号的全部解读记录，此操作不可撤回。',
      confirmLabel: '清 空',
      cancelLabel: '取 消',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await clearAll();
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : '清空失败');
      return;
    }
    setReadings([]);
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  return (
    <>
      <HistoryPageFrame
        loading={!isLoaded}
        error={
          error && (
            <p role="alert" className={styles.error}>
              {error}{' '}
              <button data-small-action="text" onClick={() => window.location.reload()}>
                重试
              </button>
            </p>
          )
        }
        controls={
          isLoaded && (
            <RitualMoreMenu
              label="轨迹"
              triggerLabel="管理"
              className={styles.manage}
              actions={[
                {
                  label: '选择记录',
                  icon: 'cards',
                  disabled: readings.length === 0,
                  onSelect: () => setIsSelectionMode(true),
                },
                {
                  label: '清空记录',
                  icon: 'arrows-shuffle',
                  disabled: readings.length === 0,
                  onSelect: handleClearAll,
                },
              ]}
            />
          )
        }
      >
        {isSelectionMode && (
          <div className={styles.selectionBar} role="region" aria-label="记录选择">
            <span role="status">已选 {selectedIds.size} 条</span>
            <button
              data-small-action="text"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedIds(new Set());
              }}
            >
              取消
            </button>
            <button
              data-small-action="text"
              disabled={selectedIds.size === 0}
              onClick={handleDeleteSelected}
            >
              删除所选
            </button>
          </div>
        )}
        {!isLoaded ? (
          <HistoryTimelineSkeleton />
        ) : readings.length === 0 ? (
          !error && (
            <div className={styles.empty}>
              <p className={styles.english}>Your First Reading</p>
              <h2>这里还没有解读记录</h2>
              <p>带着一个问题开始，之后可以在这里回看。</p>
              <Link href="/reading" className={styles.start}>
                开始探索 →
              </Link>
            </div>
          )
        ) : (
          <HistoryArchive
            readings={readings}
            isSelectionMode={isSelectionMode}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
          />
        )}
      </HistoryPageFrame>
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
