'use client';

import Link from 'next/link';
import { MainNav } from '@/components/layout/MainNav';
import { AvatarEditor } from '@/components/profile/AvatarEditor';
import { useUser } from '@/components/session/UserSession';

export default function AvatarPage() {
  const { user, loading } = useUser();
  return (
    <div className="relative min-h-screen overflow-hidden">
      <MainNav activePath="/profile" />
      <main
        id="main-content"
        className="relative z-10 px-6 pt-10 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] md:pl-28 md:pr-12 md:pt-16 md:pb-20"
      >
        <div className="mx-auto max-w-xl">
          <Link
            data-small-action="text"
            href="/profile"
            className="inline-block py-3 text-sm text-gold-dim hover:text-gold"
          >
            ← 返回我的
          </Link>
          <header className="mt-6 mb-8">
            <p className="font-heading text-tiny text-gold-dim mb-4">My Portrait</p>
            <h1 className="text-3xl md:text-4xl text-bone">更换头像</h1>
            <p className="mt-4 text-sm text-bone-dim leading-relaxed">
              选择一张喜欢的图片，点亮你的个人空间。
            </p>
          </header>
          <section aria-label="头像设置" className="ink-panel px-6 py-8 md:p-10">
            {loading ? (
              <p role="status" className="text-center text-bone-dim">
                正在读取资料…
              </p>
            ) : user ? (
              <AvatarEditor currentAvatar={user.avatarUrl} />
            ) : (
              <p className="text-center text-bone-dim leading-relaxed">请登录后更换头像。</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
