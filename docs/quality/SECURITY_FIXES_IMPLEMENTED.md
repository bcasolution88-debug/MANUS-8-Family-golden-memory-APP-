# CORS、JWT 与对象级授权修复记录

## CORS

服务端不再反射任意 `Origin`。只有 `ALLOWED_ORIGINS` 中的完整 origin 才会收到 `Access-Control-Allow-Origin` 和 credentials；未授权的 preflight 返回 403。响应增加 `Vary: Origin`，并限制允许的方法和请求头。

生产环境启动时要求配置 `ALLOWED_ORIGINS`，禁止使用 `*`。请求体限制已从 50 MB 收紧为 JSON 1 MB、URL encoded 256 KB；媒体上传应使用对象存储的签名上传流程。

## JWT 和 Cookie

- 生产环境缺少 `JWT_SECRET`、`DATABASE_URL`、`OAUTH_SERVER_URL`、`VITE_APP_ID` 或 `ALLOWED_ORIGINS` 时拒绝启动。
- `JWT_SECRET` 至少 32 个字符。
- JWT 使用 HS256，并校验 issuer、audience、expiration、`appId`、`openId` 和 `name`。
- Cookie 使用 `HttpOnly`、`Secure`（生产）和 `SameSite=Lax`。
- 生产 Express 信任单层反向代理，以正确判断 HTTPS。
- 不再把 JWT 校验失败的详细内容返回给客户端。

## BOLA/IDOR

新增 `server/_core/authorization.ts`，统一提供：

- `requireFamilyMember`
- `requireFamilyAdmin`
- `requireAlbumAccess`
- `requireMediaAccess`
- `requireShareAccess`
- `requireMediaBelongsToAlbum`

这些校验均在数据库查询中将资源和 `familyMembers` JOIN，避免只根据客户端传入的 `familyId`、`albumId` 或 `mediaId` 做信任判断。

已接入的路由范围：家庭信息、成员、爱情故事、纪念日、相册列表/详情/修改/删除、媒体上传/列表/详情/修改/删除、评论、点赞、分享和分享统计。

集成测试新增跨家庭访问回归场景，覆盖家庭、相册、媒体和分享资源，要求不属于目标家庭的用户收到 `FORBIDDEN`。

## 发布前检查

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:integration
pnpm audit --prod --audit-level=high
```
