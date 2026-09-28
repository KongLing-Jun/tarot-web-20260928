# 月映卡语文档中心

更新日期：2026-09-12。项目使用 Next.js 网页与微信小程序 web-view 共用页面；现行说明以本目录的指南、配置和架构文档为准。

## 使用与维护

| 文档 | 内容 |
| --- | --- |
| [中文指南](./GUIDE.zh-CN.md) / [English guide](./GUIDE.en.md) | 功能、安装、启动、测试与项目结构 |
| [项目架构与代码导览](./ARCHITECTURE.md) | 分层架构图、路由图、业务流程图、19 个 API 路径及数据边界；2026-09-23 核对 |
| [业务流程与优化建议](./BUSINESS-FLOWS.md) | 27 个业务及支持流程、异常分支、数据边界、优化优先级与验收标准 |
| [后端配置](./CONFIG.md) | 私有配置、生效时机、服务监听与小程序网址的区别 |
| [Linux 编译与 Git 部署](./DEPLOY-LINUX.md) | Docker 编译运行包、Git 传输、服务器直接使用 Node.js 启动 |
| [数据库与登录](./DATABASE.md) | 迁移、微信认证、账号隔离、历史和每日记录 |
| [OSS 图片存储](./OSS.md) | 图片同步、头像、资源表与部署检查 |
| [小程序接入](./MINIAPP.md) | 本地联调、发布环境、手势操作、生命周期及错误排查 |

## 当前修改与验收

| 文档 | 状态 |
| --- | --- |
| [解读个性化优化](./tasks/reading-context-optimization-20260924.md) | 提示词注入排查、上下文候选、成对语义评测与实施记录 |
| [2026-09-11 集成记录](./tasks/integration-20260911.md) | 当前改动范围、验证结果和剩余限制 |
| [牌堆主视觉调整](./tasks/fan-stage-20260911.md) | 删除顶部牌位、撤回上一张、抽齐自动进入揭牌及本轮验证边界 |
| [手机牌堆手势验收](./design-qa.md) | 双指缩放、沿弧拨牌、向外抽取和截图；下半部分为历史验收 |
| [抽牌交付记录](./tasks/fan-draw-delivery.md) | 当前手势行为与早期实现记录 |
| [微信基础库空指针排查](./tasks/wechat-frame-recovery-20260911.md) | 本机基础库证据、项目竞态修复及尚未完成的原场景复测 |

## 历史计划与交付

- [独立小程序迁移计划](./tasks/plan.md)及[任务清单](./tasks/todo.md)：早期独立前端方案，当前采用 web-view；不作为当前待办或已完成清单。
- [H5 第一阶段](./tasks/h5-phase-one.md)、[资料页交付](./tasks/miying-profile-delivery.md)。
- [解读输出计划](./tasks/reading-output-plan.md)、[任务清单](./tasks/reading-output-todo.md)、[交付](./tasks/reading-output-delivery.md)。
- [体验建议](./tasks/miniapp-experience-recommendations.md)、[体验优化交付](./tasks/experience-optimization.md)。
- 早期方案归档：[历史功能计划](tasks/legacy-history-feature.md)、[中文本地化计划](tasks/legacy-localization.md)。其中 localStorage 设计已由现行账号数据库方案替代。
- [2026-09-10 集成记录](./tasks/integration-20260910.md)。

## 目录约定

- 项目指南、配置、设计和验收文档统一存放在 `docs/`；根目录中英文 README 仅提供入口，`LICENSE` 留在根目录。
- `docs/tasks/` 仅在根目录保存任务 Markdown：计划、交付记录、验收结论和评阅报告。不保存图片、JSON、TXT、模型提示词与回复样本，也不建立生成材料子目录。后续验收产物输出到临时目录，文档记录检查条件、结果与限制；历史路径和样例编号仅用于说明当时批次。
- 文档链接按所在文件使用相对路径；命令和代码路径未另作说明时均以仓库根目录为工作目录。修改行为时同步指南和相关专题；验证数字注明批次，不能把浏览器模拟写成真机验收。
- `docs/architecture/`、`docs/verification/` 是原有本地草稿和抓图目录，继续由 Git 忽略；正式文档和 `docs/tasks/` 纳入版本管理。历史文档中引用这些本地证据不表示克隆仓库后一定可用。
