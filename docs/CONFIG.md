# 后端统一配置

所有后端运行配置只在根目录 `model.config.json` 修改。首次使用复制 `model.config.example.json`，填写模型、PostgreSQL、微信和 OSS 凭据。私有文件被 Git 忽略，仅供服务端读取。业务环境变量不再参与读取。AI 接口不设每小时请求次数限制。

| 字段 | 用途 |
| --- | --- |
| `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_ID` | 模型地址、密钥、模型 ID |
| `READING_PROMPT_PROFILE` | 可选，缺省 `p0`；支持 `p0`、`p1`、`p1-grounded`、`p2-context`。`p2-context` 为个性化实验候选，尚未通过语义验收；不要仅因程序测试通过就切换生产。详情见[实施记录](./tasks/reading-context-optimization-20260924.md)。 |
| `UPSTREAM_TIMEOUT_MS`、`MAX_OUTPUT_TOKENS` | 模型首包超时、输出 token 上限 |
| `STREAM_CHUNK_TIMEOUT_MS`、`STREAM_HEARTBEAT_MS` | 上游流空闲超时、下游心跳间隔 |
| `MODEL_LIST_TIMEOUT_MS` | 模型列表请求超时 |
| `INTENT_RECOGNITION_ENABLED` | 可选布尔值，缺省 `false`；完成 `019_user_intents.sql` 迁移后设为 `true`，启用提问前意图识别。关闭时保留原提问流程，不调用识别接口。 |
| `DATABASE_URL` | PostgreSQL 连接地址 |
| `DATABASE_POOL_MAX`、`DATABASE_CONNECT_TIMEOUT_MS`、`DATABASE_IDLE_TIMEOUT_MS` | 连接池大小、连接和空闲超时 |
| `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`WECHAT_TIMEOUT_MS` | 微信身份配置与服务端请求超时 |
| `PAYMENT_V3_*` | 斗拱充值测试配置；凭据仅放服务端，主动查单到账，见 [支付接入](./PAYMENTS.md) |
| `LOGIN_TICKET_SECONDS`、`SESSION_SECONDS` | 登录票据和会话有效期；修改只影响新签发记录 |
| `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET` | OSS 访问凭据 |
| `OSS_REGION`、`OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_PUBLIC_BASE_URL`、`OSS_TIMEOUT_MS` | OSS 地域、地址、桶、公开访问地址和超时 |
| `WEB_HOST`、`WEB_PORT` | `dev` 和 `start` 的后端监听地址、端口 |
| `MINIAPP_DEV_HOST`、`MINIAPP_DEV_PORT` | `dev:miniapp` 的后端监听地址、端口 |

数值使用大于 0 的 JSON 整数。`_MS` 单位为毫秒，`_SECONDS` 为秒。配置字段必须在 model.config.json 中显式填写；缺失或无效值会报错，不回退到示例文件或环境变量。示例文件仅作为初次创建配置的模板。端口范围为 1–65535。

服务端运行参数按请求读取，修改模型或超时无需重启；监听地址和端口需要重启服务。现有登录票据与会话沿用签发时的到期时间。部署时将私有配置放在服务端项目根目录。

Linux standalone 发布包默认读取运行包根目录的 `model.config.json`，与 `server.js` 同级。使用 `node scripts/start-release.mjs` 启动时，脚本会先切换到运行包根目录，因此从其他工作目录调用也会读取同一文件。示例配置复制及启动步骤见 [Linux 编译与 Git 部署](./DEPLOY-LINUX.md)。

小程序网站地址由 `miniprogram/config.js` 的 `develop` / `trial` / `release` 管理，详见[小程序接入](./MINIAPP.md)。它是微信客户端实际访问的网址，应与后端监听及网络可达地址匹配；仅修改 `MINIAPP_DEV_PORT` 不会自动更新该网址。牌堆缩放与拖出参数属于客户端交互实现，本轮未新增后端配置项。此文件不会整体传给浏览器或小程序。`WECHAT_APP_ID` 应与微信开发者工具中的小程序 AppID 一致。

`next.config.ts`、`tsconfig.json` 等保留为框架和构建工具要求的文件。`NODE_ENV` 是框架运行模式，`TAROT_DB_TEST` 是数据库测试命令内部开关，都不是业务配置入口。Next.js 路由的 `runtime`、`maxDuration` 保留静态声明以供构建分析。

模型解读和 `/api/models` 模型列表均使用文件中的 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_ID`，忽略请求体里的服务商配置。
