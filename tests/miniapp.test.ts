// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { BRAND } from '@/lib/brand';

const requireModule = createRequire(import.meta.url);
const { getWebViewUrl } = requireModule('../miniprogram/utils/web-view.js') as {
  getWebViewUrl: (version: string, settings?: Record<string, string>) => string;
};

describe('mini program website configuration', () => {
  it('supports a local development origin and requires explicit release configuration', () => {
    const settings = { develop: 'http://localhost:3001' };
    expect(getWebViewUrl('develop', settings)).toBe('http://localhost:3001/');
    expect(() => getWebViewUrl('trial', settings)).toThrow();
    expect(() => getWebViewUrl('release', settings)).toThrow();
    expect(() => getWebViewUrl('unknown')).toThrow();
  });

  it('accepts a configured LAN origin for phone debugging', () => {
    expect(getWebViewUrl('develop', { develop: 'http://192.168.1.2:3001/' })).toBe(
      'http://192.168.1.2:3001/',
    );
  });

  it('selects the correct HTTPS site and normalizes a trailing slash', () => {
    const settings = {
      trial: ' https://preview.example.com/ ',
      release: 'https://tarot.example.com',
    };
    expect(getWebViewUrl('trial', settings)).toBe('https://preview.example.com/');
    expect(getWebViewUrl('release', settings)).toBe('https://tarot.example.com/');
  });

  it.each([
    'http://tarot.example.com',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com?url=https://other.com',
    '//example.com',
  ])('rejects invalid release origin %s', (release) => {
    expect(() => getWebViewUrl('release', { release })).toThrow();
  });

  it('packages only the mini program directory, keeping server configuration outside it', () => {
    const project = JSON.parse(readFileSync(path.resolve('project.config.json'), 'utf8'));
    expect(project.miniprogramRoot).toBe('miniprogram/');
    const app = JSON.parse(readFileSync(path.resolve(project.miniprogramRoot, 'app.json'), 'utf8'));
    expect(app.pages).toContain('pages/index/index');
    expect(project.projectname).toBe(BRAND.name);
    expect(app.window.navigationBarTitleText).toBe(BRAND.name);
  });
});

interface ShellPage {
  data: { src: string; message: string; brandName: string };
  setData: (data: Partial<ShellPage['data']>) => void;
  onLoad: (options?: { returnTo?: string }) => void;
  openWebView: () => void;
  onWebError: () => void;
  onWebLoad: () => void;
  onLoginError: (message?: string) => void;
  onUnload: () => void;
  onShareAppMessage: () => { title: string; path: string };
}

interface LoginCallbacks {
  success: (result: { code: string }) => void;
  fail: () => void;
}

interface RequestCallbacks {
  success: (result: { statusCode: number; data: { ticket?: string; error?: string } }) => void;
  fail: () => void;
}

function createPage(version = 'develop') {
  let page: ShellPage;
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: version } }),
    showNavigationBarLoading: vi.fn(),
    hideNavigationBarLoading: vi.fn(),
    login: vi.fn(({ success }: LoginCallbacks) => success({ code: 'wx-login-code' })),
    request: vi.fn(({ success }: RequestCallbacks): { abort: () => void } | void =>
      success({ statusCode: 200, data: { ticket: 'a'.repeat(64) } }),
    ),
  };
  vm.runInNewContext(readFileSync(path.resolve('miniprogram/pages/index/index.js'), 'utf8'), {
    require: (name: string) =>
      name === '../../brand'
        ? requireModule('../miniprogram/brand.js')
        : {
            getWebViewUrl: (envVersion: string) =>
              getWebViewUrl(envVersion, { develop: 'http://localhost:3001' }),
          },
    console: { error: vi.fn() },
    wx,
    Page: (definition: ShellPage) => {
      page = definition;
      page.setData = (data) => Object.assign(page.data, data);
    },
  });
  return { page: page!, wx };
}

describe('mini program web-view lifecycle', () => {
  it('stops the login spinner before waiting for the web-view load event', () => {
    const { page, wx } = createPage();
    wx.request.mockImplementationOnce(() => {});
    page.onLoad();

    expect(wx.showNavigationBarLoading).toHaveBeenCalledOnce();
    expect(wx.hideNavigationBarLoading).not.toHaveBeenCalled();
    expect(page.data.src).toBe('');

    wx.request.mock.calls[0][0].success({ statusCode: 200, data: { ticket: 'a'.repeat(64) } });

    expect(page.data.src).toContain('/api/auth/wechat/consume?ticket=');
    // 不触发 onWebLoad，也必须结束主动开启的导航栏加载状态。
    expect(wx.hideNavigationBarLoading).toHaveBeenCalledOnce();
  });

  it('ignores login callbacks after the page unloads', () => {
    const { page, wx } = createPage();
    wx.login.mockImplementationOnce(() => {});
    page.onLoad();
    const login = wx.login.mock.calls[0][0];
    page.onUnload();
    const setData = vi.spyOn(page, 'setData');
    wx.hideNavigationBarLoading.mockClear();

    login.success({ code: 'late-code' });
    login.fail();
    page.openWebView();

    expect(wx.request).not.toHaveBeenCalled();
    expect(wx.login).toHaveBeenCalledOnce();
    expect(setData).not.toHaveBeenCalled();
    expect(wx.hideNavigationBarLoading).not.toHaveBeenCalled();
  });

  it('aborts a pending request on unload without updating the destroyed page', () => {
    const { page, wx } = createPage();
    const abort = vi.fn(() => wx.request.mock.calls[0][0].fail());
    wx.request.mockImplementationOnce(() => ({ abort }));
    page.onLoad();
    const request = wx.request.mock.calls[0][0];
    const setData = vi.spyOn(page, 'setData');

    page.onUnload();
    expect(abort).toHaveBeenCalledOnce();
    request.success({ statusCode: 200, data: { ticket: 'b'.repeat(64) } });
    request.fail();
    page.onWebLoad();
    page.onWebError();

    expect(setData).not.toHaveBeenCalled();
    expect(wx.hideNavigationBarLoading).toHaveBeenCalledOnce();
    expect(page.data.src).toBe('');
  });

  it('ignores callbacks from an earlier request after a retry starts', () => {
    const { page, wx } = createPage();
    wx.request.mockImplementation(() => {});
    page.onLoad();
    const previous = wx.request.mock.calls[0][0];
    previous.fail();
    page.openWebView();
    const current = wx.request.mock.calls[1][0];
    const setData = vi.spyOn(page, 'setData');

    previous.success({ statusCode: 200, data: { ticket: 'b'.repeat(64) } });
    previous.fail();
    expect(setData).not.toHaveBeenCalled();
    current.success({ statusCode: 200, data: { ticket: 'c'.repeat(64) } });
    expect(page.data.src).toContain(`ticket=${'c'.repeat(64)}`);
  });

  it('does not retain a request that completed synchronously', () => {
    const { page, wx } = createPage();
    const abort = vi.fn();
    wx.request.mockImplementationOnce(({ success }) => {
      success({ statusCode: 200, data: { ticket: 'a'.repeat(64) } });
      return { abort };
    });
    page.onLoad();
    page.onUnload();
    expect(abort).not.toHaveBeenCalled();
  });

  it.each(['/profile?wechat_retry=1', encodeURIComponent('/profile?wechat_retry=1')])(
    'carries the recovery destination through a fresh login: %s',
    (returnTo) => {
      const { page, wx } = createPage();
      page.onLoad({ returnTo });
      expect(wx.login).toHaveBeenCalledOnce();
      const url = new URL(page.data.src);
      expect(url.searchParams.get('next')).toBe('/profile?wechat_retry=1');
      expect(page.onShareAppMessage().path).toBe('/pages/index/index');
    },
  );

  it('removes a failed web-view so retry can recreate it', () => {
    const { page, wx } = createPage();
    page.onLoad();
    expect(page.data.src).toBe(
      `http://localhost:3001/api/auth/wechat/consume?ticket=${'a'.repeat(64)}`,
    );
    expect(wx.request).toHaveBeenCalledWith(
      expect.objectContaining({ data: { code: 'wx-login-code' }, method: 'POST' }),
    );
    expect(wx.showNavigationBarLoading).toHaveBeenCalled();
    page.onWebError();
    expect(page.data.src).toBe('');
    expect(page.data.message).toContain('检查网络');
    page.openWebView();
    expect(page.data.src).toBe(
      `http://localhost:3001/api/auth/wechat/consume?ticket=${'a'.repeat(64)}`,
    );
    page.onWebLoad();
    expect(wx.hideNavigationBarLoading).toHaveBeenCalledTimes(4);
    page.onUnload();
    expect(wx.hideNavigationBarLoading).toHaveBeenCalledTimes(5);
  });

  it('shows an unavailable state for an unconfigured release', () => {
    const { page, wx } = createPage('release');
    page.onLoad();
    expect(page.data.src).toBe('');
    expect(page.data.message).toContain('暂未开放');
    expect(wx.showNavigationBarLoading).not.toHaveBeenCalled();
  });

  it('does not open a web-view when WeChat login fails', () => {
    const { page, wx } = createPage();
    wx.login.mockImplementationOnce(() => page.onLoginError());
    page.onLoad();
    expect(page.data.src).toBe('');
    expect(page.data.message).toContain('登录失败');
    expect(wx.request).not.toHaveBeenCalled();
  });

  it('shows server login errors and retries with a new wx.login code', () => {
    const { page, wx } = createPage();
    wx.request.mockImplementationOnce(({ success }) =>
      success({ statusCode: 503, data: { error: '微信登录尚未配置' } }),
    );
    page.onLoad();
    expect(page.data.src).toBe('');
    expect(page.data.message).toContain('尚未配置');
    page.openWebView();
    expect(wx.login).toHaveBeenCalledTimes(2);
    expect(page.data.src).toContain('/consume?ticket=');
  });

  it('shares only the homepage, without local history or questions', () => {
    const { page } = createPage();
    expect(page.data.brandName).toBe(BRAND.name);
    expect(page.data.message).toBe(`正在连接${BRAND.name}…`);
    expect(page.onShareAppMessage()).toEqual({
      title: '月映卡语 · 给自己一个新的观察角度',
      path: '/pages/index/index',
    });
  });
});
