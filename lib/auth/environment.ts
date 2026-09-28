type WechatWindow = Window & {
  __wxjs_environment?: string;
  wx?: { miniProgram?: { getEnv(callback: (env: { miniprogram: boolean }) => void): void } };
};

export async function isWechatMiniProgram(signal?: AbortSignal): Promise<boolean> {
  const host = window as WechatWindow;
  if (host.__wxjs_environment === 'miniprogram' || /miniProgram/i.test(navigator.userAgent))
    return true;
  if (!/MicroMessenger/i.test(navigator.userAgent) && !host.wx?.miniProgram) return false;

  // WeChat's ordinary browser also exposes the SDK. Ask the bridge before
  // choosing an identity; a failed check must never replace a miniapp account.
  return new Promise((resolve, reject) => {
    let finished = false;
    let script: HTMLScriptElement | undefined;
    const timer = window.setTimeout(() => finish(), 8000);
    const abort = () => finish();
    function finish(result?: boolean) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (script) {
        script.onload = null;
        script.onerror = null;
        script.remove();
      }
      if (result === undefined) reject(new Error('无法确认微信运行环境，请重试'));
      else resolve(result);
    }
    function check() {
      if (finished) return;
      try {
        if (!host.wx?.miniProgram) {
          finish();
          return;
        }
        host.wx.miniProgram.getEnv((env) => finish(env.miniprogram));
      } catch {
        finish();
      }
    }
    if (signal?.aborted) {
      finish();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    if (host.wx?.miniProgram) check();
    else {
      script = document.createElement('script');
      script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
      script.onload = check;
      script.onerror = () => finish();
      document.head.appendChild(script);
    }
  });
}
