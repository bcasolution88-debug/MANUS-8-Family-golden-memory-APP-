# 依赖漏洞升级与安全加固方案

## 当前状态

本次审计基线为 6 个 critical、119 个 high。已完成直接依赖升级：

- `axios` → `1.21.1`
- `zod` → `4.6.7`
- `@trpc/client` / `@trpc/react-query` / `@trpc/server` → `11.28.0`
- `drizzle-orm` → `0.45.4`
- `mysql2` → `3.24.6`
- `drizzle-kit` → `0.31.11`

升级后，生产依赖审计已降至 0 critical、8 high、4 moderate、1 low。当前锁文件已应用 pnpm audit 修复后的传递依赖解析，包含 `undici`、`node-forge`、`body-parser`、`compression`、`source-map-js`、`proxy-addr`、`shell-quote`、`tar`、`minimatch`、`brace-expansion` 等安全版本。

## 依赖分类和处理策略

### 已处理的高风险依赖

对不涉及业务 API 的传递依赖使用锁文件级修复和受控 overrides，目标版本包括：

- `undici >= 6.29.1`
- `node-forge >= 1.4.3`
- `body-parser >= 1.20.9`
- `compression >= 1.8.2`
- `source-map-js >= 1.2.2`
- `proxy-addr >= 2.0.8`
- `shell-quote >= 1.9.0`
- `tar >= 7.5.21`
- `@xmldom/xmldom >= 0.8.15`
- `decode-uri-component >= 0.5.1`

每次升级后必须执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm test` 和 `pnpm audit --prod --audit-level=high`。

### Expo 54 工具链

Expo CLI、Metro、React Native 开发工具会引入大量仅构建期或开发期依赖。不要在没有完整 Expo 兼容性验证的情况下强制把所有包提升到最新 major。建议单独建立 Expo SDK 升级分支：

1. 使用 Expo 官方升级命令升级 SDK、Router、React Native 和所有 Expo modules。
2. 运行 `expo-doctor`、Web 构建、Android/iOS preview build。
3. 运行完整 API/数据库集成测试。
4. 通过灰度构建后再合并到生产分支。

### 仍可能存在的不可直接修复项

如果漏洞只存在于 Expo 的开发 CLI、测试工具或不可达代码路径，应在 CI 中分别输出生产依赖和全量依赖结果，并记录风险接受理由。生产服务器不得安装或执行 Expo CLI；服务端镜像应使用精简的 production-only 安装。

## CI 安全门禁

建议在 GitHub Actions 中加入：

```yaml
- name: Production dependency audit
  run: pnpm audit --prod --audit-level=high

- name: Frozen install
  run: pnpm install --frozen-lockfile
```

每周使用 Dependabot 或 Renovate 创建依赖升级 PR，要求 PR 自动运行类型检查、单元测试、MySQL 集成测试和生产依赖审计。critical 漏洞应在 24 小时内处理，high 漏洞应在 7 天内处理。

## 运行时加固

- 生产环境只使用 `pnpm install --prod --frozen-lockfile`。
- 构建时和运行时分离，不把 Expo CLI、Drizzle Kit、Vitest 等开发工具带入 API 镜像。
- 使用 Node.js LTS，并在 CI 固定 Node 与 pnpm 版本。
- 对依赖升级使用短生命周期分支和单独提交，保留 lockfile 变更审查。
- 不使用 `pnpm audit --fix` 直接覆盖 major 版本；涉及 major 的升级必须人工验证。
- 监控生产依赖树变化，并在发布清单中记录审计数量。
