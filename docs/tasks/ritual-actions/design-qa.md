# 洗牌 / 抽牌辅助操作优化验收

后续更新：用户已要求洗牌和抽牌均一屏显示。本文的“短屏滚动”结论已由 [单屏修复记录](../ritual-one-screen/delivery.md) 取代，最新截图与严格不滚动验证见该记录。

日期：2026-09-11。任务范围为用户红框中的辅助操作区，基于用户确认的两张按钮效果图。未修改主按钮、牌桌、狐狸、牌弧、业务回调或路由。

## 视觉依据与状态

- source visual truth：`references/shuffle.png`（890 × 1767，exec-e0297812-e2b5-453d-aaa0-ea08562f5a05）；`references/draw.png`（894 × 1758，exec-493580e8-d81b-4e80-834a-b11387ee58d8）。
- implementation screenshot：`final/390x844-shuffle.png`、`final/390x844-draw.png`。
- CSS viewport：390 × 844，deviceScaleFactor 1；截图像素也是 390 × 844。另测 390 × 744、320 × 640、360 × 740、390 × 659、1440 × 1000。
- state：问题“你好。”；单张牌。洗牌为开始前，抽牌为已抽 0 / 1、预选“指引”、撤回不可用。所有文案与效果图对应。
- density normalization：源图去掉设备/微信外壳，按内部页面宽度 795 / 790 等比缩到 390。生成稿没有给出可验证的 CSS 视口高度，且抽牌稿本身已滚动；因此全页图只用于整体层级检查，不据此声称纵向位置逐像素一致。重点在原红框范围按相同页面宽度作局部比较。
- full-view comparison evidence：[洗牌](final/shuffle-comparison.png)、[抽牌](final/draw-comparison.png)，左确认稿、右真实页面。
- focused region comparison evidence：[洗牌按钮](final/shuffle-actions-comparison.png)、[抽牌按钮](final/draw-actions-comparison.png)，左确认稿、右真实控件。局部比较保留各自真实高度，不强行拉伸；原稿设备外壳未复制进产品。

## 对照与修复记录

1. `iteration-1`：洗牌已为横向图文按钮，抽牌已为四列暗底按钮；旧边框素材黑底在控件上形成过硬的底色，列为 P2。采用 screen 混合去掉黑底，保留原素材和真实 HTML 文本。初版截图测试选牌阵存在过渡等待不足，已修正测试并增加单张牌文案断言。
2. `iteration-2`：黑底问题消除。320px 窄屏仍继承旧的两行导航，挤占辅助操作区，列为 P2；调整为左右导航与中间提示三列，窄屏降低提示字级。加强浏览器检查，除按钮中心命中外，还检查文字底边可见性；短屏纵向滚动后验证所有辅助操作完整可达。
3. `iteration-3` 与 `final`：窄屏三列导航、四列操作排列稳定。边框、星点不参与命中；文字完整，操作可达，没有页面横向溢出。最终证据来自独立生产构建 Chrome 会话。

## 五项视觉检查

| 项目 | 结论 |
| --- | --- |
| 字体 | 复用现有 300 字重的阶段宋体；洗牌按钮 15px、抽牌按钮 13px，320px 分别为 13px / 12px。文案无截断，禁用撤回为低对比状态 |
| 布局 | 洗牌两列横向图文；抽牌四列图标在上、文字在下；上一张/下一张为星点细线导航。导航点击高度至少 44px，洗牌按钮 52px，抽牌按钮至少 68px |
| 颜色 | 复用 ink-veil、gold-pale 等 tokens；暗紫按钮底，浅金文字与框线；亮金主按钮保持原样。hover、active、focus-visible、disabled 都保留真实状态 |
| 图片与图标 | 复用 ImageGen card-frame.webp、star.webp，通过九宫格缩放保留角部；新增官方 Tabler v3.34.1 feather/cards SVG，沿用该库许可证，无新增运行时依赖 |
| 文案 | 修改问题、修改牌阵、重新洗牌、撤回上一张、上一张、下一张及说明文案均保持；不替换业务名称 |

## 测试

- `npx vitest run tests/CardDeck.test.tsx tests/FanDeck.test.tsx tests/ManualDrawTable.test.tsx tests/ReadingPage.test.tsx --maxWorkers=2`：4 文件、33 项通过。
- `npm run lint`、最终相关文件 ESLint、`npx tsc --noEmit`、`npm run build`：通过。
- `git diff --check`：通过。
- `tests/browser/ritual-actions.mjs`：六视口检查按钮高度、完整文字、命中、图标资源加载、撤回禁用；实际点击上一张/下一张、修改问题/牌阵/重洗并取消，检查 Escape 关闭、键盘 Tab 顺序及 pageerror。[最终结果](final/results.json)。

## 剩余细节与边界

- P3：复用的金框角花和 Tabler 羽毛/卡牌线条与生成稿并非完全相同；按钮底色更均匀，未把效果图的整块纹理烘焙为按钮。
- 用户只授权本次辅助操作区修改，页头、狐狸、牌桌和牌弧的既有差异不纳入本次重新设计。
- 640 / 659 等短屏需滚动查看全部内容；没有为了塞满首屏缩小牌弧或改变主操作。局部截图会将操作区滚动到可见位置。
- 使用本机真实 Chrome、隔离模拟登录及配置。未测试微信真机、软键盘、安全区或真实保存/解读接口；未改业务行为，本轮没有重复全量模型与数据库测试。
- 未提交、推送或部署；保留工作区原有修改。

final result: passed
