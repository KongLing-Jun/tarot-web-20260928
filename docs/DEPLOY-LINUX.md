# 在 Docker 中编译，通过 Git 传输，在 Linux 上运行

Docker 只用于 Windows 开发机上的 Linux 编译。输出的是普通 `.tar.gz` 运行包，包含 Next.js standalone、Linux 依赖、静态文件、数据库迁移和启动脚本。服务器只需 Node.js 24，不需要 Docker、npm install 或再次编译。

## 构建并通过 Git 发布

启动 Docker Desktop，选择 Linux 容器。在项目根目录执行：

```powershell
# Intel / AMD 服务器，uname -m 为 x86_64
npm run build:linux

# 仅在 ARM 服务器（aarch64）时改用这一条
npm run build:linux:arm64
```

镜像使用 `node:24-bookworm`。运行包面向对应架构的 glibc Linux，建议服务器使用 Debian 12 或 Ubuntu 22.04 及更新版本；不适用于 Alpine/musl 或过旧的 glibc 系统。

默认产物为：

```text
release/tarot-whisper-linux-amd64.tar.gz
release/tarot-whisper-linux-amd64.tar.gz.sha256
```

ARM 文件名使用 `arm64`。压缩包保留隐藏目录、权限和符号链接，避免 Windows Git 改变 Linux 依赖文件。构建上下文不包含本机 `node_modules`、`.next`、`.env*`、真实 `model.config.json` 或 Git 元数据。构建使用示例配置，发布包只保留示例，不包含生产配置。

确认改动后提交构建配置及所需架构的产物，再推送到自己的远程仓库，例如：

```sh
git add release/tarot-whisper-linux-amd64.tar.gz release/tarot-whisper-linux-amd64.tar.gz.sha256
git commit -m "Publish Linux amd64 build"
git push origin HEAD
```

这是普通文件发布包，不能使用 `docker load`。每次构建会更新压缩包；普通 Git 会累积历史二进制，频繁发布时可以使用 Git LFS，并在服务器安装 Git LFS。脚本会拒绝超过 100 MiB 的普通 Git 产物。

## 服务器首次运行

先安装 Node.js 24 和 Git，克隆仓库或在已有克隆中 `git pull --ff-only`。以下命令在服务器仓库根目录执行，以 amd64 为例：

```sh
# 校验下载后的完整性
(cd release && sha256sum -c tarot-whisper-linux-amd64.tar.gz.sha256)

# 每次发布都解压到新的目录，避免旧依赖残留
release_dir="$HOME/tarot-releases/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$release_dir"
tar -xzf release/tarot-whisper-linux-amd64.tar.gz -C "$release_dir"
cd "$release_dir"

# 配置直接放在运行包根目录，只需首次创建和填写
if [ ! -f model.config.json ]; then
  cp model.config.example.json model.config.json
  chmod 600 model.config.json
fi
```

默认读取**运行包根目录的 `model.config.json`**，与 `server.js` 同级：

```text
运行包根目录/
├── server.js
├── model.config.json
├── model.config.example.json
├── scripts/
├── node_modules/
└── .next/
```

编辑该 `model.config.json`，填写数据库、模型、微信和 OSS 参数。监听地址、端口继续使用 `WEB_HOST`、`WEB_PORT`。然后在解压目录执行：

```sh
node scripts/migrate-db.mjs
node scripts/start-release.mjs
```

迁移失败时先处理错误，不启动新版本。数据库必须事先存在。如果部署到全新数据库，还需按 [OSS 文档](./OSS.md) 在源码环境配置该生产数据库和 OSS 并执行 `npm run images:sync`，然后才能完整使用图片功能。发布包不包含图片同步所需的 TypeScript 开发工具。

以上为前台启动，退出终端会影响服务。正式运行应由 systemd 等进程管理器执行 `node /绝对路径/scripts/start-release.mjs`，服务用户需能读取配置；通过 Nginx 配置 HTTPS。启动脚本自动切换到发布目录，并将 `WEB_HOST`、`WEB_PORT` 传给 standalone 服务。

后续更新：拉取 Git → 校验并解压到新目录 → 将旧运行包根目录的 `model.config.json` 复制到新运行包根目录 → 执行迁移 → 将服务切换到新目录并重启。生产配置不提交 Git；发布包不携带该文件。旧目录可保留用于应用代码回退；数据库回退需独立评估。

## 本次验证（2026-09-17）

- `linux/amd64` Docker 构建、Next.js 类型检查及静态页面生成通过；运行压缩包约 44.8 MiB。
- 在独立的 `node:24-bookworm-slim` 容器中，仅挂载发布包并关闭外部网络，解压后启动成功；首页和 CSS 返回 200，未登录资料接口返回 401。
- 校验和、私有配置排除、Linux sharp 图片转码、PostgreSQL/OSS 模块加载，以及从其他工作目录启动均通过。
- 两个新增 Node.js 脚本通过 ESLint。未连接生产数据库、微信、模型、支付或 OSS 进行端到端验收；ARM 构建未执行。
- 安装现有锁定依赖时，npm audit 报告 11 项漏洞（3 moderate、7 high、1 critical，含开发依赖范围）。本次未执行自动依赖升级，需另行评估修复。
