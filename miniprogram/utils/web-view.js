const config = require('../config');

function getWebViewUrl(envVersion, settings = config) {
  if (!['develop', 'trial', 'release'].includes(envVersion)) {
    throw new Error('无法识别小程序运行版本');
  }

  const origin = (settings[envVersion] || '').trim().replace(/\/$/, '');
  // 只接受配置内的站点 origin，不从启动参数、分享链接等接收外部 URL。
  if (!/^https?:\/\/[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(origin)) {
    throw new Error('请在 miniprogram/config.js 填写当前版本的网站地址（仅协议、域名和可选端口）');
  }
  if (envVersion !== 'develop' && !/^https:\/\//i.test(origin)) {
    throw new Error('体验版和正式版必须使用 HTTPS 网站地址');
  }

  return `${origin}/`;
}

module.exports = { getWebViewUrl };
