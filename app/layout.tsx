import type { Metadata, Viewport } from 'next';
import { BRAND } from '@/lib/brand';
import { Geist_Mono, Cinzel_Decorative, Marcellus, Spectral } from 'next/font/google';
import './_styles/chinese-font.css';
import './_styles/globals.css';
import './_styles/small-actions.css';
import { AmbientField } from '@/components/effects/AmbientField';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { UserSession } from '@/components/session/UserSession';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Cinzel Decorative — 装饰碑刻体，用于英雄标题
const cinzelDecorative = Cinzel_Decorative({
  variable: '--font-cinzel-decorative',
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  display: 'swap',
});

// Marcellus — 古典优雅，用于章节标题与标签
const marcellus = Marcellus({
  variable: '--font-marcellus',
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
});

// Spectral — 屏幕衬线，用于正文
const spectral = Spectral({
  variable: '--font-spectral',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#08060f',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 微信 iOS 宿主会在水合前向 html 注入 -webkit-touch-callout 样式。
    // 仅容忍根节点属性差异；body 和页面后代仍执行正常水合校验。
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${spectral.variable} ${geistMono.variable} ${cinzelDecorative.variable} ${marcellus.variable} antialiased min-h-screen`}
      >
        {/* Skip to content · 键盘用户快捷进入 */}
        <a href="#main-content" className="skip-link cn-nav">
          跳 至 内 容
        </a>

        {/* Atmospheric vignette — 多层深空渐变 */}
        <div className="fixed inset-0 pointer-events-none z-0 bg-vignette" aria-hidden />

        {/* Film grain overlay · 胶片颗粒质感 */}
        <div className="grain-overlay" aria-hidden />

        {/* Ambient field — 星尘 / 雾幕 / 烛光跟随 / 星座连线 */}
        <AmbientField />

        <div className="relative z-10">
          <ErrorBoundary>
            <UserSession>{children}</UserSession>
          </ErrorBoundary>
        </div>
      </body>
    </html>
  );
}
