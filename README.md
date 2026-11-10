# 金色韶华 · Golden Memory

面向家庭和中老年用户的共享相册应用，支持照片/视频上传、纪念日提醒、爱情故事记录、家庭成员协作、中英双语、昼夜模式和适老化界面。

## 项目概览

- **客户端**：Expo SDK 54、React Native、Expo Router、TypeScript、NativeWind/Tailwind CSS
- **服务端**：Express + tRPC、Drizzle ORM、MySQL/PostgreSQL 兼容数据访问层
- **身份与存储**：项目模板内置用户认证、文件存储和服务端 API 集成能力
- **核心功能**：家庭相册、时间线、纪念日、故事章节、视频工作室、消息、成员权限、离线同步、推送通知、AI 辅助能力
- **设计方向**：金色品牌视觉、Light/Dark 双主题、中英双语和 Elder Mode 适老化模式

## 目录结构

```text
app/          Expo Router 页面
components/   可复用 UI 组件
hooks/        业务 hooks 与数据同步逻辑
lib/          上传、缓存、通知、AI、分享和国际化模块
server/       Express/tRPC 服务端
shared/       前后端共享类型和 schema
 drizzle/     Drizzle 数据表和迁移
assets/       图标、启动图和静态资源
tests/        测试代码
docs/         部署演示和项目资料
```

## 本地启动

```bash
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm check       # TypeScript 类型检查
pnpm lint        # Expo ESLint 检查
pnpm test        # Vitest 测试
pnpm build       # 构建服务端产物
pnpm start       # 启动生产服务
```

请根据部署环境配置所需的数据库、认证、文件存储和通知变量。真实凭据不应提交到 Git；本地环境文件应使用 `.env.local` 等被 `.gitignore` 忽略的文件保存。

## 主要页面

Splash、Login、Register、Home、Anniversary、Stories、Album、Upload、Studio、Timeline、Members、Messages、Me、Settings 和 Elder Home 等页面已经纳入 Expo Router。

详细的页面设计、数据流和用户流程见 [`design.md`](./design.md)，后端接入路线见 [`BACKEND_INTEGRATION_PLAN.md`](./BACKEND_INTEGRATION_PLAN.md)。

## 部署资料

生产部署演示资料位于 [`docs/deployment/`](./docs/deployment/)，包含 HTML 幻灯片、Markdown 内容以及 PDF/PPTX 导出文件，覆盖 Docker、PM2、Nginx、监控、回滚、安全和成本分析等主题。

## 注意事项

- 不要提交 `node_modules/`、构建产物、`.env`、证书或私钥。
- 发布移动端前，请在 `app.config.ts` 中确认应用标识、图标、权限和深链配置。
- 生产环境请替换示例配置，并完成数据库迁移、对象存储、通知和 OAuth 的实际接入验证。
