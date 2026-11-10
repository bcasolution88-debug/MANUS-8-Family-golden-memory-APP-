# Golden Memory 测试覆盖率与生产环境安全审计报告

> 审计对象：`金色韶华---家庭共享相册-的副本22`
>
> 审计时间：2026-11-11
>
> 范围：TypeScript/Expo 前端、Express + tRPC 服务端、Drizzle/MySQL、OAuth/JWT、文件存储代理、依赖树、Vitest 测试与 GitHub Actions CI。
>
> 结论：当前项目可以继续开发和测试，但**不建议直接作为生产服务公开上线**。最高优先级问题集中在 CORS 反射、JWT 密钥 fail-open、Cookie 安全属性、对象级授权缺口、上传接口信任客户端参数，以及依赖树中的高危/严重漏洞。

## 1. 执行摘要

| 领域 | 当前结论 | 风险等级 |
|---|---|---:|
| TypeScript | 之前的 89 条类型问题已修复，当前应保持 `pnpm check` 通过 | 低 |
| 单元/集成测试 | 现有测试数量很少，覆盖率极低；集成测试依赖 MySQL | 高 |
| 认证基础 | JWT 使用 HS256 且没有明确的生产 fail-closed 校验；未校验 token 的 `appId` 与当前应用一致 | 严重 |
| CORS/CSRF | 服务端将任意请求 Origin 原样写入 `Access-Control-Allow-Origin`，同时允许 credentials | 严重 |
| 对象级授权 | 多个媒体、互动、分享和统计接口只做“已登录”校验，没有验证用户是否属于目标家庭/相册 | 严重 |
| Cookie | 全局 `SameSite=None`，生产请求是否 HTTPS 依赖转发头；未看到统一的 production assertion | 高 |
| 上传/存储 | `fileName`、`albumId`、`familyId` 等客户端参数未充分绑定到数据库权限和实际对象；预签名 URL 生成逻辑仍是占位/弱校验 | 高 |
| 数据库 | 通过 `drizzle(process.env.DATABASE_URL)` 懒初始化，没有显式连接池、超时、TLS 和生命周期配置 | 高 |
| 依赖 | `pnpm audit --audit-level high` 报告 6 critical、119 high、88 moderate、18 low；需先按生产路径收敛 | 严重 |

## 2. 测试与覆盖率基线

### 2.1 已执行测试

仓库当前包含两组主要测试：

- `tests/auth.logout.test.ts`：1 个已启用的 logout Cookie 行为测试。
- `tests/api.integration.test.ts`：1 个集成测试，覆盖系统、家庭、相册、媒体、互动、分享和 OAuth 路由；需要真实 MySQL 环境。

源码范围约为 150 个 TypeScript/TSX 文件。当前测试规模无法覆盖 20 多个页面、数十个 hooks、多个上传/同步/通知/AI 模块以及完整服务端路由矩阵。

### 2.2 临时覆盖率运行结果

项目原本没有安装 `@vitest/coverage-v8`。审计时临时安装了与 Vitest 2.1.x 匹配的 provider，运行 `pnpm test -- --coverage`，随后已恢复 `package.json`、`pnpm-lock.yaml` 并删除临时 `coverage/` 产物，未把临时依赖带入代码变更。

Istanbul/V8 汇总结果如下：

| 指标 | 已覆盖 | 总数 | 覆盖率 |
|---|---:|---:|---:|
| Statements | 612 | 26,542 | 2.31% |
| Branches | 4 | 160 | 2.50% |
| Functions | 3 | 188 | 1.60% |
| Lines | 当前 source-map 汇总未提供有效行计数 | — | 不作为验收指标 |

需要特别说明：这次覆盖率运行把大量未被测试导入的前端页面和模块纳入了 instrumented universe，因此整体数字反映的是“当前测试集合相对于整个源码树”的真实基线，不代表每个文件都已经被运行。服务端相对较好的文件包括：

- `server/_core/env.ts`：statement 100%。
- `server/routers.ts`：statement 100%。
- `server/_core/systemRouter.ts`：statement 80%。
- `server/_core/cookies.ts`：statement 65.71%，branch 42.86%，function 75%。
- `server/albumRouter.ts`：statement 59.29%。
- `server/familyRouter.ts`：statement 56.30%。
- `server/mediaRouter.ts`：statement 49.60%。
- `server/interactionRouter.ts`：statement 42.08%。
- `server/albumDetailRouter.ts`：statement 33.76%。
- `server/oauthRouter.ts`：statement 18.75%。

### 2.3 覆盖率改进建议

第一阶段先把覆盖率工具正式纳入开发依赖，并只统计可测试的业务源目录，排除配置文件、生成文件、迁移快照和 `app/` 页面壳层。建议配置：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^2.1.9"
  }
}
```

建议用 `vitest.config.ts` 的 `coverage.include` 精确覆盖 `server/**/*.ts`、`lib/**/*.ts` 和关键 hooks，而不是把所有 Expo 页面配置文件纳入统计。门槛应分阶段设置：

1. 第 1 个迭代：服务端鉴权、Cookie、OAuth、媒体权限和互动路由 statement ≥ 70%，branch ≥ 50%。
2. 第 2 个迭代：核心服务端与业务库 statement ≥ 80%，branch ≥ 65%。
3. 第 3 个迭代：上传、家庭成员、私密相册和分享链路增加对象级权限测试，并设置 changed-files coverage gate。

必须补充的测试类型：

- 未登录访问所有 `protectedProcedure` 的 401/UNAUTHORIZED 测试。
- 非家庭成员读取、修改和删除相册/媒体的 403 测试。
- 普通成员调用管理员接口的 403 测试。
- Cookie 的 localhost、HTTPS production、反向代理、跨站请求和 logout 测试。
- JWT 的错误密钥、过期、错误 issuer/audience、错误 appId 和空密钥测试。
- 上传文件名、文件大小、媒体类型、相册归属和 presigned URL 过期测试。
- OAuth state 重放、错误 redirect URI、错误 code 和 token 泄漏测试。
- MySQL 集成测试应在 CI 中使用隔离数据库，并在每个测试结束后清理 fixture。

## 3. 生产安全审计发现

### SEC-01：CORS 反射任意 Origin + credentials（严重）

位置：`server/_core/index.ts:34-53`

当前逻辑将任意 `req.headers.origin` 写入 `Access-Control-Allow-Origin`，并固定返回 `Access-Control-Allow-Credentials: true`。只要浏览器能让用户访问恶意站点，该站点就可能尝试携带 Golden Memory 的 Cookie 调用 API。即使浏览器对部分响应有额外限制，这仍然违反最小来源原则，并放大 CSRF 风险。

修复方案：

- 使用显式 allowlist，例如 `WEB_ORIGIN`、`MOBILE_ORIGINS`。
- 仅对 allowlist 命中的 Origin 返回 CORS 头；未命中时不设置 `Access-Control-Allow-Origin`。
- 配置 `Vary: Origin`。
- 限制 methods 和 headers，不要默认允许全部业务方法。
- 对 Cookie 认证的写操作增加 CSRF token 或 Origin/Referer 校验。
- production 禁止使用 `http://localhost` 作为回退来源。

示意代码：

```ts
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) return res.sendStatus(403);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token");
    return res.sendStatus(204);
  }
  next();
});
```

### SEC-02：JWT 密钥为空时仍允许服务启动（严重）

位置：`server/_core/env.ts:1-10`、`server/_core/sdk.ts:138-140`

`JWT_SECRET` 缺失时，`cookieSecret` 变成空字符串，JWT 仍会尝试使用空密钥签名/验证。生产环境必须 fail closed，而不是让服务以可预测配置启动。

修复方案：

- 启动时要求 `JWT_SECRET` 长度至少 32 字节，并使用随机高熵值。
- 生产环境缺失 `JWT_SECRET`、`DATABASE_URL`、`OAUTH_SERVER_URL`、存储密钥时直接退出。
- 令牌增加 `issuer`、`audience`、`jti`，并在验证时严格校验。
- `verifySession()` 必须校验 `appId === ENV.appId`，避免不同应用之间的 token 混用。
- 会话期限从一年缩短到 7–30 天，配合 refresh token 或服务端会话撤销。

示意校验：

```ts
function requireSecret(name: string, value: string, minLength = 32) {
  if (process.env.NODE_ENV === "production" && value.length < minLength) {
    throw new Error(`${name} must be configured with at least ${minLength} characters`);
  }
  return value;
}
```

### SEC-03：Cookie 默认 `SameSite=None`，安全性依赖转发头（高）

位置：`server/_core/cookies.ts:47-60`

所有环境都返回 `sameSite: "none"`。这要求 `secure=true`，而 `secure` 又依赖 `req.protocol` 或客户端可控/代理转发的 `x-forwarded-proto`。同时 Express 入口没有看到 `app.set("trust proxy", ...)` 的明确配置。

修复方案：

- production 仅通过 HTTPS 设置 Cookie。
- Web 同站部署优先使用 `SameSite=Lax`；确有跨站 OAuth 回调需求时，仅对回调交换流程使用短生命周期的临时 Cookie。
- 设置 `__Host-` 前缀 Cookie（不设置 Domain、Path=/、Secure），或严格限制 parent domain。
- 明确配置可信代理数量/地址，不直接信任任意 `x-forwarded-proto`。
- 为 session、OAuth state、refresh token 使用不同 Cookie 名称和不同生命周期。

### SEC-04：多个接口缺少对象级授权（严重）

当前 `protectedProcedure` 只检查“存在用户”，没有自动检查用户对资源的归属。已确认风险位置包括：

- `server/mediaRouter.ts`：`getMediaList`、`getMedia`、`updateMedia`、`deleteMedia`、`completeUpload` 未统一验证用户属于目标家庭/相册；`albumId`、`familyId` 由客户端直接提供。
- `server/albumRouter.ts`：媒体、相册、点赞、评论接口需要逐个验证家庭成员关系和资源归属。
- `server/albumDetailRouter.ts`：`getAlbumStats` 没有先检查调用者是否属于相册所在家庭；私密相册外的访问策略也需要明确。
- `server/interactionRouter.ts`：创建评论、点赞、分享、读取评论/点赞以及分享统计/点击没有统一验证 media/album 对应的家庭成员资格。
- `server/routers.ts:16-23`：`auth.me` 是 public procedure，但应确保 `ctx.user` 的来源和未认证返回值在所有客户端场景下都一致。

修复方案：

- 建立可复用的 `requireFamilyMember(ctx.user.id, familyId)`、`requireAlbumAccess(userId, albumId)`、`requireMediaAccess(userId, mediaId)`。
- 查询时把授权条件和资源条件放在同一个 SQL `where` 中，避免先查资源再漏掉权限判断。
- 更新/删除使用 `WHERE id = ? AND allowed_condition`，并检查 affected rows。
- 禁止客户端决定 `familyId`；由 `albumId` 在服务端查询出 familyId 后再授权。
- 对“公开相册”定义明确的公开分享 token 机制，不要把“已登录”当作公开访问条件。

### SEC-05：上传流程信任客户端文件元数据（高）

位置：`server/mediaRouter.ts:22-74`、`136-141`

`fileSize`、`fileName`、`fileType`、`albumId`、`familyId` 均来自客户端；生成的 URL 使用字符串拼接，并没有展示真正的 S3 presign、对象存在性检查、MIME sniffing、大小上限和病毒扫描。文件名只做了 URI 编码，不等于安全的对象 key 规范化。

修复方案：

- 服务端从授权后的 album 推导 familyId。
- 使用随机 UUID 作为 object key，不使用原始文件名作为路径组成部分。
- 服务端设置最大文件大小、允许 MIME 白名单、扩展名与 MIME 一致性检查。
- 完成上传前通过 HEAD/对象元数据确认实际大小和 Content-Type。
- presigned URL 设置短过期时间、固定 Content-Type、固定 Content-Length 范围。
- 对图片/视频执行恶意内容检测和 EXIF 隐私清理。
- 不返回长期有效的存储 URL，使用短期签名读取或经过授权的下载代理。

### SEC-06：存储代理需要防止路径和签名 URL 滥用（高）

位置：`server/_core/storageProxy.ts:4-46`

当前路由没有认证/授权层，直接根据 URL path 的 key 请求后端 presign 并 307 重定向。虽然目标 base URL 来自环境变量，仍需要确认 key 是否属于当前用户可访问的家庭媒体，并校验后端返回的 URL host 是否为受信任存储域名。

修复方案：

- 默认要求登录；公开分享使用不可猜测、可撤销、限时的 share token。
- 将 key 映射到数据库 media 记录后再授权，不让客户端任意指定 storage path。
- 校验返回 URL 的协议、host 和允许的 bucket；拒绝 `http:`、内网地址和非预期域名。
- 对 key 长度、字符集和路径穿越进行限制。
- 增加响应大小、重定向次数和速率限制。

### SEC-07：数据库连接池与 TLS/超时没有显式策略（高）

位置：`server/db.ts:25-38`

当前通过连接串懒创建 Drizzle 实例，没有显式配置连接池大小、连接超时、空闲回收、TLS、重试和关闭生命周期。生产高并发、数据库重启或网络抖动时，可能出现连接耗尽、请求堆积或数据访问异常。

修复方案：

- 使用 `mysql2.createPool()` 明确配置 `connectionLimit`、`connectTimeout`、`enableKeepAlive`、`idleTimeout`/回收策略。
- 生产数据库强制 TLS，并校验证书。
- 在应用 shutdown 时调用 `pool.end()`。
- 为慢查询、连接池耗尽和重试次数接入指标和日志。
- 事务性业务使用显式 transaction；删除家庭、相册、媒体时设置清晰的外键和级联策略。
- `DATABASE_URL` 不写入日志，不在异常响应中回显。

### SEC-08：生产请求体限制过大且没有速率限制（高）

位置：`server/_core/index.ts:55-56`

全局 JSON 和 URL-encoded body 都允许 50MB。对于 tRPC/认证接口来说过大，容易放大内存 DoS。上传应走对象存储直传，不应依赖 API body。

修复方案：

- 普通 API body 限制在 256KB–1MB；按路由单独设置。
- 文件上传使用 presigned multipart upload。
- OAuth、登录、分享点击、评论、通知接口增加 IP + user ID 速率限制。
- 反向代理层同时设置 header、body、连接数和超时限制。
- 增加请求 ID、耗时、状态码和限流命中率指标。

### SEC-09：服务端和客户端存在敏感调试日志（中高）

代码中大量 `console.log` 会输出 API URL、响应 headers、Cookie 接收信息、用户对象、session token 前缀以及资源 ID。特别是 `lib/_core/api.ts`、`lib/_core/auth.ts`、`hooks/use-auth.ts` 和 `server/_core/sdk.ts`。

修复方案：

- 生产构建关闭 debug 日志。
- 统一结构化 logger，默认不记录 Authorization、Cookie、token、email、完整用户对象或媒体 URL。
- 日志做字段脱敏、采样和访问控制。
- 错误响应返回通用 message，详细错误只写服务端关联 request ID。

### SEC-10：依赖树存在大量高危/严重漏洞（严重）

`pnpm audit --audit-level high` 当前结果：**6 critical、119 high、88 moderate、18 low**。审计输出明确涉及：

- `brace-expansion`：DoS，多个 Expo/React Native 工具链路径。
- `axios`：当前锁定路径涉及 HTTP/2 adapter DNS lookup bypass 和未处理 error 导致的 DoS；修复版本提示为 `>=1.20.0`。
- `body-parser`、`compression`、`undici`：DoS/TLS 相关问题。
- `zod`：大输入导致内存耗尽，修复版本提示为 `>=4.6.6`。
- `node-forge`：RSA/ASN.1/X.509/TLS 相关漏洞，部分路径没有简单的安全升级范围。
- `flatted`、`source-map-js`、`launch-editor`、`decode-uri-component` 等传递依赖。

修复顺序：

1. 先执行 `pnpm audit --prod --audit-level high`，区分运行时依赖和开发工具链。
2. 执行 `pnpm why <package>` 找出每个漏洞的顶层引入者。
3. 优先升级直接依赖和 Expo SDK 允许的补丁版本，不要对 Expo 栈盲目使用 `pnpm update --latest`。
4. 升级后重新执行 `pnpm check`、`pnpm test`、`pnpm test:integration`、web build 和 EAS 预览构建。
5. 对暂时无法消除的开发工具链漏洞，限制 CI runner 权限和网络出口，禁止将其暴露到生产运行时。
6. 将依赖审计加入 CI，并设置 critical/high 的失败策略；允许通过受审计的临时 allowlist 记录例外和到期时间。

## 4. 环境变量与上线前检查清单

当前环境变量读取点包括 `JWT_SECRET`、`DATABASE_URL`、`OAUTH_SERVER_URL`、`OWNER_OPEN_ID`、`BUILT_IN_FORGE_API_URL`、`BUILT_IN_FORGE_API_KEY`、`APP_URL`、`EXPO_WEB_PREVIEW_URL`、`EXPO_PUBLIC_WS_URL`、`AWS_S3_BUCKET` 和 `AWS_REGION` 等。

生产上线前必须：

- 通过 Vercel/EAS secrets 或云密钥管理器配置，不提交 `.env`、私钥、OAuth client secret 或 Forge/S3 token。
- 生产 `JWT_SECRET` 使用随机高熵值，且不能与预览/开发环境复用。
- `APP_URL`、`ALLOWED_ORIGINS`、OAuth redirect URI 使用 HTTPS 且精确到域名，不使用 `*`。
- 明确 `DATABASE_URL` 是否启用 TLS，并限制数据库网络入口和数据库账号权限。
- 存储密钥使用最小权限 IAM policy，仅允许目标 bucket/prefix 的 presign 和读写。
- 关闭生产 debug 日志，禁止打印 token、Cookie、Authorization header 和完整用户对象。
- 配置备份、恢复演练、密钥轮换、会话撤销和安全事件告警。
- 在上线前完成 DAST/API 越权测试，至少覆盖家庭、相册、媒体、评论、分享和上传资源的跨用户访问。

## 5. 建议实施顺序

### P0：上线阻断项

1. CORS allowlist + CSRF 防护。
2. JWT_SECRET/DATABASE_URL/OAuth/storage 配置 fail-closed。
3. 校验 `appId`、issuer、audience、过期时间，缩短 session 生命周期。
4. 为所有 media/album/comment/share 接口补对象级授权。
5. 修复上传和 storage proxy 的资源归属、key、MIME、大小和短期签名策略。
6. 对生产依赖树的 critical/high 运行时漏洞完成升级或形成有期限的风险接受记录。

### P1：上线后第一迭代

1. 显式 MySQL 连接池、TLS、超时、shutdown 和监控。
2. API body 限制、速率限制、请求超时和安全 headers。
3. 正式纳入 Vitest coverage provider，建立服务端 changed-files coverage gate。
4. 补齐认证、越权、上传、分享和 OAuth state 的负向测试。
5. 统一脱敏 logger 和安全审计日志。

### P2：持续改进

1. E2E 测试覆盖 Web、移动 OAuth、离线同步、媒体上传和推送通知。
2. 依赖升级自动化、SBOM、Dependabot/Renovate 和定期漏洞复盘。
3. 图片 EXIF 清理、恶意文件扫描、内容审核和数据保留策略。
4. 数据库慢查询、连接池、存储带宽、失败率和越权拒绝事件监控。

## 6. 验收命令

```bash
pnpm check
pnpm test
pnpm test:integration
pnpm audit --prod --audit-level high
pnpm exec prettier --check .

# 配置覆盖率 provider 后
pnpm test -- --coverage

# 生产构建/部署前
pnpm build
npx expo export --platform web
npx expo-doctor
```

本报告只记录审计和建议，没有把临时覆盖率 provider 或覆盖率生成物留在工作树中。