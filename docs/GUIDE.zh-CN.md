# 月映卡语

*[English](./GUIDE.en.md) · 简体中文*

借助塔罗牌与 AI 解读，梳理问题，探索自己的想法。

一个基于 **Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS 4** 的塔罗与 AI 解读 Web 应用。
支持完整 78 张 Rider–Waite–Smith 牌组、多种牌阵、流式 AI 解读、微信登录与数据库历史记录。

微信小程序采用 **web-view 内嵌现有网页**，继续复用全部页面和 CSS。开发者工具导入项目根目录即可识别 `miniprogram/`，本地网页启动命令为 `npm run dev:miniapp`。详细联调、HTTPS 业务域名和发布步骤见 [小程序接入说明](./MINIAPP.md)。

---

文档索引见 [docs/README.md](./README.md)。以下命令均在仓库根目录执行；实际监听地址和端口以[后端配置](./CONFIG.md)为准。

## 功能特性

- 🃏 **完整牌组**：大阿卡纳 + 小阿卡纳，共 78 张
- 🖐️ **手势抽牌**：单指沿牌弧拨牌预选，双指在牌堆内缩放（75%—200%）和移动视野；再次轻点高亮牌或向外拖出并松手抽取，也支持键盘操作
- 🌙 **牌堆主视觉**：抽取后牌背飞出、放大停留并收拢到进度区，再更新已抽数量与小牌背标记；可撤回上一张。最后一张动画完成后进入盖着的揭牌页，揭牌前仍可返回调整；减少动态效果时使用短暂淡入淡出
- ✨ **多牌阵**：单张牌、三张牌、凯尔特十字等
- 🔮 **AI 流式解读**：通过可配置 LLM 接口实时返回内容（SSE）
- ⚙️ **统一 AI 服务**：所有 AI 功能使用服务端配置，访客无需填写密钥
- 🕰️ **历史记录**：按微信账号保存聊天和占卜结果，可查看详情、批量删除、清空
- 🌌 **沉浸式视觉风格**：暗色神秘主题 + glassmorphism

---

## 技术栈

- **框架**：Next.js 16（App Router）
- **UI**：React 19、Tailwind CSS 4
- **语言**：TypeScript 5（strict）
- **代码规范**：ESLint 9（`eslint-config-next`）
- **渲染内容**：`react-markdown`

---

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 启动开发环境

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

### 3) 构建与生产运行

```bash
npm run build
npm run start
```

### 4) 代码检查

```bash
npm run lint
```

---

## API 配置说明

所有后端运行配置统一放在项目根目录的 `model.config.json`。可复制 `model.config.example.json` 并填写密钥：

```json
{
  "MODEL_BASE_URL": "https://api.deepseek.com",
  "MODEL_API_KEY": "your-api-key-here",
  "MODEL_ID": "deepseek-v4-flash"
}
```

上述片段只展示模型字段；启动前应从完整示例复制并填写全部必需配置。

配置文件已被 Git 忽略，仅供服务端读取。每次 AI 请求都会重新读取文件，修改后无需重启。部署时将文件放在服务端项目根目录；Next.js 构建会将其纳入 API 路由的文件追踪。前端不显示配置入口，也不接收密钥。旧的浏览器配置及 `MODEL_*` 环境变量不再参与模型配置。

还需在同一文件配置 `DATABASE_URL`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`，然后运行 `npm run db:migrate`。用户登录、数据表和数据库测试见 [数据库与登录说明](./DATABASE.md)。

图片统一上传 OSS，URL 登记到 PostgreSQL 图片资源表。在 `model.config.json` 配置 OSS 后，先执行数据库迁移，再运行 `npm run images:sync`；后续头像上传自动保存至 OSS。配置和验证步骤见 [OSS 说明](./OSS.md)。

AI 接口不设每小时请求次数限制。模型超时和输出上限、数据库连接池、OSS/微信服务端超时、登录有效期与后端监听地址和端口均在同一 JSON 文件中配置，不再读取业务环境变量或请求体中的服务商配置；缺失配置直接报错，不回退到示例文件。完整字段与生效方式见 [后端配置说明](./CONFIG.md)。

---

## 项目结构

```text
.
├─ app/
│  ├─ api/interpret/route.ts       # AI 解读接口（流式转发）
│  ├─ history/                     # 历史记录页与详情页
│  ├─ reading/page.tsx             # 占卜主流程页面
│  ├─ globals.css                  # 全局样式与主题效果
│  ├─ layout.tsx
│  └─ page.tsx                     # 首页
├─ docs/                           # 项目指南、配置、任务记录及验收证据
├─ miniprogram/                    # 微信原生登录与 web-view 容器
├─ components/                     # 牌堆手势、抽牌桌面及其他 UI 组件
├─ hooks/                          # 业务 hooks（如 useReading/useApiConfig）
├─ lib/
│  ├─ api/                         # LLM 调用与 prompt
│  ├─ tarot/                       # 牌组、牌阵、类型定义
│  └─ readingStorage.ts            # 登录用户的数据库历史 API 客户端
├─ public/cards/                   # 塔罗牌图片资源
└─ scripts/download-cards.js       # 下载牌图脚本
```

---

## 数据与隐私

- 聊天、占卜历史、追问、每日牌、札记和每日解读均保存在 PostgreSQL，按微信账号隔离；每日页可将旧设备札记导入当前账号
- AI 密钥和微信 AppSecret 仅保存在服务端私有配置文件中；网页使用 HttpOnly Cookie 登录
- 请妥善保管 API Key，不要在公共环境泄露

---

## 抽牌与小程序状态

首页使用墨金小狐品牌区和古旧书封介绍卡。对话在网页内部切换页面后保留生成进度、消息和输入草稿；返回同一记录不会重新抽牌或重复播放已有牌面的揭牌动画。模型思考只在生成期间显示，完成后隐藏。刷新或关闭网页不属于跨路由保留范围。

牌堆缩放工具条已移除。单指拨动时牌堆整体稳定，附近卡牌逐渐散开并抬起；双指接管会取消单指抽取，短拖或拖回牌堆不会提交。键盘可用方向键、Home / End 选牌，`+` / `-` 缩放，`0` 恢复大小。

小程序页面卸载会使登录回调失效并取消在途请求，防止异步回调继续创建 web-view。手势的浏览器模拟验收已完成，微信真机和基础库原始报错仍有待复测，见[设计验收](./design-qa.md)、[错误排查](./tasks/wechat-frame-recovery-20260911.md)和[当前集成记录](./tasks/integration-20260911.md)。

## 注意事项

- 已配置 Vitest，运行 `npm test` 执行测试
- TypeScript 严格模式已开启，请保持类型安全
- 若你使用第三方兼容接口，请确认其支持 Chat Completions 与流式输出

---

## 许可证

源代码以 [MIT License](../LICENSE) 发布。

该许可仅覆盖代码，**不包含** `public/cards/` 下的牌面素材。这些图片源自 Rider–Waite–Smith 牌组（Pamela Colman Smith，1909），在美国及多数司法辖区已进入公有领域，但具体扫描件取自第三方档案站点，请在再分发或商用前自行确认其授权范围。
