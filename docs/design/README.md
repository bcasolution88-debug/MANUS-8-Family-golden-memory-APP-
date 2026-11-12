# 金色韶华 · Golden Memory — UI 设计图集

本目录包含基于仓库现有源代码逆向还原的**全套安卓端 UI 设计图**与**后端架构设计图**。

- **在线交互版**：打开 [`index.html`](./index.html)（任意静态服务器，例如 `python3 -m http.server`），含侧边导航、Android 手机外框、Light / Dark / Elder 三种模式。
- **PNG 导出**：[`exports/`](./exports/) 目录，可直接在 GitHub 预览。

## 设计依据（源码映射）

| 设计图来源 | 仓库文件 |
|---|---|
| 页面结构与文案 | `app/**/*.tsx`、`lib/i18n.ts` |
| 颜色 token（Light / Dark） | `theme.config.js`、`tailwind.config.js` |
| 底部 Tab 与导航 | `app/(tabs)/_layout.tsx`、`app/_layout.tsx` |
| 后端分层架构 | `server/_core/index.ts`、`server/routers.ts`、`docker-compose.yml` |
| tRPC API 路由表 | `server/*Router.ts`、`server/_core/systemRouter.ts` |
| 数据库 ER 图 | `drizzle/schema.ts` |
| 核心时序流程 | `server/mediaRouter.ts`、`server/oauthRouter.ts`、`server/interactionRouter.ts`、`BACKEND_INTEGRATION_PLAN.md` |

## 章节一览

| # | 章节 | 导出文件 |
|---|---|---|
| 01 | 设计系统（色彩 / 字体 / 组件原子 / 圆角间距 / 导航模式） | `exports/01-design-system.png` |
| 02 | 页面导航地图（25 个 Expo Router 路由） | `exports/02-navigation-map.png` |
| 03 | 启动与认证流程（Splash / Login / Register / Forgot / 2FA / OAuth 回调） | `exports/03-auth-flow.png` |
| 04 | 主框架 · 底部 5 Tab（首页 / 相册 / 时间线 / 消息 / 我的 + 编辑资料） | `exports/04-main-tabs.png` |
| 05 | 核心功能页（纪念日 / 爱情故事 / 上传 / 视频工作室 / 家庭成员） | `exports/05-feature-screens.png` |
| 06 | 媒体详情与互动（相册列表 / 照片 / 视频 / 分享 / 通知 / 设置） | `exports/06-media-interaction.png` |
| 07 | 长辈模式 · 夜间模式 · 英文版 | `exports/07-elder-dark-en.png` |
| 08 | 后端系统架构（客户端 → API → 路由 → 数据 → 部署） | `exports/08-backend-architecture.png` |
| 09 | tRPC API 路由设计（17 子路由 / 175 procedures + REST 端点 + 限流标注） | `exports/09-trpc-api.png` |
| 10 | 数据库 ER 设计（34 张表，新增 onCallShifts / onCallHandovers / targetCopyJobs / storageOrphanScans · restoreJobs.uploadedKeys · 新增 alertIncidents / copyExperimentStats · alertChannels.tier · backupTargets 配额 / 保留 / 存储类别 · restoreJobs items / created / undoneAt · accountMerges.choices） | `exports/10-database-er.png` |
| 11 | 核心时序流程（私有上传 / OAuth / 互动通知 / 语音评论 / 分享生命周期） | `exports/11-sequence-flows.png` |

## 单屏 PNG（`exports/screens/`）

34 张单独的 Android 手机设计稿，按认证 → 主 Tab → 功能页 → 媒体互动 → 模式变体顺序编号。

## v16 变更（与 P15 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 运维面板「值班排班」卡：T1–T3 当班人、每周班次列表（层级 / 启停 / 删除）、最近交接、添加班次 + 手动交接弹层 | `server/_core/onCall.ts`（`shiftCovers / pickOnDuty / rosterPreview / onDutyFor / notifyOnDuty / recordRotationHandovers / manualHandover`）、`onCallShifts` / `onCallHandovers` 表、`alertIncidents.notifyTier` 直通当班人、`ops.onCall / addShift / updateShift / removeShift / handover` |
| 运维面板「存储孤儿清理」卡：立即扫描、每次扫描摘要、展开键列表、清理；撤销恢复同步删对象 | `server/storage.ts` `storageDelete / storageList`、`restoreService.ts` `uploadedKeys / deleteStorageKeys`、`server/storageOrphans.ts`、`storageOrphanScans` 表、`ops.orphanScans / scanOrphans / purgeOrphans`、`ORPHAN_MIN_AGE_HOURS` |
| Settings「互动摘要」新增附上本周精选照片 | `pushDigest.ts` `pickHighlights / highlightsCaption / loadHighlights`、`PushMessage.richContent / mutableContent`、`userPreferences.pushDigestHighlights` |
| Settings 目标面板「复制历史备份到…」：目标芯片、S3 类别覆盖、进度条、逐文件校验、取消 | `server/targetCopyService.ts`（`planCopyKeys / needsDeferredVerify / runCopyJob`）、`targetCopyJobs` 表、`backup.copyTarget / copyJobs / copyJob / cancelCopy` |
| Settings 合并弹层「数据归属审计（逐行）」：按表 / 合并筛选、原归属 → 现归属、CSV | `mergeService.ts` `ledgerToProvenance / ownershipAudit / ownershipAuditCsv`、`auth.mergeOwnership / mergeOwnershipCsv` |
| API 表：ops +8、auth +2、backup +4（17 子路由 · 175 procedures）；ER 30 → 34 张表；迁移 0012 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0012_p15_oncall_copy_jobs_orphans_highlights_uploaded_keys.sql` |

## v15 变更（与 P14 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 运维面板「告警事件」卡：活跃 / 已恢复筛选、T1–T3 层级徽标、确认（备注）弹层、展开时间线；通道层级芯片（点按循环 T1→T3）+ 添加时选择层级 | `server/_core/alertIncidents.ts`（`reconcileIncidents / nextTier / escalationDue / ackIncident / addIncidentNote`）、`alertIncidents` 表、`alertChannels.tier`、`metrics.ts` `evaluateAlerts` 接入、`ops.incidents / ackIncident / incidentNote`、`ESCALATE_AFTER_MIN` |
| 恢复弹层「逐张预览」：备份 vs 现有缩略图并排、复选框 / 全选、跳过原因；完成后「撤销本次恢复」 | `restoreService.ts` `previewRestoreItems / filterManifestItems / undoRestoreCreated / undoRestoreJob`、`restoreJobs.items / created / undoneAt`、`backup.restorePreview / undoRestore`、`restorePlan / restore / restoreAsync` `items[]`、`restoreJob.canUndo` |
| Settings「互动摘要」新增智能送达时间 / 按家庭分别发送；运维面板 A/B 卡显示累计计数、自动晋升赢家与重置 | `pushDigest.ts` `groupByFamily / smartHourFrom / learnSmartHours / decideWinner / refreshExperiment / bumpExperiment`、`copyExperimentStats` 表、`userPreferences.pushDigestSmart / pushDigestPerFamily`、`metricEvents.userId`、`push.experiment` winner / stats、`ops.resetCopyExperiment`、`AB_MIN_SENT_PER_ARM / AB_MIN_LIFT / AB_AUTO_PROMOTE / SMART_HOUR_MIN_OPENS` |
| 云盘目标「调整」面板：已用 / 配额进度条 + 刷新、保留最新 N 份 + 立即清理、S3 存储类别 + 月成本估算 | `remoteTargets.ts` `probeQuota / entriesToPrune / applyRetention / deleteFromTarget / S3_STORAGE_CLASSES / estimateMonthlyUsd`、`signS3Request` DELETE + extraHeaders、`backupTargets.keepCount / storageClass / usedBytes / quotaBytes / quotaCheckedAt`、`backup.updateTarget / targetQuota / pruneTarget`、上传后保留策略、巡检写配额 |
| 合并弹层三步向导：验证码 → 预览（源账号摘要 / 迁移条数 / 将加入家庭 / 逐家庭保留方选择）→ 确认 | `mergeService.ts` `previewMerge / defaultChoice / resolveChoices / MergeChoices`、`verificationRouter.ts` `peekCode`、`auth.previewMerge`、`completeMerge {choices}`、`accountMerges.choices` |
| API 表：ops +4、auth +1、backup +4（17 子路由 · 161 procedures）；ER 28 → 30 张表；迁移 0011 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0011_p14_incidents_escalation_restore_items_undo_quota_retention_merge_choices.sql` |

## v14 变更（与 P13 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 运维面板：按通道告警规则列表（编辑阈值 / 样本 / 窗口、恢复默认、2h 静默、开关）+ 告警通道管理（Webhook / Slack / 企业微信 / 钉钉，测试并保存） | `server/_core/alertChannels.ts`、`alertRules` / `alertChannels` 表、`metrics.ts` `loadRules / evaluateRules`、`ops.alertRules / setAlertRule / silenceAlert / alertChannels / add…/update…/remove…/testAlertChannel` |
| 恢复弹层：同名相册策略（并入 / 新建副本 / 跳过）、哈希去重、逐相册差异预览 | `restoreService.ts` `RestoreOptions / resolveAlbumName / planRestore` 差异字段、`media.contentHash`、zip 清单 `contentHash`、`restoreJobs.options` |
| Settings「互动摘要」分段；运维面板「推送文案 A/B」卡 | `server/_core/pushDigest.ts`（队列 / 每 15 min 调度 / 摘要文案 / 变体分流）、`pushDigestQueue` 表、`userPreferences.pushDigest / pushDigestHour`、`push.opened / experiment`、`ops.metrics.ab`、`hooks/use-push-navigation.ts` 上报 |
| 云盘目标多行列表（健康点 / 测试 / 启停 / 删除）、云端历史目标切换 | `backupTargets` 多行 + `health`、`backupRemoteUploads` 重试队列（指数退避）、`probeTargetsHealth` 6h 巡检、`startRemoteSyncScheduler`、`backup.updateTarget / remoteUploads / retryRemote`、按 id 的 `testTarget / removeTarget / remoteList`、恢复 `targetId` |
| 合并弹层「合并记录 / 撤销 / 导出 CSV」 | `mergeService.ts` `MergeLedger / undoMerge / purgeExpiredMerges / mergeAuditCsv`、`users.mergedIntoUserId / mergedAt`、`accountMerges.ledger / undoDeadline / undoneAt / purgedAt`、`auth.undoMerge / mergeAuditCsv`、登录拦截已合并账号 |
| API 表：ops +8、auth +2、backup +3、push +2（17 子路由 · 152 procedures）；ER 24 → 28 张表；迁移 0010 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0010_p13_alert_channels_rules_multi_targets_digest_merge_undo.sql` |

## v13 变更（与 P12 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 运维面板新增 24h / 3d / 7d 分段、七条通道的逐小时成功 / 失败柱状图、平均耗时与最近失败；告警策略卡 + 「立即评估」 | `server/_core/metrics.ts`（`recordMetric` / `metricSeries` / `metricSummary` / `evaluateAlerts` leader-only 每小时 / `pruneMetrics`）、`metricEvents` 表、push / mailer / sms / backupService / studioRouter / restoreService 埋点、`ops.metrics / evaluateAlerts`、`app/ops.tsx`；环境变量 `ALERT_EMAIL` `ALERT_MIN_RATE` `ALERT_MIN_SAMPLES` `ALERT_WINDOW_HOURS` `ALERT_COOLDOWN_MS` `METRICS_RETENTION_DAYS` |
| 恢复弹层：相册勾选 → 「后台恢复」→ 进度条（阶段 / 百分比 / 结果汇总） | `restoreJobs` 表 + `server/restoreService.ts` 队列（`enqueueRestore` / `claimNextRestore` 条件 UPDATE / `pumpRestoreQueue` / `reapRestoreJobs` / `startRestoreWorker`、`RESTORE_CONCURRENCY` `RESTORE_STALE_MS`）、`filterManifestAlbums`、`backup.restoreAsync / restoreJob / restoreJobs`、`restorePlan / restore` 的 `albums?` |
| Settings 通知区「免打扰时段」开关 + ±30 分钟、推送分类芯片、按家庭静音芯片 | `userPreferences.quietStart / quietEnd / quietTz / pushMutedTypes / pushMutedFamilies`、`server/_core/push.ts` `inQuietHours()`（跨午夜、时区）/ `pushSuppressReason()`（邀请与系统通知始终送达）、`preferences.get / update` JSON 列编码 |
| 备份块「云端备份历史」弹层 → 列出远端文件并直接恢复 | `server/_core/remoteTargets.ts` `listTarget / downloadFromTarget`（WebDAV PROPFIND depth 1 / S3 ListObjectsV2 + `canonicalQuery` 签名 / Drive files.list）、`backup.remoteList`、恢复来源 `remoteKey`、`loadRestoreArtefact` |
| 账户区「合并另一个账号」两步弹层（邮箱 → 验证码，不可撤销提示） | `server/mergeService.ts`（`findMergeSource` / `performMerge` 事务：成员角色保留、点赞去重、全部归属行改指向、手机 / 密码 / 头像补齐、`accountMerges` 审计、源账号删除）、`auth.requestMerge / completeMerge / mergeHistory`、`verificationCodes.purpose merge_account` |
| API 表：auth +3、backup +4、ops +2（17 子路由 · 137 procedures，运行时统计）；ER 21 → 24 张表；迁移 0009 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0009_p12_metrics_restore_jobs_merges_quiet.sql` |

## v12 变更（与 P11 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 新增「运维面板」页（管理员）：五张通道状态卡 + 一键测试；Settings 关于区入口 | `app/ops.tsx`、`ops.channels / testMail / testSms`、`push.test`、`app/settings.tsx` |
| 推送点击直达照片 / 相册 / 成员 / 纪念日；前台横幅 + Toast「查看」 | `server/_core/push.ts` `pushRoute()` 随 payload 下发 `route`、`hooks/use-push-navigation.ts`（响应监听、冷启动、`setNotificationHandler`）、`lib/push-route.ts` 安全路由守卫 |
| 备份列表「恢复」按钮、「从备份文件导入」、恢复计划弹层 | `server/restoreService.ts`（adm-zip 解析 / `planRestore` / `runRestore` 幂等 `restoredFrom` 标记 / 条目名防穿越）、`backup.presignImport / restorePlan / restore` |
| 登录页「邮箱密码 / 短信验证码」分段 | `auth.requestSmsLogin / completeSmsLogin`（`login_sms` 用途、仅已验证手机、不暴露账户）、`app/auth/login.tsx` |
| 云盘目标弹层三页签 WebDAV / S3 / Google Drive | `server/_core/remoteTargets.ts`（S3 SigV4 纯 fetch、Drive OAuth refresh token + multipart）、`backupTargets.kind` 扩展 + `config`、`backup.setTarget` 判别联合、`backup.gdriveAuthUrl`、`expo-web-browser` 授权 |
| API 表：auth +2、backup +4（133 procedures）；ER `backupTargets` 扩列；迁移 0008 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0008_p11_sms_login_backup_target_kinds.sql` |

## v11 变更（与 P10 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 登录 / 两步验证 / 忘记密码按渠道显示邮件或短信与脱敏目的地；Settings 新增手机号绑定弹层与「验证码发送方式」分段 | `server/_core/sms.ts`（Twilio → Webhook → console）、`auth.requestPhoneVerification / verifyPhone / removePhone / setTwoFactorChannel`、`resolveCodeChannel`、`users.phone / phoneVerifiedAt`、`userPreferences.twoFactorChannel`、`mailDiagnostics`（Resend 域名检查）、`server/opsRouter.ts`（channels / testMail / testSms，管理员） |
| Settings 通知区新增「设备推送」开关、设备列表与测试推送 | `server/_core/push.ts`（Expo Push 分批、失效标记、清理）、`pushTokens` 表、`server/pushRouter.ts`、`notifications.ts` 落库后旁路推送（`pushEnabled` 门控）、`server/reminderService.ts`（纪念日提前 7 天 / 当天提醒）、`hooks/use-push-registration.ts`（登录注册、退出注销） |
| 架构图 Redis 节点更新为「限流 + 协调锁 / leader 租约」 | `server/_core/coordination.ts`（`acquireLock / withLock / LeaderElection / runIfLeader`）、备份与提醒调度 leader-only、Studio 失联重排加锁 |
| Studio Step 3「上传自己的配乐」芯片；Settings 备份块新增 WebDAV 云盘目标弹层 | `studio.presignMusic`、`render.musicKey`、`buildMusicKey` + 代理 ACL、`videoRender.musicSource`（循环裁剪 + 淡入淡出）、`server/_core/webdav.ts`（PROPFIND / MKCOL / PUT、AES-256-GCM 封存）、`backupTargets` 表、`backup.setTarget / testTarget / removeTarget` |
| Settings 备份块新增「包含照片 / 视频原文件」开关；备份列表显示 json/zip 与云盘状态 | `buildMediaZip`（archiver，manifest + 原文件，500 MB / 2 GB 上限，skipped 清单）、`backups.format / mediaCount / skippedCount / remoteStatus`、`userPreferences.backupIncludeMedia`、`runNow.includeMedia` |
| API 表：auth +4、studio +1、新增 `push`、`ops` 路由（17 子路由 / 127 procedures）；ER 18 → 20 张表、迁移 0007 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0007_p10_push_sms_backup_targets.sql` |

## v10 变更（与 P9 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 忘记密码页改为两步（邮箱 → 验证码 + 新密码）；两步验证页接真实挑战并带 60s 重发冷却；登录页按 `requires2fa` 分流 | `server/_core/mailer.ts`（Resend → SMTP → console 降级，`delivered` 回传）、`server/verificationRouter.ts`（`requestPasswordReset / resetPassword / requestEmailVerification / verifyEmail / securityStatus / setTwoFactor / complete2fa / resend2fa`，6 位码哈希、10 分钟、5 次尝试、1/min 重发）、`verificationCodes` 表、`users.emailVerifiedAt`、`userPreferences.twoFactorEnabled`、`app/auth/forgot-password.tsx`、`app/auth/two-factor.tsx`、`app/auth/login.tsx` |
| 相册页顶部新增「按人筛选」芯片行与空态 | `ai.peopleIndex / ai.byPerson`、`app/album/index.tsx` |
| Settings 新增「安全」区（邮箱验证弹窗、两步验证开关）与真实「自动备份」块（状态 / 立即备份 / 历史列表 / 下载） | `server/backupService.ts`（`buildExport` 与 `profile.exportData` 共用、每小时调度 + 每周到期检查、保留 8 份、`BACKUP_SCHEDULER=0` 关闭）、`server/backupRouter.ts`（`list / status / runNow / download / delete`，限流 3/h）、`backups` 表、`users/{uid}/backups/*` 仅本人可读 ACL、`app/settings.tsx` |
| Studio Step 4 显示排队位次，新增「已领取 / 已重排」阶段 | `studioJobs.workerId / startedAt` + 状态索引、`claimNextJob` 条件 UPDATE 原子领取、`STUDIO_CONCURRENCY` 每进程并发、15 分钟失联重排后失败、启动 reaper + 10s 轮询 worker、`render / retry` 返回 `queuePosition`、`app/studio.tsx` |
| API 表：auth +8、新增 `backup` 路由（15 子路由 / 109 procedures）；ER 16 → 18 张表、迁移 0006 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0006_p9_verification_backups_queue.sql` |

## v9 变更（与 P8 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| Studio Step 3 新增配乐芯片、Step 4 新增「合成配乐」阶段与持久化重试 | `server/_core/videoRender.ts`（MUSIC_PRESETS：sine 和弦 + tremolo + lowpass → AAC）、`studioJobs` 表 + `reapInterruptedStudioJobs`、`studio.retry`、`app/studio.tsx` |
| 照片详情新增「AI 识别」区块；首页新增「智能推荐」卡；移除两张 AI 原型 | `server/aiRouter.ts`（analyze / get / tagPerson / peopleIndex / byPerson / recommend，`mediaAnalysis` 表）、`components/photo-ai-panel.tsx`、`components/ai-insights-card.tsx` |
| Settings 全部开关改为服务端偏好并真实生效；新增密码行与可用的数据导出 | `userPreferences` 表、`server/preferencesRouter.ts`、`createNotification / notifyFamily` 偏好门控、`timeline.list` hideActivity、`profile.exportData`、`app/settings.tsx`、`app/album/new.tsx` 预填 |
| 登录 / 注册页接真实邮箱密码 API（注册新增昵称） | `users.passwordHash`、`server/passwordAuthRouter.ts`（scrypt、`auth.register / login / changePassword / passwordStatus`）、`app/auth/login.tsx`、`app/auth/register.tsx` |
| API 表：auth +4、profile +1、studio +1、新增 `preferences`、`ai` 路由（14 子路由 / 96 procedures）；ER 13 → 16 张表、迁移 0005 | `server/routers.ts`、`drizzle/schema.ts`、`drizzle/0005_p8_studio_jobs_prefs_ai_password.sql` |

## v8 变更（与 P7 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| Studio 两张说明重写为四步真实向导（模板 → 相册选照片 → 文案 / AI / 节奏 / 转场 → 渲染进度 → 观看）；导航图 Studio 打 P7 标签 | `server/_core/videoRender.ts`（ffmpeg zoompan + xfade + drawtext）、`server/studioRouter.ts`（templates / suggest / render / job / myJobs）、`app/studio.tsx` |
| 我的页头像可点击上传；全站头像改用 `UserAvatar`（签名 URL / 首字母回退） | `profile.initAvatarUpload / completeAvatarUpload / avatarUrl`、`buildAvatarKey`（`users/{uid}/avatar/*`，登录用户可读）、`components/user-avatar.tsx`、`app/(tabs)/me.tsx` |
| Settings 存储管理 / 语言 / 清除缓存 / 账户邮箱改为真实数据 | `profile.storageUsage`（`STORAGE_QUOTA_BYTES`）、`LanguageProvider.setLanguage`、`expo-image` clearDiskCache / clearMemoryCache、`app/settings.tsx` |
| 导航图新增 `/join?code=` 加入家庭页；成员页邀请卡 / 待处理邀请新增「分享」 | `family.previewInvitation`、`app/join.tsx`（未登录暂存码、登录后首页续接）、`lib/invite-link.ts`、`app/members.tsx` |
| API 表：family +1、profile +4、新增 `studio` 路由（12 子路由 / 82 procedures）；限流新增 `studio` 6/h、`ai` 20/h | `server/routers.ts`、`server/_core/rateLimit.ts` |

## v7 变更（与 P6 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 首页 / 时间线标题处新增家庭切换芯片；我的 / 成员 / 新建相册页为行式切换器；弹层含切换 / 新建家庭 / 凭邀请码加入 | `lib/family-provider.tsx`（AsyncStorage `activeFamilyId`）、`components/family-switcher.tsx`、`hooks/use-family-id.ts` |
| 导航图新增 `/album/new` 相册创建表单；首页与相册 Tab「创建相册」指向该表单 | `app/album/new.tsx`、`app/album/index.tsx`（原 `/album` 路由不变）、`app/(tabs)/index.tsx`、`app/(tabs)/album.tsx` |
| 时间线 Tab 说明改为真实聚合数据（上传合并 +N / 评论 / 点赞 / 故事 / 纪念日，按日分组，深链） | `server/timelineRouter.ts timeline.list`、`app/(tabs)/timeline.tsx` |
| 成员页：邮箱邀请（直接入家或 12 位码 · 7 天）、待处理邀请、角色修改、移除 / 退出 | `familyRouter.inviteByEmail / listInvitations / revokeInvitation / acceptInvitation / updateMemberRole / removeMember`、`app/members.tsx` |
| 纪念日 / 爱情故事页改为真实 CRUD（作者或管理员可改删） | `familyRouter.updateAnniversary / deleteAnniversary / updateLoveStory / deleteLoveStory`、`app/anniversary.tsx`、`app/stories.tsx` |
| 我的页：真实资料、统计四格、家庭区块 | `server/timelineRouter.ts profile.update / stats`、`app/(tabs)/me.tsx` |
| API 表：family 路由 +9 procedures；新增 `timeline`、`profile` 路由（11 子路由 / 72 procedures）；`createFamily / createLoveStory / createAnniversary` 返回完整行 | `server/routers.ts`、`server/familyRouter.ts` |

## v6 变更（与 P5 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 首页 / 相册 Tab 说明改为真实数据来源（family / members / anniversaries / media.recent / album.stats） | `app/(tabs)/index.tsx`、`app/(tabs)/album.tsx`、`mediaRouter.recent` |
| 视频详情重绘说明：expo-video 原生播放签名 URL、SignedImage 封面、赞 / 评论 / 下载 | `app/video/[id].tsx` |
| 相册详情：无限滚动 + 多选批量删除 / 移动到相册弹层；API 表新增 listMedia / recent / moveMedia / deleteMany | `app/album.tsx`、`mediaRouter.listMedia / moveMedia / deleteMany`、`deleteMedia` 级联 |
| 时序 ① 新增客户端缩略图步骤；initUpload 返回 thumbnailKey / thumbnailPresignedUrl | `lib/complete-upload-manager.ts generateThumbnail`（expo-image-manipulator / expo-video-thumbnails） |

## v5 变更（与 P4 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| Upload 页重绘：逐文件进度 / ✓ / ✗ 覆盖层、目标相册横向选择 + 「以标题新建相册」；时序 ① 改为真实客户端管线 | `lib/complete-upload-manager.ts`（initUpload → XHR PUT → completeUpload，订阅式状态）、`lib/trpc-client.ts`、`app/upload.tsx`（expo-image-picker 多选） |
| Album 页：列表（服务端筛选 / 排序、SignedImage 封面、多选批删）+ 详情 `/album?albumId=`（三列宫格、照片 / 视频筛选） | `app/album.tsx`、`hooks/use-family-id.ts`、`components/signed-image.tsx` |
| Photo 详情：真实媒体 / 赞 / 评论（作者头像）；ER 图 storageKey 标注「经 SignedImage 读取」 | `app/photo/[id].tsx`、`interaction.hasLiked`、`getComments` 联表 `users` |
| 后端架构新增「Redis（可选）」盒；rateLimit 盒更新为多实例共享 | `server/_core/rateLimit.ts`（`REDIS_URL` → ioredis + rate-limit-redis；fail-open） |
| Messages 深链 → `/album?albumId=` | `app/(tabs)/messages.tsx` |

## v4 变更（与 P3 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 后端架构图新增 `rateLimit.ts`；API 表 ⏱ 标注按用户限流；REST 表标注各端点 IP 限流额度 | `server/_core/rateLimit.ts`（express-rate-limit 全局 / OAuth / 存储代理 + 按用户固定窗口桶），`index.ts` 挂载 |
| S3 改为私有对象模型：ER 图 `media.storageKey / thumbnailKey`；时序 ① 改为归属前缀键 + 服务端重算校验 + 签名 GET；REST 表 `/manus-storage/{key}` 401 / 403 / 307 | `server/storage.ts`（`buildMediaKey / buildVoiceKey / parseStorageKey`），`storageProxy.ts` 对象级授权，`mediaRouter.getSignedUrl`，迁移 `0004` |
| Photo 详情 / `CommentInput` 评论框新增麦克风；时序 ④ 语音评论 | `components/mic-button.tsx`，`hooks/use-voice-input.ts`（expo-audio），`server/voiceRouter.ts`（initUpload / transcribe） |
| Share 页重绘：有效期预设芯片、「我的分享链接」状态卡片（有效 / 已过期 / 已撤销）、撤销确认弹层；时序 ⑤ 分享生命周期 | `app/share.tsx` 接入真实 tRPC，`components/share-link-card.tsx`，`interaction.revokeShare / updateShareExpiry`，`shares.revokedAt` |
| Messages 页重绘：类型图标头像、相对时间、筛选计数、全部已读、加载更多 | `app/(tabs)/messages.tsx` 接入 `notification.list` useInfiniteQuery + markRead / markAllRead / delete + 深链 |
| Android 返回键：Stories 编辑态、Studio 向导、所有 Modal 先关闭再退出页面 | `hooks/use-back-handler.ts`，6 个 `<Modal onRequestClose>` |

## v3 变更（与 P2 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| API 路由表：`album` 与 `albumDetail` 合并为单一 `album`（create/list/get/update/delete/stats） | `server/albumRouter.ts`，`albumDetailRouter.ts` 删除 |
| 新增 `notification` 路由与 `notifications` 表（ER 图） | `server/notifications.ts`，迁移 `drizzle/0003_*.sql` |
| 角色统一 `owner / admin / editor / viewer` | `drizzle/schema.ts FAMILY_ROLES`，`authorization.ts requireFamilyEditor`，`familyRouter updateMemberRole / removeMember` |
| `likes` / `familyMembers` 唯一约束 + 7 个索引 | 迁移 0003（含 member→editor、creator→owner、去重、计数修复） |
| 时序图：通知步骤改为真实实现 | `interaction` / `media` / `family` 路由调用 `notifyMediaOwner / notifyFamily` |
| 文案全部经 `t()` / `l()` | `lib/i18n.ts` + `scripts/i18n-codemod.py`（398 处迁移） |

## v2 变更（与 P0 / P1 实现同步）

| 设计变更 | 对应实现 |
|---|---|
| 金色按钮 / 倒计时卡文字改为 `onPrimary #3D2E00`（对比度 2.1:1 → 8.9:1） | `theme.config.js` 新增 `onPrimary / primarySoft / onPrimarySoft / info / secondary`；`ThemeProvider` 自动遍历所有 token |
| 新增 Toast / Snackbar 组件（success / error / warning / info，可带操作按钮） | `components/toast.tsx` + `useToast()`；27 处 `alert()` 全部替换 |
| Elder Mode 1.25× / 1.5× 对比稿；简化 Tab 栏（隐藏时间线） | `lib/elder-mode-provider.tsx` 通过 NativeWind `rem.set()` 全局缩放；`(tabs)/_layout.tsx` 读取 `simplified` |
| Me 页「字体大小」改为三档分段控件 | `app/(tabs)/me.tsx` 驱动 `elder.setFontScale()` |
| 图标按钮 48dp 触控区（虚线示意） | 29 处 `p-2` → `min-w-[48px] min-h-[48px]` |
| 渐变卡片 | `components/gradient-card.tsx`（expo-linear-gradient），替换 5 处无效的 `bg-gradient-*` |
| 导航地图：timeline / messages / me 归入 `(tabs)/` | 文件移入 `app/(tabs)/`，修复 Tab 路由不存在的问题 |

## 重新导出

```bash
cd docs/design && python3 -m http.server 8090 &
# 使用 Playwright（chromium）对各 section / .phone 节点截图即可
```

> 设计稿中的照片使用渐变占位块代替真实图片，避免引入外链版权素材；实际 APP 中的 Mock 数据使用 Unsplash URL。
