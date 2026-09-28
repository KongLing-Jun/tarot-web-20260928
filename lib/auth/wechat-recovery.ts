const RETRY_PARAM = 'wechat_retry';
const SDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';

interface MiniProgramBridge {
  getEnv(callback: (result: { miniprogram: boolean }) => void): void;
  reLaunch(options: { url: string; success: () => void; fail: () => void }): void;
}

type WechatWindow = Window & {
  __wxjs_environment?: string;
  wx?: { miniProgram?: MiniProgramBridge };
};

export function clearWechatRecovery(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(RETRY_PARAM)) return;
  url.searchParams.delete(RETRY_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

// Only a confirmed 401 may launch a fresh wx.login in the native mini program.
// Carry the retry marker through the new web-view, whose sessionStorage may reset.
export async function recoverWechatSession(signal?: AbortSignal): Promise<boolean> {
  const host = window as WechatWindow;
  if (new URL(host.location.href).searchParams.has(RETRY_PARAM)) return false;
  if (
    host.__wxjs_environment !== 'miniprogram' &&
    !/MicroMessenger|miniProgram/i.test(navigator.userAgent)
  )
    return false;

  return new Promise((resolve) => {
    let finished = false;
    let script: HTMLScriptElement | undefined;
    const timer = window.setTimeout(() => finish(false), 8000);
    const abort = () => finish(false);
    function finish(result: boolean) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (script) {
        script.onload = null;
        script.onerror = null;
        script.remove();
      }
      resolve(result);
    }
    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    function launch() {
      if (finished) return;
      const bridge = host.wx?.miniProgram;
      if (!bridge) {
        finish(false);
        return;
      }
      try {
        bridge.getEnv(({ miniprogram }) => {
          if (finished) return;
          if (!miniprogram) {
            finish(false);
            return;
          }
          const target = new URL(host.location.href);
          target.searchParams.set(RETRY_PARAM, '1');
          const returnTo = `${target.pathname}${target.search}${target.hash}`;
          try {
            bridge.reLaunch({
              url: `/pages/index/index?returnTo=${encodeURIComponent(returnTo)}`,
              success: () => finish(true),
              fail: () => finish(false),
            });
          } catch {
            finish(false);
          }
        });
      } catch {
        finish(false);
      }
    }
    if (host.wx?.miniProgram) launch();
    else {
      script = document.createElement('script');
      script.src = SDK_URL;
      script.onload = launch;
      script.onerror = () => finish(false);
      document.head.appendChild(script);
    }
  });
}
