import React, { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';

vi.mock('next/font/google', () => {
  const font = () => ({ variable: 'test-font' });
  return { Geist_Mono: font, Cinzel_Decorative: font, Marcellus: font, Spectral: font };
});
vi.mock('@/components/effects/AmbientField', () => ({ AmbientField: () => null }));
vi.mock('@/components/session/UserSession', () => ({
  UserSession: ({ children }: { children: React.ReactNode }) => children,
}));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});

async function hydratePage(injectStyle: boolean, changeChild = false) {
  const page = (
    <RootLayout>
      <main id="main-content">
        <button aria-label="开始">开始</button>
      </main>
    </RootLayout>
  );
  const doc = document.implementation.createHTMLDocument();
  doc.documentElement.innerHTML = renderToString(page).replace(/^<html[^>]*>|<\/html>$/g, '');
  doc.documentElement.lang = 'zh-CN';
  // Reproduce the extra root attribute captured in the iOS WeChat client log.
  if (injectStyle) doc.documentElement.setAttribute('style', '-webkit-touch-callout: none;');
  if (changeChild) doc.querySelector('button')!.setAttribute('aria-label', '不一致');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const recoverable = vi.fn();
  await act(async () => {
    root = hydrateRoot(doc, page, { onRecoverableError: recoverable });
  });
  return { doc, errors, recoverable };
}

it('普通浏览器的根布局正常水合', async () => {
  const { errors, recoverable } = await hydratePage(false);
  expect(errors).not.toHaveBeenCalled();
  expect(recoverable).not.toHaveBeenCalled();
});

it('兼容微信 iOS 在水合前注入的根节点样式，保留宿主样式', async () => {
  const { doc, errors, recoverable } = await hydratePage(true);
  expect(errors).not.toHaveBeenCalled();
  expect(recoverable).not.toHaveBeenCalled();
  expect(doc.documentElement.getAttribute('style')).toBe('-webkit-touch-callout: none;');
});

it('根节点兼容不会隐藏页面后代的属性水合错误', async () => {
  const { errors } = await hydratePage(true, true);
  expect(
    errors.mock.calls.some((args) => args.some((arg) => String(arg).includes('aria-label'))),
  ).toBe(true);
});
