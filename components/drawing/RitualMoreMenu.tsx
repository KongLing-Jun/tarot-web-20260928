'use client';

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { RitualIcon } from './RitualScene';
import styles from './RitualMoreMenu.module.css';

interface RitualMoreMenuProps {
  label: string;
  triggerLabel?: string;
  className?: string;
  actions: {
    label: string;
    icon: ComponentProps<typeof RitualIcon>['name'];
    disabled?: boolean;
    onSelect: () => void;
  }[];
}

export function RitualMoreMenu({
  label,
  actions,
  triggerLabel,
  className = '',
}: RitualMoreMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuArea = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: Event) => {
      if (!menuArea.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    // 移动端可能先失焦（relatedTarget 为空）再派发 click；等实际焦点落到外部才关闭。
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);
  return (
    <div ref={menuArea} className={`${styles.more} ${className}`}>
      <button
        data-small-action="surface"
        ref={trigger}
        type="button"
        className={styles.menuTrigger}
        aria-label={triggerLabel ?? `${label}更多操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((value) => !value)}
      >
        {triggerLabel ? (
          <>
            <RitualIcon name="settings" />
            <span>{triggerLabel}</span>
          </>
        ) : (
          <>
            <span>更多</span>
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </>
        )}
      </button>
      {menuOpen && (
        <div
          ref={menu}
          id={menuId}
          className={styles.menu}
          role="menu"
          aria-label={`${label}操作`}
          // Safari 触摸按钮时可能把焦点移给外层 section，导致 click 前菜单关闭。
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
            );
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}
        >
          {actions.map((action) => (
            <button
              data-small-action="menu"
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                setMenuOpen(false);
                trigger.current?.focus();
                action.onSelect();
              }}
            >
              <RitualIcon name={action.icon} />
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
