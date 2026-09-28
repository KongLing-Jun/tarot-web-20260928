# 用户登录和聊天存储

## 配置与启动

服务端配置统一放在根目录 `model.config.json`（已被 Git 忽略）。保留原有 `MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_ID`，增加：

```json
{
  "DATABASE_URL": "postgres://postgres:your-password@127.0.0.1:5432/tarot?sslmode=disable",
  "WECHAT_APP_ID": "与 project.config.json 相同的小程序 AppID",
  "WECHAT_APP_SECRET": "微信小程序后台的 AppSecret"
}
```

`tarot` 数据库需要事先存在。在项目目录运行：

```sh
npm install
npm run db:migrate
npm run dev:miniapp
```

迁移可重复执行，创建缺少的表和索引，并清理旧默认用户名中的 ID 片段，不删除现有业务数据。生产环境先迁移再启动应用。配置只在服务端读取，不放入 `NEXT_PUBLIC_*` 或小程序目录。数据库连接池最多 10 个连接；服务端运行环境必须能访问配置中的数据库地址。

## 微信登录

1. 小程序调用 `wx.login` 获得临时 code，通过 `wx.request` 提交到 `POST /api/auth/wechat`。
2. 服务端向微信 `jscode2session` 验证 code，根据 `(AppID, OpenID)` 创建或查找用户。用户 ID 为仅服务端使用的固定 UUID，默认用户名为 `星旅人`，默认头像为 `/avatars/default.svg`；再次登录保留同一个用户 ID。
3. 接口只返回 60 秒有效的一次性票据。小程序打开 `/api/auth/wechat/consume?ticket=...`，服务端原子消费票据，设置 30 天有效的 HttpOnly、SameSite=Lax Cookie，并跳转到无票据的首页。生产 Cookie 仅通过 HTTPS 发送。
4. 网页使用 `GET /api/auth/me` 读取公开资料。所有聊天、解读和历史 API 从 Cookie 查询当前用户，忽略客户端提供的用户 ID。未登录返回 401；跨站修改请求返回 403。

微信 AppSecret、session_key 和 OpenID 不下发网页。数据库只保存登录令牌和票据的 SHA-256 摘要。票据过期或会话过期时重新打开小程序登录；开发环境也必须使用真实的小程序 AppID/AppSecret 和有效 code，没有伪造身份的开发登录后门。

网页在小程序中收到资料接口的 `401` 时，通过微信 JSSDK 返回原生首页重新执行 `wx.login`，兑换新会话后回到原网页。回跳标记将自动恢复限制为一次，失败后可点击“重新检查登录”手动重试，避免循环刷新；普通浏览器不发起微信重登录。网络异常和服务端 `503` 只显示可重试错误，保留已有资料和札记草稿；只有确认 `401` 才清除本地用户状态。部署这一恢复流程时需要同步更新小程序端与网页端代码。

原生页面卸载后会忽略旧登录尝试的回调，并取消在途票据请求，避免继续更新已销毁的 web-view。该生命周期保护不改变票据消费、会话有效期或服务端登录协议，详见[小程序接入](./MINIAPP.md)。

微信说明：[小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)。

## 网页游客登录

非微信小程序环境首次访问时，客户端使用安全随机数生成 256 位游客凭证，保存在当前浏览器的 `localStorage`；`POST /api/auth/guest` 根据凭证摘要创建或恢复游客账号，并签发与微信账号相同的 HttpOnly 会话 Cookie。服务端只保存 SHA-256 摘要，不保存原始游客凭证。会话过期后自动使用同一凭证恢复，刷新页面仍保留原有资料、收藏及历史记录。禁用浏览器存储时只能在当前页面生命周期内保留凭证，关闭后可能无法恢复。

微信小程序仍使用微信身份与原有自动重登录流程。微信内普通网页通过 JSSDK `getEnv` 确认环境后使用游客账号；环境检测失败只提示重试，不切换身份。已有有效会话继续使用，网络或服务器故障不会创建新游客。游客账号和微信账号相互独立，不自动合并记录；游客可使用资料、收藏、历史等登录功能，但不支持微信支付。

部署前执行 `npm run db:migrate`，应用 `018_guest_accounts.sql`：允许游客的微信字段为空，新增唯一的 `guest_token_hash`。页面展示“游客已登录”，资料响应通过 `isGuest` 标记账号类型。清除浏览器网站数据会丢失游客凭证，请保留需要的记录。

## 新手引导状态

部署首次使用引导前应用 `020_product_tours.sql`。迁移仅为 `tarot_users` 添加 `product_tour_version`（整数、非空、默认 0）和 `product_tour_status`（默认 NULL），不新建表。CHECK 仅允许 `0/NULL` 或正版本配 `completed/skipped`；既有与新建用户都默认有资格展示。迁移事务设置 5 秒锁等待、30 秒语句超时，超时需回滚后重试；在已完成旧迁移的环境可单独执行本文件。

首页成功读取 `GET /api/product-tour` 后，尚未确认当前版本才自动展示。`PUT /api/product-tour` 只接受当前版本及完成/跳过结果，账号由 Cookie 确定，并核对启动时取得的专用账号绑定摘要。主动完成或退出才保存，中断不写入。条件更新允许升级版本、同版本跳过升级完成；旧版本不能覆盖新版本，同版本完成不能退回跳过。只保留最新确认版本，无引导历史记录。

手动重看不受状态限制。读写失败不伪装成功；保存失败时下次可能再次展示。登录、资料编辑和公开资料响应不接收或暴露这两个字段。微信与游客账号各自保存状态。

## 修改个人资料

“我的”页面点击头像上的“更换”进入 `/profile/avatar`，可上传并预览头像、恢复默认头像，保存成功后返回“我的”；取消不会保存。资料编辑区修改用户名，对应 `nickname` 字段，与头像均保存到 `PATCH /api/auth/me`。用户名支持 1–40 个 Unicode 字符（含中文、表情和空格，不含控制字符），去除首尾空格，允许重名和随时修改。内部 UUID 始终不变，因此会话、微信绑定和历史记录不受影响。页面及 GET/PATCH 资料响应均不暴露 `id` 或 `publicId`。

头像支持最大 5 MB 的 JPG、PNG、WebP，网页先居中裁剪压缩，服务端验证并重新编码为 256×256 WebP，上传 OSS 并写入 `tarot_image_assets`，再将 HTTPS URL 存入用户的 `avatar_url`。更新接口只接受当前登录用户的头像和展示 ID，不接受任意远程图片 URL。上传失败时保留当前头像；恢复默认头像时读取资源表中的默认头像 URL。

运行 `npm run db:migrate` 创建 `003_image_assets.sql` 中的图片资源表，再运行 `npm run images:sync` 上传静态图片、迁移已有 data URL 头像并设置数据库默认头像 URL。首次启动应用前必须完成同步。详情见 [OSS 图片存储](./OSS.md)。

升级时运行 `npm run db:migrate`，脚本按文件名执行全部 SQL 迁移。`004_private_user_identity.sql` 将带内部 ID 前缀的旧默认用户名恢复为 `星旅人`，保留用户自定义名字。旧 `profile_id` 字段仅为兼容历史数据保留，不再展示或编辑；用户名使用原有 `nickname` 字段，无唯一性限制。迁移前的旧默认名字也会在服务端读取时隐藏 ID 片段。

## 数据表

| 表 | 用途 |
| --- | --- |
| `tarot_users` | 微信身份或游客凭证摘要、固定用户 ID、默认昵称和头像、注册及最近登录时间、累计占卜次数 `reading_count` |
| `tarot_sessions` | 登录令牌摘要及有效期 |
| `tarot_login_tickets` | 小程序到网页的一次性登录票据 |
| `tarot_readings` | 占卜问题、牌阵、牌面、解读、追问；按 `(user_id, id)` 隔离 |
| `tarot_chat_messages` | 用户和助手消息、回合 ID、内容、状态和牌面上下文 |
| `tarot_agent_sessions` | 当前智能对话的有序任务引用、已发送问题和并发版本；按账号保存 |
| `tarot_daily_entries` | 每日牌、札记及修改时间、每日解读及状态；按 `(user_id, date_key)` 隔离 |
| `tarot_card_favorites` | 用户收藏的牌面及收藏时间；按 `(user_id, card_id)` 唯一，重复收藏不会重复计数 |
| `tarot_image_assets` | 图片逻辑路径、类型、所属用户、OSS 对象键、HTTPS URL、MIME、字节数和 SHA-256 |

`/api/interpret` 在调用模型前写入提问和待生成回复，流式生成时每两秒保存一次当前内容，结束或取消时保存最终状态。页面关闭前不需要额外提交聊天文本。模型请求失败时保留提问；进程突然退出时保留最近一次保存的内容，状态可能仍为 `pending`。所有 Agent 通道也会归档；内部选牌阵及追问决策标记为 `internal`，存入数据库但不显示在聊天消息列表。每日解读同时更新日期记录；主占卜解读同时更新关联历史记录。并发生成时旧请求不能覆盖新请求的服务端保存结果。

`/history/messages` 查看和清空聊天消息，`/history` 查看、删除解读记录。二者独立保存：清空聊天不清空解读记录，删除轨迹也不删除聊天。流式重试和重新生成会保留各次请求记录。

手动与智能占卜在牌面确定后就保存记录，无需等模型生成成功。追问保留等待翻牌、生成失败等状态和补牌。资料、头像元数据、聊天、占卜、每日牌、札记及每日解读均有数据库存储；牌典内容和牌阵定义属于代码内的静态资源，筛选条件、动画进度、尚未提交的问题属于临时界面状态。

### 当前对话任务

迁移 `010_agent_sessions.sql` 增加当前对话表。智能提问在调用模型、选择牌阵之前，通过 `PUT /api/agent-session` 保存问题和任务引用；失败时保留界面中的问题并显示错误，不开始模型生成。刷新页面、重新登录同一账号或换设备进入 `/agent` 时，通过 `GET /api/agent-session` 恢复当前对话及其多个抽牌回合，并从解读记录读取牌面、正文和追问。尚未抽牌的任务也能恢复并重试；中断的生成显示已保存内容，需手动重试，不会自动重新调用模型。

新对话将当前任务列表置空，已有解读和聊天归档仍保留。退出登录只清理浏览器内存，不清空数据库中的当前任务。版本号用于拒绝旧页面或其他设备覆盖更新后的当前对话，冲突时提示刷新。读取失败时暂停进入对话，避免空界面覆盖已有记录。当前任务不写入 localStorage、sessionStorage 或 IndexedDB；未发送草稿仍是临时界面状态。

智能追问请求携带所属解读和追问 ID，服务端在流式生成时直接更新关联追问的内容和状态，无需等待浏览器在结束时提交。客户端快照保留服务端的回合关联，旧生成不能覆盖新生成。首轮解读再次保存时也保留服务端回合 ID，确保刷新后能判断是否完成。

### 占卜次数

迁移 `006_user_reading_count.sql` 为 `tarot_users` 增加 `reading_count integer NOT NULL DEFAULT 0`，按现存占卜轨迹回填历史次数。手动或智能占卜每新建一条 `tarot_readings` 记录，数据库触发器在同一事务内原子加一；重复保存同一记录、更新解读和追问不重复计数。每日一牌不计入此项。删除历史不会扣减累计次数；删除后重新新建记录会再次计数。重复执行迁移不会重置累计次数，迁移前已经删除的历史无法回填。

GET/PATCH `/api/auth/me` 返回只读的 `readingCount`，客户端不能修改该字段。“我的”页面展示实际次数（新用户为 `0`），页面切换时重新读取用户资料，返回后可看到最新值。

## 牌典收藏

迁移 `007_card_favorites.sql` 创建收藏表。牌典的星标和详情页按钮支持收藏、取消收藏；“我的收藏”可与牌典分类组合筛选。收藏随微信账号保存，重新登录或换设备后恢复。“我的”页面的珍藏牌面显示当前收藏数量，没有收藏时为 `0`。

`PUT /api/favorites/:cardId` 收藏，`DELETE /api/favorites/:cardId` 取消收藏，两者均幂等。服务端验证牌面 ID 并从当前会话确定所属用户，不接受客户端指定账号。GET/PATCH `/api/auth/me` 的只读 `favoriteCardIds` 返回该用户的收藏列表；客户端收到保存成功后才更新状态，失败保留原收藏并显示重试提示。

## 每日记录接口

迁移 `005_daily_entries.sql` 创建每日记录表，无需修改现有模型或微信配置。

| 接口 | 行为 |
| --- | --- |
| `GET /api/daily?offset=0` | 按日期倒序分页读取，每页 100 条，返回 `entries/hasMore` |
| `POST /api/daily/:date` | 幂等登记当日牌并返回完整记录，日期格式 YYYY-MM-DD |
| `GET /api/daily/:date` | 读取当前账号该日期记录，不存在时返回 `entry: null` |
| `PATCH /api/daily/:date` | 更新札记，最多 10000 字；空正文清空札记，保留牌和解读 |
| `POST /api/daily` | 导入 `{notes: [{dateKey, note}]}`，每批最多 100 条，已有编辑或清空记录不覆盖 |
| `POST /api/interpret` | 每日请求携带 `daily.dateKey`，服务端推导牌面并保存流式结果 |

札记在停止输入 800 毫秒后自动保存，按日期串行写入；切换日期、隐藏页面和离开页面时尝试提交。仅数据库返回成功后显示“已保存”。读取失败时暂停编辑并提供重试，写入失败的草稿保留在当前登录会话内，并在未确认保存时提示离开风险。断网且关闭整个应用时，未保存草稿不能保证恢复。

旧版 `mystic-tarot-daily-notes-v1` 只用于迁移读取，新增札记不再写入 localStorage。每日页提供“将旧札记导入当前账号”；成功导入的本地条目移除，冲突条目保留以便人工处理。旧版未绑定账号的占卜历史不会被自动归属或删除。

## 验证

```sh
npm test
npm run test:db
npm run lint
npm run build
```

`test:db` 使用当前配置的真实 PostgreSQL，创建独立测试 AppID 下的临时用户，用模拟微信响应验证重复登录、票据防重放、过期、数据隔离、并发更新、流式保存和删除。结束后按测试 AppID 删除临时用户及其关联数据。真实微信登录仍需在开发者工具和真机中验收。
