# 用户意图识别任务清单

## 1. 领域协议与证据校验（中，依赖：无）
- [x] 实现 task/turnAction、带引用字段、缺失信息、回答计划；拒绝伪造引用。
- [x] 场景不覆盖明确约束，纠正不将模型输出视为用户事实。
- [x] 验证：tests/intent.test.ts。文件：lib/intent/types.ts、policy.ts、prompts.ts 及测试。

## 2. 服务端识别与快照（中，依赖：1）
- [x] 用户隔离、不可变版本、问题绑定、历史读取和失败响应。
- [x] 新迁移兼容旧记录；模型配置及预算复用现有服务端设置。
- [x] 验证：存储/服务单测。文件：database/019_user_intents.sql、lib/server/intent.ts、lib/server/intent-store.ts 及测试。

## 3. 接口与交互基础（中，依赖：1、2）
- [x] /api/intent 鉴权及输入校验；前端取消、编辑失效、澄清和错误提示。
- [x] 同一请求并发保护，失败保留用户输入。
- [x] 验证：API 和 Hook 测试。文件：app/api/intent/route.ts、hooks/useIntent.ts、components/question/IntentFeedback.tsx 及测试。

## 检查点 A
- [x] 领域、存储、接口与交互测试通过，协议无分歧。

## 4. 手动占卜接入（中，依赖：3）
- [x] 场景/普通提问识别成功后才开始洗牌或选阵；编辑使旧快照失效。
- [x] 快照 ID 随解读和记录传递，澄清阶段不抽牌。
- [x] 验证：ReadingPage 与 useReading 回归。文件：app/reading/page.tsx、hooks/useReading.ts、lib/tarot/types.ts、lib/server/readings.ts 及测试。

## 5. Agent 与追问接入（中，依赖：3、4）
- [x] 初始问题和追问使用同一识别协议，纠正使用服务端历史。
- [x] 不因纠正或只倾诉强制补牌；取消不创建陈旧回合。
- [x] 验证：Agent 和追问回归。文件：app/agent/page.tsx、hooks/useAgentChat.ts、lib/agent/agentTurn.ts 及测试。

## 6. 受控提示词注入（中，依赖：2、4、5）
- [x] 按用户/问题绑定加载快照，拒绝未澄清或篡改引用。
- [x] 应用规则与自由文本分离，快照和场景可追溯；旧请求兼容。
- [x] 验证：提示词和 interpret API 回归。文件：app/api/interpret/route.ts、lib/api/prompts.ts 及测试。

## 检查点 B 与交付
- [x] 全量测试、类型、Lint、格式和构建通过。
- [x] 模拟浏览器验证澄清、失败重试和继续流程；报告真实模型/数据库未验证项。
- [x] 更新架构/API 文档和交付说明，恢复本地服务；不提交或推送。

## 验证记录

2026-09-23：全量 1213 项通过、86 项跳过。TypeScript、ESLint、Prettier、生产构建通过。移动浏览器模拟通过失败保留、澄清阻断、修订引用和继续洗牌；无页面异常。详细证据与未实测项见 [delivery.md](delivery.md)。

## 真实模型问题修复

- [x] 区分必要澄清与个性化细节，保留二选一缺选项的拦截。
- [x] 从所属记录实际牌面导出状态，同时传给识别模型和回答策略。
- [x] 先失败后修复的回归、全量 1221 项测试、类型、Lint、格式和构建通过。
- [x] 14 次真实调用复测，12 个识别样本和自动选阵通过，支持式解读人工专项核验通过。

详情见 [修复与复测](../../docs/reviews/user-intent-live-fix-20260923.md)。数据库迁移和开关启用仍未执行。
