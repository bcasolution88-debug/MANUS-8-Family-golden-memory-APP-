# Golden Memory Express/tRPC 后端部署指南

本文针对仓库中的 Express + tRPC + Drizzle/MySQL 服务，提供三种部署方式：Docker 云服务器、Railway 和 Zeabur。前端 Expo Web 可以继续部署到 Vercel；移动端通过 EAS 构建时，将 `EXPO_PUBLIC_API_URL` 和 `EXPO_PUBLIC_WS_URL` 指向这里的后端域名。

## 运行时约定

服务端构建命令是 `pnpm build`，产物为 `dist/index.js`，生产启动命令是 `node dist/index.js`。容器监听 `process.env.PORT`，默认端口为 `3000`，健康检查地址为 `/api/health`。

仓库内的 `Dockerfile` 使用 builder/runtime 两阶段构建：builder 安装完整依赖并执行 esbuild，runtime 只安装生产依赖、复制 `dist`，并以非 root 用户启动。Docker 官方 Node.js 指南也采用分阶段构建来分离编译依赖和生产运行时。[1]

不要把 `.env`、数据库密码、JWT 密钥、OAuth secret 或 AWS secret 写入镜像、GitHub 仓库或前端 bundle。将它们配置在部署平台的 Secret/Environment Variables 中。

## 必需环境变量

生产服务至少需要以下变量：

```text
NODE_ENV=production
PORT=3000
VITE_APP_ID=<Manus application id>
JWT_SECRET=<至少 32 个随机字符>
JWT_ISSUER=golden-memory
JWT_AUDIENCE=golden-memory-client
DATABASE_URL=mysql://<user>:<password>@<host>:3306/<database>
OAUTH_SERVER_URL=<OAuth server URL>
OWNER_OPEN_ID=<initial owner open id>
ALLOWED_ORIGINS=https://<your-frontend-domain>,https://<your-mobile-web-domain>
APP_URL=https://<your-api-domain>
AWS_S3_BUCKET=<production bucket>
AWS_REGION=<bucket region>
BUILT_IN_FORGE_API_URL=<optional built-in API URL>
BUILT_IN_FORGE_API_KEY=<optional built-in API key>
```

`ALLOWED_ORIGINS` 必须填写完整的 scheme + host，不要配置为 `*`。如果前端部署在 Vercel，填写 Vercel 域名；如果有自定义域名，同时加入自定义域名。`EXPO_PUBLIC_API_URL` 和 `EXPO_PUBLIC_WS_URL` 属于客户端变量，只能放公开地址，不能放服务端密钥。

## 本地 Docker Compose

仓库中的 `docker-compose.yml` 提供 API 和 MySQL 两个服务，适合本地验证、测试服务器或小型单机部署。先复制环境模板并填写值：

```bash
cp .env.example .env
# 编辑 .env，至少填写 JWT_SECRET、MYSQL_PASSWORD、MYSQL_ROOT_PASSWORD、
# VITE_APP_ID、OAUTH_SERVER_URL、OWNER_OPEN_ID、ALLOWED_ORIGINS、APP_URL、AWS_S3_BUCKET
```

构建并启动：

```bash
docker compose build --pull
docker compose up -d mysql

docker compose run --rm api pnpm drizzle-kit migrate
docker compose up -d api

docker compose ps
docker compose logs -f api
```

验证：

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

停止服务：

```bash
docker compose down
# 删除本地数据库卷时会丢失数据，只有明确需要重置时才执行：
# docker compose down -v
```

生产环境建议使用托管 MySQL，而不是将数据库和 API 放在同一台机器上。若必须使用 Compose 内置 MySQL，至少将 `mysql_data` 放在可靠的云盘，并配置每日备份和恢复演练。

## 云服务器部署

适用于 Ubuntu 22.04/24.04、已有固定 IP 和 Docker 的云服务器。先开放 TCP 80/443，SSH 仅允许可信来源；不要直接把 MySQL 的 3306 暴露到公网。

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker "$USER"
newgrp docker

git clone https://github.com/bcasolution88-debug/MANUS-8-Family-golden-memory-APP-.git
cd MANUS-8-Family-golden-memory-APP-
git checkout chore/upload-golden-memory-to-github
cp .env.example .env
chmod 600 .env
${EDITOR:-vi} .env

docker compose build --pull
docker compose up -d mysql
docker compose run --rm api pnpm drizzle-kit migrate
docker compose up -d api
```

将 Nginx/Caddy 放在 API 前面提供 TLS 和域名转发。反向代理应把 `/api/*` 和 WebSocket 请求转发到 `127.0.0.1:3000`，并保留 `Upgrade`、`Connection` 等 WebSocket headers。证书可使用 Let’s Encrypt。应用使用健康检查 `/api/health`，出现异常时通过 `docker compose restart api` 恢复；正式环境应使用系统监控和日志告警，而不是只依赖 Docker 自动重启。

更新版本时：

```bash
git fetch origin
git checkout chore/upload-golden-memory-to-github
git pull --ff-only origin chore/upload-golden-memory-to-github

docker compose build --pull api
docker compose run --rm api pnpm drizzle-kit migrate
docker compose up -d api
docker compose ps
curl -fsS https://api.example.com/api/health
```

回滚时切换到上一个已验证的 Git commit，重新构建 API 镜像。数据库迁移必须采用向后兼容策略；不要用回滚应用版本的方式逆向删除已经执行的生产迁移。

## Railway 部署

仓库根目录的 `Dockerfile` 和 `railway.json` 已配置完成。Railway 会在源代码根目录自动检测名为大写 `Dockerfile` 的文件；也可以通过配置指定 Dockerfile 路径。[2]

操作步骤：

1. 在 Railway 创建 Project，选择 **Deploy from GitHub Repo**。
2. 选择 `bcasolution88-debug/MANUS-8-Family-golden-memory-APP-`。
3. 将分支设为 `chore/upload-golden-memory-to-github`，或在合并后使用 `main`。
4. 在 Service Variables 中添加“必需环境变量”章节列出的生产变量。
5. 不要手动固定 Railway 的 `PORT`；容器会使用平台注入的 `PORT`。应用已经监听 `process.env.PORT`。
6. 将 Healthcheck Path 设置为 `/api/health`。Railway 会在将新版本接入流量前等待健康检查成功，失败时不会将该版本作为可用部署。[3]
7. 生成 Public Domain，并把该域名写入前端的 `EXPO_PUBLIC_API_URL` 和 EAS production 环境。

Railway 变量只应通过 Railway Variables/Secrets 配置。若 Docker 构建阶段需要 Railway 注入的变量，必须在对应 Dockerfile stage 中使用 `ARG`；本项目构建阶段不需要生产密钥，因此不要把密钥传入 build stage。[2]

数据库迁移建议使用一次性命令或独立 migration service：

```bash
pnpm drizzle-kit migrate
```

迁移完成后再让 API 进入生产流量。Railway 服务横向扩容时，数据库和对象存储必须是共享的，不能依赖容器本地文件系统。

## Zeabur 部署

Zeabur 会自动识别项目根目录的 `Dockerfile`，并使用它构建服务；部署页面中配置 Environment Variables 和公开端口即可。[4] Zeabur 的 Node.js 部署要求服务使用 `process.env.PORT`，本项目已满足这一要求。[5]

操作步骤：

1. 在 Zeabur 创建 Project，导入 GitHub 仓库。
2. 选择后端服务目录为仓库根目录。
3. 确认使用根目录 `Dockerfile`，不要把 `docker-compose.yml` 作为 Zeabur 部署输入；Zeabur 当前不直接用 Docker Compose 部署服务。[4]
4. 在 Environment Variables 中填写生产变量。
5. 在 Networking/Ports 中暴露容器的 `PORT`，通常为 `3000`；如果平台注入其他端口，应用会自动读取。
6. 添加或使用 `/api/health` 作为健康检查地址。
7. 生成公网域名，并将该域名配置到 Expo Web 和 EAS 的公开 API 变量。

若仓库中存在多个服务或 Dockerfile，可使用 Zeabur 的 `ZBPACK_DOCKERFILE_PATH` 或服务命名规则指定文件；当前单服务仓库无需额外 `zbpack.json`。[4]

## GitHub Actions 与发布策略

当前 CI 包含：

- `pnpm install --frozen-lockfile`
- TypeScript 检查
- Vitest 单元测试
- critical 级生产依赖审计
- MySQL 8.4 集成测试
- Drizzle migration
- API、家庭、相册、媒体、互动和对象级授权测试

建议后续将部署拆成两个阶段：CI 通过后构建并推送镜像到 GHCR；Railway、Zeabur 或云服务器只部署经过 CI 验证的 commit/tag。生产发布前先执行 migration，再切换流量，并保留上一个镜像版本用于快速回滚。

## 故障排查

- **Application failed to respond**：检查服务是否监听平台注入的 `PORT`，以及容器是否暴露同一个内部端口；不要只监听 `127.0.0.1`。
- **健康检查失败**：查看 `docker compose logs api` 或平台部署日志，确认 `/api/health` 不需要登录且返回 2xx。
- **启动时报缺少变量**：生产环境的 `assertSecureRuntimeConfig()` 会主动拒绝缺少 JWT、数据库、OAuth 或 CORS 配置的服务。
- **上传测试失败**：生产必须配置真实对象存储 bucket；CI 使用 `AWS_S3_BUCKET=golden-memory-test` 仅用于生成测试签名 URL，不代表真实生产 bucket。
- **数据库连接失败**：确认 MySQL 允许来自 API 的网络访问、TLS/白名单配置正确，并在执行 migration 前备份数据库。
- **CORS 错误**：将浏览器实际 Origin 加入 `ALLOWED_ORIGINS`，不要加入末尾路径，也不要用通配符替代域名白名单。

## References

[1]: https://docs.docker.com/guides/nodejs/ "Docker Node.js language-specific guide"
[2]: https://docs.railway.com/builds/dockerfiles "Railway Dockerfiles"
[3]: https://docs.railway.com/guides/deploy-node-express-api-with-auto-scaling-secrets-and-zero-downtime "Railway Node Express API deployment and healthchecks"
[4]: https://zeabur.com/docs/en-US/deploy/methods/dockerfile "Zeabur deploying with Dockerfile"
[5]: https://zeabur.com/docs/en-US/guides/nodejs "Zeabur Node.js deployment guide"
