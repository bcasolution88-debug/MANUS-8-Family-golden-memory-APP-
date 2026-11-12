import {
  bigint,
  boolean,
  index,
  int,
  longtext,
  mysqlEnum,
  mysqlTable,
  mediumtext,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Family-level roles. Unified across client (members.tsx), server authorization and DB.
 *  - owner  : family creator, full control, cannot be removed
 *  - admin  : manage members and all content
 *  - editor : upload / edit own content (was `member`)
 *  - viewer : read-only
 */
export const FAMILY_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  avatar: text("avatar"),
  relationship: varchar("relationship", { length: 64 }),
  /** P8: scrypt hash for email + password accounts (null for OAuth-only users). */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** P9: set once the user proves ownership of `email` via a mailed code. */
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  /** P10: E.164 mobile number for SMS codes (optional) and when it was verified. */
  phone: varchar("phone", { length: 32 }),
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  /** P13: set when this account was folded into another one (soft-deleted; purged after MERGE_UNDO_DAYS). */
  mergedIntoUserId: int("mergedIntoUserId"),
  mergedAt: timestamp("mergedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const families = mysqlTable("families", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Family = typeof families.$inferSelect;
export type InsertFamily = typeof families.$inferInsert;

export const familyMembers = mysqlTable(
  "familyMembers",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull(),
    userId: int("userId").notNull(),
    role: mysqlEnum("role", FAMILY_ROLES).default("editor").notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  },
  (t) => [
    // A user can only be a member of a given family once.
    uniqueIndex("familyMembers_family_user_uq").on(t.familyId, t.userId),
    index("familyMembers_user_idx").on(t.userId),
  ],
);

export type FamilyMember = typeof familyMembers.$inferSelect;
export type InsertFamilyMember = typeof familyMembers.$inferInsert;

export const albums = mysqlTable(
  "albums",
  {
    id: int("id").autoincrement().primaryKey(),
    familyId: int("familyId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    thumbnail: text("thumbnail"),
    createdBy: int("createdBy").notNull(),
    isPrivate: boolean("isPrivate").default(false).notNull(),
    category: varchar("category", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("albums_family_created_idx").on(t.familyId, t.createdAt)],
);

export type Album = typeof albums.$inferSelect;
export type InsertAlbum = typeof albums.$inferInsert;

export const media = mysqlTable(
  "media",
  {
    id: int("id").autoincrement().primaryKey(),
    albumId: int("albumId").notNull(),
    familyId: int("familyId").notNull(),
    uploadedBy: int("uploadedBy").notNull(),
    type: mysqlEnum("type", ["photo", "video"]).notNull(),
    /**
     * Legacy / display URL. For objects uploaded after P3 this is the
     * access-controlled proxy path (`/manus-storage/{storageKey}`); clients
     * should prefer `media.getSignedUrl` which returns a short-lived S3 URL.
     */
    url: text("url").notNull(),
    thumbnail: text("thumbnail"),
    /** Private S3 object key (bucket is never public). null for legacy rows. */
    storageKey: varchar("storageKey", { length: 512 }),
    thumbnailKey: varchar("thumbnailKey", { length: 512 }),
    title: varchar("title", { length: 255 }),
    description: text("description"),
    duration: int("duration"),
    fileSize: int("fileSize"),
    /** P13: sha256 of the original bytes when known (restore / backup) — used for restore de-duplication. */
    contentHash: varchar("contentHash", { length: 64 }),
    likeCount: int("likeCount").default(0).notNull(),
    commentCount: int("commentCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [
    index("media_album_created_idx").on(t.albumId, t.createdAt),
    index("media_family_created_idx").on(t.familyId, t.createdAt),
    index("media_family_hash_idx").on(t.familyId, t.contentHash),
  ],
);

export type Media = typeof media.$inferSelect;
export type InsertMedia = typeof media.$inferInsert;

export const likes = mysqlTable(
  "likes",
  {
    id: int("id").autoincrement().primaryKey(),
    mediaId: int("mediaId").notNull(),
    userId: int("userId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    // One like per user per media item — enforced at the DB, not just in the router.
    uniqueIndex("likes_media_user_uq").on(t.mediaId, t.userId),
  ],
);

export type Like = typeof likes.$inferSelect;
export type InsertLike = typeof likes.$inferInsert;

export const comments = mysqlTable(
  "comments",
  {
    id: int("id").autoincrement().primaryKey(),
    mediaId: int("mediaId").notNull(),
    userId: int("userId").notNull(),
    content: text("content").notNull(),
    rating: int("rating"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("comments_media_created_idx").on(t.mediaId, t.createdAt)],
);

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

export const loveStories = mysqlTable("loveStories", {
  id: int("id").autoincrement().primaryKey(),
  familyId: int("familyId").notNull(),
  chapter: int("chapter").notNull(),
  year: int("year"),
  title: varchar("title", { length: 255 }).notNull(),
  titleEn: varchar("titleEn", { length: 255 }),
  description: longtext("description"),
  voiceRecording: text("voiceRecording"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LoveStory = typeof loveStories.$inferSelect;
export type InsertLoveStory = typeof loveStories.$inferInsert;

export const anniversaries = mysqlTable("anniversaries", {
  id: int("id").autoincrement().primaryKey(),
  familyId: int("familyId").notNull(),
  type: mysqlEnum("type", ["silver", "golden", "diamond", "platinum"]).notNull(),
  date: timestamp("date").notNull(),
  couple: varchar("couple", { length: 255 }).notNull(),
  description: text("description"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Anniversary = typeof anniversaries.$inferSelect;
export type InsertAnniversary = typeof anniversaries.$inferInsert;

export const videoTemplates = mysqlTable("videoTemplates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"),
  category: varchar("category", { length: 64 }),
  duration: int("duration"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoTemplate = typeof videoTemplates.$inferSelect;
export type InsertVideoTemplate = typeof videoTemplates.$inferInsert;

export const invitations = mysqlTable("invitations", {
  id: int("id").autoincrement().primaryKey(),
  familyId: int("familyId").notNull(),
  invitedEmail: varchar("invitedEmail", { length: 320 }).notNull(),
  invitedBy: int("invitedBy").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "declined"]).default("pending").notNull(),
  invitationCode: varchar("invitationCode", { length: 64 }).unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
});

export type Invitation = typeof invitations.$inferSelect;
export type InsertInvitation = typeof invitations.$inferInsert;

export const SHARE_PLATFORMS = ["wechat", "facebook", "instagram", "whatsapp", "link"] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];

/**
 * Share records are owned by a user and may target a media item or album.
 * Lifecycle (P3): active → expired (expiresAt < now) | revoked (revokedAt set).
 */
export const shares = mysqlTable(
  "shares",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    userId: int("userId").notNull(),
    mediaId: int("mediaId"),
    albumId: int("albumId"),
    platform: mysqlEnum("platform", SHARE_PLATFORMS).notNull(),
    caption: text("caption"),
    shareUrl: text("shareUrl").notNull(),
    clicks: int("clicks").default(0).notNull(),
    shares: int("shares").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
    revokedAt: timestamp("revokedAt"),
  },
  (t) => [index("shares_user_created_idx").on(t.userId, t.createdAt)],
);

export type Share = typeof shares.$inferSelect;
export type InsertShare = typeof shares.$inferInsert;

/** OAuth credentials are kept separate from the users table. */
export const oauthAccounts = mysqlTable("oauthAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["google", "facebook"]).notNull(),
  providerAccountId: varchar("providerAccountId", { length: 255 }).notNull(),
  accessToken: text("accessToken").notNull(),
  idToken: text("idToken"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type InsertOAuthAccount = typeof oauthAccounts.$inferInsert;

/**
 * Persistent in-app notification feed (backs the Messages tab + unread badge).
 * Rows are created server-side as side effects of likes / comments / uploads /
 * invitations / anniversaries. `readAt` NULL == unread.
 */
export const NOTIFICATION_TYPES = [
  "like",
  "comment",
  "reply",
  "upload",
  "invite",
  "member_joined",
  "anniversary",
  "share",
  "system",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notifications = mysqlTable(
  "notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Recipient */
    userId: int("userId").notNull(),
    familyId: int("familyId"),
    type: mysqlEnum("type", NOTIFICATION_TYPES).notNull(),
    /** Who triggered it (nullable for system notifications) */
    actorId: int("actorId"),
    mediaId: int("mediaId"),
    albumId: int("albumId"),
    commentId: int("commentId"),
    /** Optional preview text (comment body, album name, ...) */
    preview: varchar("preview", { length: 500 }),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx").on(t.userId, t.readAt),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/* ------------------------------------------------------------------ */
/* P8                                                                  */
/* ------------------------------------------------------------------ */

export const STUDIO_JOB_STATUSES = ["queued", "rendering", "uploading", "completed", "failed"] as const;
export type StudioJobStatus = (typeof STUDIO_JOB_STATUSES)[number];

/**
 * Persisted Studio render jobs (P8). Survives server restarts: on boot any
 * job still queued/rendering/uploading is marked failed ("interrupted").
 */
export const studioJobs = mysqlTable(
  "studioJobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    familyId: int("familyId").notNull(),
    albumId: int("albumId").notNull(),
    status: mysqlEnum("status", STUDIO_JOB_STATUSES).default("queued").notNull(),
    progress: int("progress").default(0).notNull(),
    stage: varchar("stage", { length: 32 }).default("queued").notNull(),
    /** Render input (template, mediaIds, captions…) as JSON for retry / audit. */
    input: text("input").notNull(),
    mediaId: int("mediaId"),
    error: varchar("error", { length: 500 }),
    /** P9: which server instance claimed the job (hostname:pid) and when. */
    workerId: varchar("workerId", { length: 128 }),
    startedAt: timestamp("startedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("studio_jobs_user_created_idx").on(t.userId, t.createdAt), index("studio_jobs_status_created_idx").on(t.status, t.createdAt)],
);

export type StudioJobRow = typeof studioJobs.$inferSelect;
export type InsertStudioJob = typeof studioJobs.$inferInsert;

/**
 * Per-user preferences (P8). Notification toggles are enforced server-side in
 * `createNotification`; `hideActivity` removes the user's like / comment
 * events from other members' timelines; `defaultPrivateAlbums` pre-fills the
 * album creation form.
 */
export const userPreferences = mysqlTable("userPreferences", {
  userId: int("userId").primaryKey(),
  notifyEnabled: boolean("notifyEnabled").default(true).notNull(),
  notifyComments: boolean("notifyComments").default(true).notNull(),
  notifyLikes: boolean("notifyLikes").default(true).notNull(),
  notifyShares: boolean("notifyShares").default(true).notNull(),
  notifyUploads: boolean("notifyUploads").default(true).notNull(),
  notifyAnniversaries: boolean("notifyAnniversaries").default(true).notNull(),
  hideActivity: boolean("hideActivity").default(false).notNull(),
  defaultPrivateAlbums: boolean("defaultPrivateAlbums").default(false).notNull(),
  autoBackup: boolean("autoBackup").default(false).notNull(),
  /** P9: require an emailed 6-digit code after password login. */
  twoFactorEnabled: boolean("twoFactorEnabled").default(false).notNull(),
  /** P10: where the 2FA / reset code is delivered ("sms" requires a verified phone). */
  twoFactorChannel: mysqlEnum("twoFactorChannel", ["email", "sms"]).default("email").notNull(),
  /** P10: deliver notifications to registered devices via Expo Push. */
  pushEnabled: boolean("pushEnabled").default(true).notNull(),
  /** P10: scheduled backups bundle the original photo / video files (zip). */
  backupIncludeMedia: boolean("backupIncludeMedia").default(false).notNull(),
  /** P12: quiet hours for push (local minutes 0–1439, start > end wraps midnight); null = none. */
  quietStart: int("quietStart"),
  quietEnd: int("quietEnd"),
  /** P12: IANA timezone the quiet window is evaluated in (e.g. Asia/Shanghai). */
  quietTz: varchar("quietTz", { length: 64 }),
  /** P12: JSON string[] of notification types that should NOT push (still in-app). */
  pushMutedTypes: text("pushMutedTypes"),
  /** P12: JSON number[] of familyIds whose pushes are muted. */
  pushMutedFamilies: text("pushMutedFamilies"),
  /** P13: batch interaction pushes into one daily / weekly summary (invites, anniversaries, system still go out immediately). */
  pushDigest: mysqlEnum("pushDigest", ["off", "daily", "weekly"]).default("off").notNull(),
  /** P13: local hour (0–23, in quietTz) the digest is delivered. */
  pushDigestHour: int("pushDigestHour").default(20).notNull(),
  lastDigestAt: timestamp("lastDigestAt"),
  /** P14: pick the delivery hour from the user's own push-open history (overrides pushDigestHour when enough data). */
  pushDigestSmart: boolean("pushDigestSmart").default(false).notNull(),
  /** P14: one digest per family instead of one combined. */
  pushDigestPerFamily: boolean("pushDigestPerFamily").default(false).notNull(),
  /** P15: attach a "weekly picks" photo (hottest by likes + comments) to the digest as a rich push. */
  pushDigestHighlights: boolean("pushDigestHighlights").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type InsertUserPreferences = typeof userPreferences.$inferInsert;

/**
 * AI photo understanding (P8). One row per media item; `people` holds the
 * detected persons (description + optional normalized box) and, once a family
 * member confirms them, the linked `userId`.
 */
export const mediaAnalysis = mysqlTable(
  "mediaAnalysis",
  {
    mediaId: int("mediaId").primaryKey(),
    familyId: int("familyId").notNull(),
    caption: varchar("caption", { length: 500 }),
    suggestedTitle: varchar("suggestedTitle", { length: 255 }),
    mood: varchar("mood", { length: 64 }),
    /** JSON string[] */
    tags: text("tags").notNull(),
    /** JSON Array<{ id, label, description, box?: [x, y, w, h], userId?: number }> */
    people: text("people").notNull(),
    model: varchar("model", { length: 128 }),
    analyzedBy: int("analyzedBy").notNull(),
    analyzedAt: timestamp("analyzedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("media_analysis_family_idx").on(t.familyId)],
);

export type MediaAnalysis = typeof mediaAnalysis.$inferSelect;
export type InsertMediaAnalysis = typeof mediaAnalysis.$inferInsert;

/* ------------------------------------------------------------------ */
/* P9                                                                  */
/* ------------------------------------------------------------------ */

export const VERIFICATION_PURPOSES = ["password_reset", "verify_email", "login_2fa", "verify_phone", "login_sms", "merge_account"] as const;
export const VERIFICATION_CHANNELS = ["email", "sms"] as const;
export type VerificationChannel = (typeof VERIFICATION_CHANNELS)[number];
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

/**
 * One-time 6-digit codes delivered by email. Only the scrypt hash is stored;
 * a row is consumed on success or locked after `attempts` reaches the cap.
 */
export const verificationCodes = mysqlTable(
  "verificationCodes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId"),
    email: varchar("email", { length: 320 }).notNull(),
    purpose: mysqlEnum("purpose", VERIFICATION_PURPOSES).notNull(),
    /** P10: delivery channel. For "sms" the `email` column holds the E.164 phone number. */
    channel: mysqlEnum("channel", VERIFICATION_CHANNELS).default("email").notNull(),
    codeHash: varchar("codeHash", { length: 255 }).notNull(),
    attempts: int("attempts").default(0).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("verification_email_purpose_idx").on(t.email, t.purpose, t.createdAt)],
);

export type VerificationCode = typeof verificationCodes.$inferSelect;

/**
 * Backups produced by the weekly scheduler or "备份现在". The JSON export is
 * stored under users/{uid}/backups/ (private, owner-only via the storage proxy).
 */
export const backups = mysqlTable(
  "backups",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    bytes: int("bytes").notNull(),
    itemCount: int("itemCount").notNull(),
    trigger: mysqlEnum("trigger", ["scheduled", "manual"]).notNull(),
    /** P10: "json" = metadata only; "zip" = manifest + original media files. */
    format: mysqlEnum("format", ["json", "zip"]).default("json").notNull(),
    /** P10: media files bundled / skipped (size cap or download failure). */
    mediaCount: int("mediaCount").default(0).notNull(),
    skippedCount: int("skippedCount").default(0).notNull(),
    /** P10: result of the off-site copy (WebDAV): null = no target, "uploaded" | "failed". */
    remoteStatus: varchar("remoteStatus", { length: 16 }),
    remoteError: varchar("remoteError", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("backups_user_created_idx").on(t.userId, t.createdAt)],
);

export type Backup = typeof backups.$inferSelect;

/* ------------------------------------------------------------------ */
/* P10                                                                 */
/* ------------------------------------------------------------------ */

export const PUSH_PLATFORMS = ["ios", "android", "web"] as const;

/**
 * Expo push tokens, one row per device. `failedAt` is set when Expo reports
 * DeviceNotRegistered so the token is skipped and eventually pruned.
 */
export const pushTokens = mysqlTable(
  "pushTokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    platform: mysqlEnum("platform", PUSH_PLATFORMS).notNull(),
    deviceName: varchar("deviceName", { length: 128 }),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    failedAt: timestamp("failedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);

export type PushToken = typeof pushTokens.$inferSelect;

/**
 * Off-site backup destination (one per user). The password is stored
 * AES-256-GCM encrypted with a key derived from JWT_SECRET.
 */
export const BACKUP_TARGET_KINDS = ["webdav", "s3", "gdrive"] as const;
export type BackupTargetKind = (typeof BACKUP_TARGET_KINDS)[number];

export const TARGET_HEALTH = ["unknown", "ok", "degraded", "down"] as const;

export const backupTargets = mysqlTable(
  "backupTargets",
  {
    /** P13: several targets per user (parallel sync). */
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** P11: webdav | s3 (any S3-compatible bucket, SigV4) | gdrive (OAuth refresh token). */
    kind: mysqlEnum("kind", BACKUP_TARGET_KINDS).default("webdav").notNull(),
    /** P13: user-facing label ("坚果云", "家里 NAS"). */
    label: varchar("label", { length: 64 }),
    enabled: boolean("enabled").default(true).notNull(),
    /** webdav: folder URL · s3: endpoint URL · gdrive: folder id (or "root") */
    url: varchar("url", { length: 512 }).notNull(),
    /** webdav: username · s3: access key id · gdrive: Google account email */
    username: varchar("username", { length: 255 }).notNull(),
    /** Sealed (AES-256-GCM): webdav password · s3 secret key · gdrive refresh token */
    secretEnc: text("secretEnc").notNull(),
    /** P11: JSON, kind-specific non-secret settings — s3: {bucket, region, prefix, pathStyle} · gdrive: {folderName} */
    config: text("config"),
    lastSuccessAt: timestamp("lastSuccessAt"),
    lastError: varchar("lastError", { length: 500 }),
    /** P13: periodic probe outcome. */
    health: mysqlEnum("health", TARGET_HEALTH).default("unknown").notNull(),
    lastCheckedAt: timestamp("lastCheckedAt"),
    /** P14: keep only the newest N backups on this target (null = keep all). */
    keepCount: int("keepCount"),
    /** P14: S3 storage class for uploads (STANDARD / STANDARD_IA / GLACIER_IR / GLACIER / DEEP_ARCHIVE); null = default. */
    storageClass: varchar("storageClass", { length: 32 }),
    /** P14: last quota probe — bytes used by our GoldenMemory/ folder and the provider's quota when known. */
    usedBytes: bigint("usedBytes", { mode: "number" }),
    quotaBytes: bigint("quotaBytes", { mode: "number" }),
    quotaCheckedAt: timestamp("quotaCheckedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("backup_targets_user_idx").on(t.userId)],
);

export type BackupTarget = typeof backupTargets.$inferSelect;

/* ------------------------------------------------------------------ */
/* P12                                                                 */
/* ------------------------------------------------------------------ */

export const METRIC_KINDS = ["push", "backup", "backup_remote", "studio", "restore", "mail", "sms", "push_open", "alert"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

/**
 * Append-only outcome log for the ops dashboard (success rate / latency per
 * hour). Rows are pruned after METRICS_RETENTION_DAYS. `durationMs` is the
 * queue wait for studio, the run time otherwise.
 */
export const metricEvents = mysqlTable(
  "metricEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", METRIC_KINDS).notNull(),
    ok: boolean("ok").notNull(),
    durationMs: int("durationMs"),
    /** Small free-form detail (error class, transport, format…). */
    detail: varchar("detail", { length: 120 }),
    /** P14: actor for per-user analysis (push_open only). */
    userId: int("userId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("metric_events_kind_created_idx").on(t.kind, t.createdAt), index("metric_events_user_kind_idx").on(t.userId, t.kind)],
);

export type MetricEvent = typeof metricEvents.$inferSelect;

export const RESTORE_JOB_STATUSES = ["queued", "running", "completed", "failed"] as const;

/** Background restore (P12): large archives run off-request with progress. */
export const restoreJobs = mysqlTable(
  "restoreJobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    familyId: int("familyId").notNull(),
    /** Source: a backups.id, an import key, or a remote object key on the user's cloud target. */
    backupId: int("backupId"),
    importKey: varchar("importKey", { length: 512 }),
    remoteKey: varchar("remoteKey", { length: 512 }),
    /** P13: cloud target the remoteKey lives on. */
    targetId: int("targetId"),
    /** JSON string[] of album names to restore (null = all). */
    albums: text("albums"),
    /** P13: JSON RestoreOptions {albumConflict, dedupeByHash}. */
    options: text("options"),
    /** P14: JSON number[] of manifest item ids to restore (null = all after album filter). */
    items: text("items"),
    /** P14: JSON {mediaIds: number[], albumIds: number[]} created by this run — lets `undoRestore` roll it back. */
    created: mediumtext("created"),
    /** P15: JSON string[] of object-storage keys this run uploaded — deleted on undo. */
    uploadedKeys: mediumtext("uploadedKeys"),
    undoneAt: timestamp("undoneAt"),
    status: mysqlEnum("status", RESTORE_JOB_STATUSES).default("queued").notNull(),
    progress: int("progress").default(0).notNull(),
    stage: varchar("stage", { length: 32 }).default("queued").notNull(),
    /** JSON RestoreResult once completed. */
    result: text("result"),
    error: varchar("error", { length: 500 }),
    workerId: varchar("workerId", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("restore_jobs_user_created_idx").on(t.userId, t.createdAt), index("restore_jobs_status_idx").on(t.status, t.createdAt)],
);

export type RestoreJobRow = typeof restoreJobs.$inferSelect;

/**
 * Audit of account merges: `sourceUserId` was folded into `targetUserId`
 * (every owned row re-pointed, source login identities moved, source row deleted).
 */
export const accountMerges = mysqlTable("accountMerges", {
  id: int("id").autoincrement().primaryKey(),
  targetUserId: int("targetUserId").notNull(),
  sourceUserId: int("sourceUserId").notNull(),
  sourceEmail: varchar("sourceEmail", { length: 320 }),
  sourcePhone: varchar("sourcePhone", { length: 32 }),
  /** JSON {table: rowsMoved} */
  moved: text("moved").notNull(),
  /** P13: JSON MergeLedger — every re-pointed id / deleted duplicate so the merge can be reversed. */
  ledger: mediumtext("ledger"),
  /** P13: undo allowed until this instant; the source row is purged afterwards. */
  undoDeadline: timestamp("undoDeadline"),
  undoneAt: timestamp("undoneAt"),
  purgedAt: timestamp("purgedAt"),
  /** P14: JSON {familyId: "target"|"source"} — which membership role to keep where both were members. */
  choices: text("choices"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AccountMerge = typeof accountMerges.$inferSelect;

/* ------------------------------------------------------------------ */
/* P13                                                                 */
/* ------------------------------------------------------------------ */

export const ALERT_CHANNEL_KINDS = ["webhook", "slack", "wecom", "dingtalk"] as const;
export type AlertChannelKind = (typeof ALERT_CHANNEL_KINDS)[number];

/** Outbound alert destinations (admin-managed). URL / signing secret are sealed. */
export const alertChannels = mysqlTable("alertChannels", {
  id: int("id").autoincrement().primaryKey(),
  kind: mysqlEnum("kind", ALERT_CHANNEL_KINDS).notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  urlEnc: text("urlEnc").notNull(),
  /** dingtalk: HMAC secret · webhook: bearer token (optional) */
  secretEnc: text("secretEnc"),
  enabled: boolean("enabled").default(true).notNull(),
  /** P14: 1 = notified immediately · 2 = after ESCALATE_AFTER_MIN without ack · 3 = second escalation */
  tier: int("tier").default(1).notNull(),
  lastStatus: varchar("lastStatus", { length: 16 }),
  lastError: varchar("lastError", { length: 300 }),
  lastSentAt: timestamp("lastSentAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AlertChannel = typeof alertChannels.$inferSelect;

/** Per-metric-kind alert policy; absent row = env defaults. */
export const alertRules = mysqlTable("alertRules", {
  kind: mysqlEnum("kind", METRIC_KINDS).primaryKey(),
  enabled: boolean("enabled").default(true).notNull(),
  /** 0–100 */
  minRatePct: int("minRatePct").notNull(),
  minSamples: int("minSamples").notNull(),
  windowHours: int("windowHours").notNull(),
  /** Suppress alerts for this kind until then. */
  silencedUntil: timestamp("silencedUntil"),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AlertRule = typeof alertRules.$inferSelect;

export const REMOTE_UPLOAD_STATUSES = ["queued", "uploaded", "failed"] as const;

/** One row per (backup, target): status + retry schedule for the off-site copy. */
export const backupRemoteUploads = mysqlTable(
  "backupRemoteUploads",
  {
    id: int("id").autoincrement().primaryKey(),
    backupId: int("backupId").notNull(),
    targetId: int("targetId").notNull(),
    userId: int("userId").notNull(),
    status: mysqlEnum("status", REMOTE_UPLOAD_STATUSES).default("queued").notNull(),
    attempts: int("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("nextAttemptAt"),
    lastError: varchar("lastError", { length: 500 }),
    uploadedAt: timestamp("uploadedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("remote_uploads_backup_idx").on(t.backupId), index("remote_uploads_retry_idx").on(t.status, t.nextAttemptAt)],
);

export type BackupRemoteUpload = typeof backupRemoteUploads.$inferSelect;

/** Interaction pushes held back for a user's daily / weekly digest. */
export const pushDigestQueue = mysqlTable(
  "pushDigestQueue",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    type: mysqlEnum("type", NOTIFICATION_TYPES).notNull(),
    actorName: varchar("actorName", { length: 128 }),
    preview: varchar("preview", { length: 500 }),
    familyId: int("familyId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("push_digest_user_idx").on(t.userId, t.createdAt)],
);

export type PushDigestRow = typeof pushDigestQueue.$inferSelect;

/* ------------------------------------------------------------------ */
/* P14                                                                 */
/* ------------------------------------------------------------------ */

export const INCIDENT_STATUSES = ["open", "acked", "resolved"] as const;

/**
 * One row per alert episode (kind below threshold). Escalates to higher-tier
 * channels while unacknowledged; resolves automatically once the kind is
 * healthy again. `timeline` is a JSON list of {at, event, by?, detail?}.
 */
export const alertIncidents = mysqlTable(
  "alertIncidents",
  {
    id: int("id").autoincrement().primaryKey(),
    kind: mysqlEnum("kind", METRIC_KINDS).notNull(),
    status: mysqlEnum("status", INCIDENT_STATUSES).default("open").notNull(),
    /** highest tier notified so far */
    tier: int("tier").default(1).notNull(),
    /** rate / total at open time */
    ratePct: int("ratePct"),
    samples: int("samples"),
    openedAt: timestamp("openedAt").defaultNow().notNull(),
    lastNotifiedAt: timestamp("lastNotifiedAt"),
    ackedAt: timestamp("ackedAt"),
    ackedBy: int("ackedBy"),
    ackNote: varchar("ackNote", { length: 300 }),
    resolvedAt: timestamp("resolvedAt"),
    timeline: mediumtext("timeline").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("alert_incidents_status_idx").on(t.status, t.openedAt), index("alert_incidents_kind_idx").on(t.kind, t.openedAt)],
);

export type AlertIncident = typeof alertIncidents.$inferSelect;

/** P14: per-user A/B rollup so the winning variant can be auto-promoted. */
export const copyExperimentStats = mysqlTable("copyExperimentStats", {
  experiment: varchar("experiment", { length: 64 }).primaryKey(),
  sentA: int("sentA").default(0).notNull(),
  sentB: int("sentB").default(0).notNull(),
  openA: int("openA").default(0).notNull(),
  openB: int("openB").default(0).notNull(),
  /** null = still running · "A" | "B" = promoted winner (everyone gets it) */
  winner: varchar("winner", { length: 1 }),
  decidedAt: timestamp("decidedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CopyExperimentStat = typeof copyExperimentStats.$inferSelect;

/* ------------------------------------------------------------------ */
/* P15                                                                 */
/* ------------------------------------------------------------------ */

/**
 * On-call roster: who receives escalations. Each row is a shift for one
 * admin; shifts repeat weekly (`weekday` 0–6, `startHour`–`endHour` local in
 * `tz`) or cover a fixed date range (`startsAt`–`endsAt`). The lowest `order`
 * matching the current instant is on duty; `fallbackUserId` on the schedule
 * (env ON_CALL_FALLBACK_USER_ID) catches gaps.
 */
export const onCallShifts = mysqlTable(
  "onCallShifts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** weekly | range */
    kind: varchar("kind", { length: 8 }).default("weekly").notNull(),
    /** weekly: 0 = Sunday … 6 = Saturday (null for range) */
    weekday: int("weekday"),
    startHour: int("startHour").default(0).notNull(),
    endHour: int("endHour").default(24).notNull(),
    tz: varchar("tz", { length: 64 }).default("Asia/Shanghai").notNull(),
    startsAt: timestamp("startsAt"),
    endsAt: timestamp("endsAt"),
    /** lower wins when several shifts overlap */
    order: int("order").default(0).notNull(),
    /** escalation tier this person covers (1 = first responder, 2 = backup …) */
    tier: int("tier").default(1).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    note: varchar("note", { length: 200 }),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("on_call_shifts_user_idx").on(t.userId), index("on_call_shifts_enabled_idx").on(t.enabled, t.tier)],
);

export type OnCallShift = typeof onCallShifts.$inferSelect;

/** Shift handover log (who → whom, when, note). Written when the on-duty person changes or on manual handover. */
export const onCallHandovers = mysqlTable(
  "onCallHandovers",
  {
    id: int("id").autoincrement().primaryKey(),
    fromUserId: int("fromUserId"),
    toUserId: int("toUserId"),
    tier: int("tier").default(1).notNull(),
    /** auto (rotation) | manual */
    reason: varchar("reason", { length: 16 }).default("auto").notNull(),
    note: varchar("note", { length: 300 }),
    /** open incident ids handed over at that moment (JSON number[]) */
    openIncidents: text("openIncidents"),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("on_call_handovers_created_idx").on(t.createdAt)],
);

export type OnCallHandover = typeof onCallHandovers.$inferSelect;

export const COPY_JOB_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;

/**
 * P15: copy historical backups from one cloud target to another (optionally
 * changing the S3 storage class). Background job with per-file progress and
 * sha256 verification of every object after upload.
 */
export const targetCopyJobs = mysqlTable(
  "targetCopyJobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: int("userId").notNull(),
    fromTargetId: int("fromTargetId").notNull(),
    toTargetId: int("toTargetId").notNull(),
    /** JSON string[] of source keys to copy (null = all backups on the source) */
    keys: mediumtext("keys"),
    /** override storage class on the destination (S3 only) */
    storageClass: varchar("storageClass", { length: 32 }),
    status: mysqlEnum("status", COPY_JOB_STATUSES).default("queued").notNull(),
    total: int("total").default(0).notNull(),
    done: int("done").default(0).notNull(),
    failed: int("failed").default(0).notNull(),
    bytes: bigint("bytes", { mode: "number" }).default(0).notNull(),
    /** JSON [{key, ok, bytes, sha256, error?}] */
    results: mediumtext("results"),
    error: varchar("error", { length: 500 }),
    workerId: varchar("workerId", { length: 128 }),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => [index("target_copy_jobs_user_idx").on(t.userId, t.createdAt), index("target_copy_jobs_status_idx").on(t.status, t.createdAt)],
);

export type TargetCopyJobRow = typeof targetCopyJobs.$inferSelect;

/**
 * P15: orphan scan — storage objects under families/… that no media row
 * references (left behind by failed uploads, deleted media, undone restores).
 * One row per scan; `keys` holds the candidates, `deletedKeys` what the admin
 * purged.
 */
export const storageOrphanScans = mysqlTable(
  "storageOrphanScans",
  {
    id: int("id").autoincrement().primaryKey(),
    /** which family prefix was scanned (null = all) */
    familyId: int("familyId"),
    scanned: int("scanned").default(0).notNull(),
    orphans: int("orphans").default(0).notNull(),
    orphanBytes: bigint("orphanBytes", { mode: "number" }).default(0).notNull(),
    /** JSON [{key, bytes, modifiedAt}] (capped) */
    keys: mediumtext("keys"),
    deletedCount: int("deletedCount").default(0).notNull(),
    deletedAt: timestamp("deletedAt"),
    error: varchar("error", { length: 500 }),
    createdBy: int("createdBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [index("storage_orphan_scans_created_idx").on(t.createdAt)],
);

export type StorageOrphanScan = typeof storageOrphanScans.$inferSelect;
