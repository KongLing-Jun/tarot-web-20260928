import Link from 'next/link';
import type { MouseEventHandler } from 'react';
import { RitualIcon } from '../drawing/RitualScene';

const NAV_ITEMS = [
  { href: '/', label: '首页', icon: 'star' },
  { href: '/agent', label: '对话', icon: 'message' },
  { href: '/daily', label: '今日', icon: 'sun' },
  { href: '/library', label: '牌典', icon: 'cards' },
  { href: '/history', label: '轨迹', icon: 'orbit' },
  { href: '/profile', label: '我的', icon: 'profile' },
];

function NavIcon({ icon }: { icon: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon === 'star' && (
        <>
          <path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" />
          <path d="m19 3 .6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6L19 3Z" strokeWidth="1" />
        </>
      )}
      {icon === 'sun' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2m0 15v2M2.5 12h2m15 0h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4" />
        </>
      )}
      {icon === 'cards' && (
        <>
          <path d="m6 5-2 .5a1.5 1.5 0 0 0-1.1 1.8l3 12.1a1.5 1.5 0 0 0 1.8 1.1L11 20" />
          <rect x="8" y="3" width="12" height="17" rx="2" />
          <path d="m14 7-2.5 4.5L14 16l2.5-4.5L14 7Z" />
        </>
      )}
      {icon === 'orbit' && (
        <>
          <path d="M5.8 5.8a8.5 8.5 0 1 0 5-2.2M3 4v4h4" />
          <path d="M12 7.5V12l3.2 2" />
          <circle cx="16.5" cy="4.8" r="1" fill="currentColor" stroke="none" />
        </>
      )}
      {icon === 'profile' && (
        <>
          <circle cx="12" cy="8" r="3.3" />
          <path d="M5 20v-1.5a7 7 0 0 1 14 0V20M8 20h8" />
        </>
      )}
    </svg>
  );
}

export function MainNav({
  activePath,
  onHomeClick,
}: {
  activePath: string;
  onHomeClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  const selectedPath = activePath === '/reading' ? '/agent' : activePath;
  return (
    <nav className="side-nav" aria-label="主导航">
      {NAV_ITEMS.map(({ href, label, icon }) => (
        <Link
          key={href}
          href={href}
          data-tour={href.slice(1) || 'home'}
          onClick={href === '/' ? onHomeClick : undefined}
          aria-current={selectedPath === href ? 'page' : undefined}
          className="side-nav-link"
        >
          <span className="side-nav-symbol">
            {icon === 'message' ? <RitualIcon name="message-circle" /> : <NavIcon icon={icon} />}
          </span>
          <span className="side-nav-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
