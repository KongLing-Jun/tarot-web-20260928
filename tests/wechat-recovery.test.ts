import { afterEach, expect, it, vi } from 'vitest';
import { clearWechatRecovery, recoverWechatSession } from '@/lib/auth/wechat-recovery';
import { loginReturnPath } from '@/lib/auth/redirect';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

it('leaves normal browser visitors alone', async () => {
  expect(await recoverWechatSession()).toBe(false);
  expect(document.querySelector('script')).toBeNull();
});

it('preserves the destination and prevents an automatic login loop across web-view reloads', async () => {
  vi.stubGlobal('__wxjs_environment', 'miniprogram');
  const reLaunch = vi.fn(({ success }) => success());
  vi.stubGlobal('wx', {
    miniProgram: {
      getEnv: (callback: (value: { miniprogram: boolean }) => void) =>
        callback({ miniprogram: true }),
      reLaunch,
    },
  });
  window.history.replaceState({ retained: true }, '', '/profile?tab=mine#stats');
  expect(await recoverWechatSession()).toBe(true);
  const nativeUrl = new URL(reLaunch.mock.calls[0][0].url, 'https://tarot.invalid');
  const next = nativeUrl.searchParams.get('returnTo')!;
  expect(next).toBe('/profile?tab=mine&wechat_retry=1#stats');
  expect(loginReturnPath(next)).toBe(next);
  window.history.replaceState({ retained: true }, '', next);
  expect(await recoverWechatSession()).toBe(false);
  expect(reLaunch).toHaveBeenCalledOnce();
  clearWechatRecovery();
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    '/profile?tab=mine#stats',
  );
  expect(window.history.state).toEqual({ retained: true });
});

it('stops cleanly when the WeChat SDK cannot load', async () => {
  vi.stubGlobal('__wxjs_environment', 'miniprogram');
  const pending = recoverWechatSession();
  document.querySelector('script')!.dispatchEvent(new Event('error'));
  expect(await pending).toBe(false);
  expect(document.querySelector('script')).toBeNull();
});

it('times out if the native bridge is unavailable', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__wxjs_environment', 'miniprogram');
  const pending = recoverWechatSession();
  await vi.advanceTimersByTimeAsync(8000);
  expect(await pending).toBe(false);
  expect(document.querySelector('script')).toBeNull();
});

it('cancels stale recovery when the user leaves the page', async () => {
  vi.stubGlobal('__wxjs_environment', 'miniprogram');
  const controller = new AbortController();
  const pending = recoverWechatSession(controller.signal);
  controller.abort();
  expect(await pending).toBe(false);
  expect(document.querySelector('script')).toBeNull();
});

it.each([
  'https://evil.example',
  '//evil.example',
  '/\\evil.example',
  '/api/auth/wechat/consume?ticket=x',
  '/a/../api/auth/me',
  '/\n/evil.example',
])('rejects an unsafe login return destination: %s', (value) => {
  expect(loginReturnPath(value)).toBe('/');
});
