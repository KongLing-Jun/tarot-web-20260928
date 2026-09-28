# 阿里云 OSS 配置

OSS 配置与现有模型、数据库配置一起保存在根目录 `model.config.json` 中，该文件已被 Git 忽略。配置示例见 `model.config.example.json`。

| 配置项 | 说明 |
| --- | --- |
| `ALIBABA_CLOUD_ACCESS_KEY_ID` | 服务端使用的 AccessKey ID |
| `ALIBABA_CLOUD_ACCESS_KEY_SECRET` | 服务端使用的 AccessKey Secret |
| `OSS_REGION` | 地域 ID：`cn-beijing`（华北 2，北京） |
| `OSS_ENDPOINT` | 外网 HTTPS Endpoint：`https://oss-cn-beijing.aliyuncs.com` |
| `OSS_BUCKET` | 存储空间名称：`tarotai` |
| `OSS_PUBLIC_BASE_URL` | 文件访问地址前缀：`https://tarotai.oss-cn-beijing.aliyuncs.com` |

服务端通过 `lib/api/server-config.ts` 的 `getServerSetting(key)` 读取这些字段。密钥仅供服务端使用，不放入 `NEXT_PUBLIC_*`、网页响应或小程序配置。部署时需在服务器的 `model.config.json` 中填写对应配置。客户端采用 [阿里云 OSS Node.js SDK](https://www.alibabacloud.com/help/en/oss/developer-reference/getting-started-with-oss-sdk-for-node-js)，启用 HTTPS 和 V4 签名；代码会将 `cn-beijing` 转换为 SDK 使用的 `oss-cn-beijing`。

## 初始化与同步

```sh
npm install
npm run db:migrate
npm run images:sync
npm run images:verify
```

先完成迁移和同步，再启动应用。同步脚本扫描 `public` 中的 JPG、PNG、WebP、SVG、GIF、ICO、AVIF 文件，并上传 `app/favicon.ico`。当前静态资源为 78 张塔罗牌、默认头像、噪点纹理、网站图标，共 81 个。CSS 生成的渐变和交互效果仍由页面绘制。

`images:sync` 还将数据库中已有的内嵌头像和本地头像路径迁移为 OSS URL，并设置用户表的默认头像 URL。新头像在服务端重新编码为 256×256 WebP 后上传。上传成功后先登记图片资源，再更新用户资料；不将 base64 写入数据库。迁移头像时会比对原值，避免覆盖同步过程中用户新保存的头像。

对象键包含内容的 SHA-256，文件更新产生新的 URL，避免浏览器长期缓存旧内容。重复同步会核对数据库摘要、当前 URL 和 OSS 对象大小，跳过未变化文件；中断后可重新执行。源码中的图片文件保留为同步输入。

## 图片资源表与访问

`database/003_image_assets.sql` 创建 `tarot_image_assets`：

| 字段 | 用途 |
| --- | --- |
| `asset_key` | 唯一逻辑路径，例如 `/cards/major/00-fool.jpg` |
| `kind` | `static` 或 `avatar` |
| `user_id` | 头像所属用户；静态资源为空 |
| `object_key` | OSS 对象键，唯一 |
| `url` | 对应的 HTTPS 图片 URL |
| `content_type`、`byte_size`、`sha256` | 文件类型、字节数和内容摘要 |
| `created_at`、`updated_at` | 创建、更新时间 |

`/cards/*`、`/avatars/default.svg`、`/textures/*` 和 `/favicon.ico` 在访问本地文件前重写到 `/api/assets/*`。接口查询图片资源表，返回 307 跳转，浏览器直接从 OSS 下载图片；逻辑路径映射缓存 5 分钟，带摘要的 OSS 图片缓存一年。旧占卜记录和本地缓存中的牌图路径因此仍然可用。资源不存在返回 404，数据库故障返回 503，不回退到本地图片。

头像 URL 直接从用户资料返回。新增微信用户和恢复默认头像时均从资源表读取默认头像 URL。公共读取接口仅查询 `static` 资源，不列出用户头像记录。Bucket 使用现有公共读权限，上传通过服务端签名完成。

旧版本图片及未被用户引用的已上传对象不会自动删除，以保留历史 URL，并避免误删共享对象。数据库写入失败或资料冲突可能留下未引用对象；后续清理应先核对数据库引用。

## 验证

`npm run images:verify` 匿名读取图片资源表中的全部 URL，核对 MIME、字节数和 SHA-256，并检查所有用户头像都已登记。它会产生对应的 OSS 读取请求和流量。

`npm test` 覆盖上传失败、图片转码、所有权、静态图片跳转和路径校验。`npm run test:db` 使用真实数据库验证用户和图片资源关联，测试头像的 OSS 上传使用模拟响应，避免向正式 Bucket 写入测试对象。
