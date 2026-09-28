# 月映卡语

*[English](./README.md) · 简体中文*

基于 Next.js 的塔罗与 AI 解读应用，通过微信小程序 web-view 复用网页。支持 78 张牌、六种牌阵、流式解读和按账号保存历史记录。

项目文档统一维护在 **[docs/ 文档中心](./docs/README.md)**。

前端品牌统一在 [`miniprogram/brand.js`](./miniprogram/brand.js) 管理，网页通过 `lib/brand.ts` 引用，小程序直接引用。`englishName` 派生标题大小写与大写署名，首页保留 `Moonlit Tarot`。修改后运行 `npm run brand:sync` 同步小程序静态导航栏标题，再在微信开发者工具中预览/上传；`npm run brand:check` 只检查一致性，构建与测试前自动执行。新增品牌字形需检查页面字体子集与回退显示。此配置只用于前端展示。

- [快速开始与项目指南](./docs/GUIDE.zh-CN.md)
- [后端配置](./docs/CONFIG.md)、[数据库与登录](./docs/DATABASE.md)、[OSS 图片存储](./docs/OSS.md)
- [小程序联调与手势验收](./docs/MINIAPP.md)
- [项目架构](./docs/ARCHITECTURE.md)
- [当前集成与验证记录](./docs/tasks/integration-20260911.md)

源代码采用 [MIT License](./LICENSE)；牌面素材的授权说明见项目指南。
