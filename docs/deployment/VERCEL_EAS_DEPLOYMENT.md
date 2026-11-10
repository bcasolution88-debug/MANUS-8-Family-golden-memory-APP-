# Golden Memory 部署配置

## 1. Vercel：部署 Expo Web 前端

本仓库的 `vercel.json` 已配置：

```json
{
  "framework": null,
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm expo export --platform web",
  "outputDirectory": "dist",
  "cleanUrls": true
}
```

在 Vercel 导入 GitHub 仓库时，当前代码分支为：

```text
chore/upload-golden-memory-to-github
```

项目设置可使用以下值：

| 设置 | 值 |
|---|---|
| Framework Preset | Other |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm expo export --platform web` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

Vercel 环境变量只配置客户端可公开读取的地址：

```text
EXPO_PUBLIC_API_URL=https://api.example.com
EXPO_PUBLIC_WS_URL=wss://api.example.com
```

不要在 Vercel 前端项目中配置或打包 `DATABASE_URL`、`AWS_SECRET_ACCESS_KEY`、OAuth client secret 等服务端密钥。当前 Express/tRPC、WebSocket 和数据库服务需要部署到独立的 Node 服务；Vercel 只负责 Expo Web 静态文件。

本地验证：

```bash
pnpm install --frozen-lockfile
pnpm expo export --platform web
pnpm dlx serve dist
```

## 2. EAS：构建 Android/iOS

本仓库的 `eas.json` 已配置三个 profile：

```json
{
  "cli": {
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development"
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "environment": "preview"
    },
    "production": {
      "environment": "production"
    }
  }
}
```

首次配置：

```bash
pnpm install --frozen-lockfile
pnpm add --global eas-cli
eas login
eas whoami
eas build:configure
```

构建命令：

```bash
# Android 内部测试 APK
eas build --platform android --profile preview

# Android 商店 AAB
eas build --platform android --profile production

# iOS TestFlight/App Store 构建
eas build --platform ios --profile production

# Android + iOS
eas build --platform all --profile production
```

`preview` 的 Android 输出是 APK，适合直接安装到测试设备；`production` 默认使用商店发布格式，Android 为 AAB，iOS 为商店构建。

## 3. EAS 环境变量

建议在 Expo 项目中分别建立 `development`、`preview`、`production` 环境：

```bash
eas env:set --name EXPO_PUBLIC_API_URL --value https://api.example.com --environment production --visibility plaintext
eas env:set --name EXPO_PUBLIC_WS_URL --value wss://api.example.com --environment production --visibility plaintext
```

`EXPO_PUBLIC_*` 会进入移动端 bundle，不能存放密钥。数据库、S3 和 OAuth 私钥只能配置在后端服务；如果构建过程确实需要某个 secret，应使用 EAS 的 sensitive/secret visibility，并确保它不会被嵌入客户端。

## 4. 数据库迁移

本次代码修复新增了两个 schema 表：

- `oauthAccounts`
- `shares`

迁移文件：

```text
drizzle/0002_tranquil_mesmero.sql
```

迁移内容仅创建这两张表，没有删除表或删除数据。生成/检查命令：

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit check
```

在正式数据库执行迁移前，应先备份数据库，并在 staging 环境验证。执行迁移使用项目后端的数据库发布流程；不要在 Vercel 构建阶段自动执行迁移。若使用 Drizzle Kit，可以在已设置 `DATABASE_URL` 的后端环境运行：

```bash
pnpm drizzle-kit migrate
```

## 5. GitHub Actions 可选构建

EAS CI 需要在 GitHub Actions secrets 中添加：

```text
EXPO_TOKEN
```

推荐 workflow 步骤：

```yaml
- uses: actions/checkout@v5
- uses: actions/setup-node@v6
  with:
    node-version: 22
    cache: pnpm
- uses: pnpm/action-setup@v4
  with:
    version: 9.12.0
- uses: expo/expo-github-action@v8
  with:
    eas-version: latest
    token: ${{ secrets.EXPO_TOKEN }}
- run: pnpm install --frozen-lockfile
- run: eas build --platform all --profile production --non-interactive --no-wait
```

正式启用 CI 前，先在本地完成一次交互式 EAS 构建，确认 Expo project ID、Android/iOS package identifier 和签名凭据均已准备好。
