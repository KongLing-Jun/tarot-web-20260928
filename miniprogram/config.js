// 这里只放公开的网站地址。AI 密钥仍保存在 Next.js 服务端。
module.exports = {
  // 本地联调使用当前开发电脑的局域网地址，与 dev:miniapp 监听端口对应。
  develop: 'https://tarot.suiyuan-ai.com',
  // 体验版和正式版必须填写已配置为小程序业务域名的 HTTPS 网站地址。
  trial: 'https://tarot.suiyuan-ai.com',
  release: 'https://tarot.suiyuan-ai.com',
};
