# 抽卡次数购买（汇付 H5 托管收银台）

> 当前状态：支付相关页面已移除，包括网页购买、充值/退款记录界面和小程序原生支付页。旧地址 `/profile/credits` 仅跳转到 `/profile`。后端支付接口、订单处理及数据保留；以下页面交互说明为原实现记录，不代表当前可用入口。

微信小程序原生支付接口 `/api/payments/miniapp`、支付票据签发/查询及原生支付参数解析已移除。新订单仅通过现有 H5 托管接口创建，不再生成小程序支付票据；旧小程序订单不能继续拉起付款，但通用查单、通知验签和到账处理仍保留。历史数据库迁移及订单数据不变，小程序登录不受影响。

入口：微信小程序 → 我的 → 购买抽卡次数（`/profile/credits`）。页面读取 `tarot_plans` 中启用的方案，默认展示 **1 次卡 ¥0.01 / 1 次、5 次卡 ¥10.00 / 5 次、月订阅 ¥28.80 / 20 次、年订阅 ¥98.00 / 100 次**。网页购买入口使用汇付 H5 托管收银台，取得 URL 后直接跳转，不展示二维码。

当前抽卡次数用于记录账户余额，尚未接入占卜或聊天抵扣。购买会真实扣款。方案修改、停用或删除后，已有订单仍按下单时的金额和抽卡次数处理；旧测试订单也能继续查询和到账。

## 购买与到账流程

1. 已登录网页通过 `GET /api/payments` 读取方案、余额、订单和购买开关。点击“微信支付”通过 `POST /api/payments` 仅提交 `{ "planId": "plan_100" }`，价格和次数由服务端读取；游客仍不可购买。
2. 服务端调用汇付 `POST /v2/trade/hosting/payment/preorder`，使用 `pre_order_type=1`、`trans_type=T_JSAPI`、`multi_pay_way_flag=N`。`hosting_data` 传入托管项目号、标题、`request_type=M`（H5 页面）和返回购买页的 `callback_url`。支付授权和收银台由汇付处理，不再自行传入微信 H5 场景参数。同一用户和方案的有效托管订单会复用，不与存量小程序订单混用。
3. 服务端验签并核对商户、订单号和日期，从汇付响应的 `jump_url` 读取链接，返回 `{ order, url }`。预下单成功不代表付款成功，不要求预下单响应含交易金额或支付流水号；如返回金额仍会校验。网页用 `window.location.assign(url)` 直接跳转，无二维码展示。若汇付返回 `pre_order_id`，会随链接保存用于后续核对。
4. 跳转和返回页面都不代表支付成功。若重试查单已确认付款，接口只返回订单，网页刷新余额；失败订单展示错误。恢复页面可见或焦点时刷新余额，有待确认订单时每 3 秒刷新本地状态，也可手动查询结果。
5. `PAYMENT_V3_NOTIFY_URL` 可继续为空，常驻 Next.js Node 服务每 30 秒扫描已尝试下单的待确认订单。过期订单仍会确认迟到支付并退避查询。仅验签及金额、商户、日期、订单号、汇付流水号、支付类型核对通过的成功结果可记账；唯一账本保证不会重复到账。
6. 托管订单通过 `POST /v2/trade/hosting/payment/queryorderinfo` 查单，每次请求带独立查询流水号及原订单信息。通道交易尚未生成时保持待支付，不因取得收银台链接而充值；模糊超时后先查单，不因通道交易不存在就重复预下单。旧小程序及微信直连 H5 订单继续走原查询接口。部署无需新增数据库迁移。

四个方案均为一次付款，次数长期有效，不自动续费；“月订阅”和“年订阅”为方案名称，不设置次数失效日期。

## 配置和启动

### 后台已处理退款的记录展示

`017_refund_records.sql` 新增 `tarot_refund_records`。购买页在充值记录下展示当前账户最近 10 笔已完成退款（金额、完成时间、退款流水号及原充值订单号），支持“刷新记录”和页面恢复可见时刷新。`GET /api/payments` 新增 `refunds`，查询按原订单所属账户隔离，独立于最近 10 笔充值订单。

当前采用**运营登记**作为记录来源，尚未自动拉取斗拱后台退款。运营确认斗拱后台退款成功后，在服务器运行以下命令；金额单位为分，完成时间必须包含时区：

```powershell
npx tsx scripts/record-refund.ts <后台退款流水号> <原充值订单号> <退款金额分> 2026-09-16T18:00:00+08:00
```

该命令仅登记历史，不能发起真实退款。仅支持已支付订单，支持分次退款；同一退款流水号重复登记不重复写入，冲突内容及累计金额超过实付金额均拒绝。页面不提供退款申请入口；本次记录展示不修改抽卡次数余额，实际退款仍在斗拱后台处理。

`016_one_fen_card_plan.sql` 新增启用的 `plan_1`（1 次卡），价格 1 分、抽卡次数 1，排序置于首位。重复迁移保留后续修改。

`015_card_draw_offers.sql` 将默认方案更新为上述名称、价格和次数，保留原方案 ID、用户余额及已有订单快照。重复迁移不会覆盖后续修改。

`014_card_draw_plan_names.sql` 将三个默认方案名称改为“100次抽卡套餐”“300次抽卡套餐”“1000次抽卡套餐”，仅更新原始默认名称，保留自定义名称、金额和余额。界面统一使用“抽卡次数”，底层 `points`、`creditBalance` 及 `tarot_user_credits` 等字段和表名保留兼容，原有余额数值不变。本次调整不增加抽卡扣次逻辑。

`012_recharge_plans.sql` 新增充值方案表 `tarot_plans`，包含方案 ID、名称、金额（`amount_fen`，单位分）、抽卡次数、排序、启用状态及创建、更新时间。重复迁移不会重复插入或覆盖已修改的方案。`013_payment_order_plan.sql` 为充值订单增加可空 `plan_id`，旧测试订单保持空值，新订单关联所选方案，金额和抽卡次数仍单独保存为订单快照。

`011_user_credits.sql` 新增 `tarot_user_credits`，以 `user_id` 为主键保存当前抽卡次数 `balance`（非负整数）及创建、更新时间。没有余额记录的用户抽卡次数为 0，查询不会创建记录。首次迁移从已有充值账本汇总抽卡次数，重复迁移保留已有余额。充值账本新增记录时由数据库触发器在同一事务中累加余额，重复通知不会重复加分；余额查询以此表为准。删除充值订单或流水不会扣减当前余额，退款扣回仍需单独实现。

凭据仅写入根目录的 `model.config.json`（已被 Git 忽略）。公开示例 `model.config.example.json` 不包含实际凭据。商户私钥用于签名，汇付公钥用于响应验签；商户公钥用于在斗拱后台登记，本服务不把它误作汇付验签公钥。

- `PAYMENT_V3_ENABLED`: 字符串 `"true"` 开放新充值，`"false"` 关闭。关闭新充值不会阻断已支付订单补账。
- `PAYMENT_V3_SYS_ID`、`PAYMENT_V3_PRODUCT_ID`、`PAYMENT_V3_HUIFU_ID`: 斗拱账号信息。
- `PAYMENT_V3_MERCHANT_PRIVATE_KEY`、`PAYMENT_V3_MERCHANT_PUBLIC_KEY`、`PAYMENT_V3_HUIFU_PUBLIC_KEY`: 支持裸 Base64 DER；签名/验签也支持 PEM。
- `PAYMENT_V3_GATEWAY_URL` / `PAYMENT_V3_QUERY_URL`: 原斗拱 V3 下单、查单接口，保留给存量订单。
- `PAYMENT_V3_HOSTING_PROJECT_ID`: 必填，汇付后台「托管项目管理」创建的 H5 托管项目号，不能用商户号或小程序 AppID 代替。未配置时不会创建新托管订单。托管接口使用固定汇付生产地址，复用现有系统号、产品号和签名凭据。
- `PAYMENT_V3_ORDER_TTL`: 默认 `"10m"`，支持秒或分钟，范围 60 秒到 2 小时，交易时间统一为北京时间。
- `PAYMENT_V3_NOTIFY_URL`: 当前为空，无需配置公网回调。若以后启用，可设为 `https://你的域名/api/payments/notify`；接口已支持原始 `resp_data` 验签及表单/JSON 通知。
- `PAYMENT_V3_POLL_ENABLED`: 字符串 `"true"` 启用常驻服务的后台查单。
- `PAYMENT_V3_POLL_INTERVAL_SECONDS`: 正整数，默认 30，运行时最小 10 秒。
- `PAYMENT_V3_REFUND_URL` / `PAYMENT_V3_REFUND_QUERY_URL`: 已保留配置，本轮未开放退款或抽卡次数扣减接口。测试订单如需退款，使用斗拱后台处理；后台退款不会自动扣回此测试账本的抽卡次数。

```powershell
npm run db:migrate
npm run dev:miniapp
```

已有开发服务在运行时，新增 `instrumentation.ts` 后重启一次。正式环境使用 `npm run build`、`npm start`。后台查单依赖 **常驻 Node 进程**；无常驻进程的 Serverless 部署不能依赖内存定时器，应另行接入持久任务调度。

在汇付后台创建 H5 托管收银台项目、开通微信支付并将项目号写入 `model.config.json` 的 `PAYMENT_V3_HOSTING_PROJECT_ID`。按汇付要求配置微信授权域名 `api.huifu.com/hostingh5/`，参见[汇付 H5 收银台配置指南](https://paas.huifu.com/docs/bzb/#/ythsk/tyzxsyt/h5_syt)。前端指定微信支付，汇付控制实际支付页展示和拉起行为。

代理需保留网页 Origin / Host 和正确协议，支付成功回跳地址固定为该站点 `/profile/credits`。回跳仅触发余额刷新，不作为到账凭据；仍需真实手机验收支付和回跳链路。

## 验证

```powershell
npm test
npm run test:db
npx tsc --noEmit
npm run build
```

支付数据库测试创建隔离测试用户、方案并清理其记录，网关使用模拟响应，不会扣款。覆盖三档方案下单和后台补账、方案停用或调价、拒绝客户端篡改价格、重复下单、账户隔离、票据失效、验签失败、并发到账、页面卸载、自动刷新停止、查询超时和过期订单补账。

2026-09-16：全量非数据库测试 698 项通过，数据库集成测试 72 项通过；TypeScript、变更文件 ESLint 和生产构建通过。使用临时测试账号检查了 390px 手机布局、桌面布局和方案金额切换，未发起真实扣款。上线后仍需在重新编译的小程序中验收一次实际微信支付。

2026-09-12 已使用实际配置对随机不存在的订单做只读 V3 查单，收到 HTTP 200、业务码 `23000001`（交易不存在），且汇付响应验签通过。这证明账号签名和响应验签链路可用；不代表已验证 AppID 绑定、商户支付权限或真机收银台。实际扣款及到账需用户在真机点击确认支付后验证。

本次验证结果：`npm test -- --maxWorkers=2` 全量 462 项通过；`npm run test:db` 40 项通过；TypeScript、变更文件 ESLint 和生产构建通过。默认全并发执行曾使已有页面测试触发 5 秒超时，降低运行并发后全部通过，未放宽断言或测试超时。使用隔离测试账号核对了桌面及 390px 移动布局。已重启本地 3001 开发服务，并通过隔离待查单记录确认后台轮询实际运行；检查后清理了测试账号、会话和订单。

## 开发依据

当前接入依据：[汇付 H5/PC 预下单](https://paas.huifu.com/docs/api/#/cpjs/api_cpjs_hosting)、[统一收银台交易查询](https://paas.huifu.com/docs/api/#/cpjs/api_cpjs_hostingcx)。

### 真机下单排查：20000000 与 AppID 绑定

2026-09-12 对实际失败订单进行了验签查单，`trans_stat=F`，`bank_desc=sub_mch_id与sub_appid不匹配`。项目、服务端和原订单 AppID 一致，需在斗拱商户对应的微信子商户下检查小程序 AppID 关联。`20000000` 是重复交易，不能作为首次失败原因。可在斗拱合作伙伴控台按“商户 → 商户信息 → 查看 → 一体化收款产品 → 基础支付 → 微信支付 → 详情 → 微信配置”检查并配置绑定，参见 [斗拱官方 FAQ](https://paas.huifu.com/bbs/topic/18/faq-appid-%E6%8E%88%E6%9D%83%E7%9B%AE%E5%BD%95%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98%E5%8F%8A%E6%8A%A5%E9%94%99)。

已增加失败原因字段迁移 `009_payment_failure_reason.sql`；仅将已验签响应中的已知错误映射为固定提示，不直接返回上游原文。已尝试的订单重试前先查单，只有签名有效的“交易不存在”才重发原始参数；重复交易会查询原订单，确认失败后展示原因并禁用付款按钮。此次定向测试 16 项、数据库测试 43 项通过。绑定修正后请返回“我的”创建新订单，旧失败订单不可再次支付。

- [斗拱微信小程序支付开发指引](https://paas.huifu.com/docs/bzb/#/ythsk/wxxcxzf/wxxcxzf_kfzy)
- [V3 聚合正扫](https://paas.huifu.com/docs/api/#/smzf/api_jhzs)
- [扫码交易查询](https://paas.huifu.com/docs/api/#/smzf/api_qrpay_cx)
- [接口加签验签说明](https://paas.huifu.com/docs/start/#/api_v2jqyq)：同步按字典序处理，异步验签使用原始业务字符串。
- [汇付官方 Java SDK](https://github.com/huifurepo/bspay-java-sdk-parent)
- [微信 wx.requestPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)
