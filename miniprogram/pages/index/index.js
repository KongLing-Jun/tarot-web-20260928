const { getWebViewUrl } = require('../../utils/web-view');
const brand = require('../../brand');

Page({
  data: {
    brandName: brand.name,
    src: '',
    message: `正在连接${brand.name}…`,
  },

  onLoad(options = {}) {
    this.unloaded = false;
    this.returnTo = typeof options.returnTo === 'string' ? options.returnTo : '';
    if (this.returnTo && !this.returnTo.startsWith('/')) {
      try {
        this.returnTo = decodeURIComponent(this.returnTo);
      } catch {
        this.returnTo = '';
      }
    }
    this.openWebView();
  },

  openWebView() {
    if (this.unloaded || this.loginPending) return;
    const attempt = {};
    this.loginAttempt = attempt;
    const isCurrent = () => !this.unloaded && this.loginAttempt === attempt;
    try {
      const { envVersion } = wx.getAccountInfoSync().miniProgram;
      const src = getWebViewUrl(envVersion);
      this.loginPending = true;
      wx.showNavigationBarLoading();
      this.setData({ src: '', message: '正在微信登录…' });
      wx.login({
        timeout: 10000,
        success: ({ code }) => {
          if (!isCurrent()) return;
          if (!code) {
            this.onLoginError();
            return;
          }
          const request = wx.request({
            url: `${src}api/auth/wechat`,
            method: 'POST',
            data: { code },
            timeout: 15000,
            success: ({ statusCode, data }) => {
              if (!isCurrent()) return;
              if (statusCode !== 200 || !data || !/^[a-f0-9]{64}$/.test(data.ticket)) {
                this.onLoginError(data && data.error);
                return;
              }
              this.loginPending = false;
              this.loginAttempt = null;
              this.loginRequest = null;
              // 登录结束即关闭主动开启的导航栏动画，不依赖网页重定向后的 bindload。
              wx.hideNavigationBarLoading();
              const next = this.returnTo ? `&next=${encodeURIComponent(this.returnTo)}` : '';
              this.setData({
                src: `${src}api/auth/wechat/consume?ticket=${encodeURIComponent(data.ticket)}${next}`,
                message: '',
              });
            },
            fail: () => {
              if (isCurrent()) this.onLoginError();
            },
          });
          // 同步完成时不再保存已结束的请求。
          if (isCurrent()) this.loginRequest = request;
        },
        fail: () => {
          if (isCurrent()) this.onLoginError();
        },
      });
    } catch (error) {
      if (!isCurrent()) return;
      this.loginPending = false;
      this.loginAttempt = null;
      this.loginRequest = null;
      console.error('[web-view] 配置错误：', error.message);
      wx.hideNavigationBarLoading();
      this.setData({ src: '', message: '网页暂未开放，请稍后再来。' });
    }
  },

  onLoginError(message) {
    if (this.unloaded) return;
    this.loginPending = false;
    this.loginAttempt = null;
    this.loginRequest = null;
    wx.hideNavigationBarLoading();
    this.setData({
      src: '',
      message: typeof message === 'string' ? message : '微信登录失败，请检查网络后重新加载。',
    });
  },

  onWebLoad() {
    if (this.unloaded) return;
    wx.hideNavigationBarLoading();
  },

  onWebError() {
    if (this.unloaded) return;
    wx.hideNavigationBarLoading();
    // 移除铺满页面的 web-view，让原生错误提示和重试按钮可见。
    this.setData({ src: '', message: '暂时无法打开网页，请检查网络后重试。' });
  },

  onUnload() {
    this.unloaded = true;
    this.loginPending = false;
    this.loginAttempt = null;
    const request = this.loginRequest;
    this.loginRequest = null;
    if (request) request.abort();
    wx.hideNavigationBarLoading();
  },

  onShareAppMessage() {
    // 分享不携带登录票据或私人记录；接收者使用自己的微信身份登录。
    return { title: `${brand.name} · ${brand.tagline}`, path: '/pages/index/index' };
  },
});
