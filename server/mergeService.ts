/**
 * P12 — merge two accounts belonging to the same person.
 * P13 — reversible: the source row is *soft-deleted* (`users.mergedIntoUserId`)
 *        and every change is written to a ledger so `undoMerge` can put it all
 *        back within MERGE_UNDO_DAYS; afterwards `purgeExpiredMerges` deletes
 *        the source row for good. `mergeAuditCsv` exports the audit trail.
 *
 *   requestMerge {email}    signed-in user (target) names the *other* account (source) by
 *                           its email; a `merge_account` code is sent to that email so only
 *                           someone who controls the source account can approve.
 *   completeMerge {code}    verifies the code, then (in one transaction) re-points every row
 *                           owned by the source to the target, moves login identities
 *                           (OAuth accounts, phone, password if target has none), resolves
 *                           duplicate family memberships / likes, soft-deletes the source and
 *                           records an `accountMerges` audit row with the ledger.
 *   undoMerge {id}          within the window: reverse every ledger entry, restore the source
 *                           user's identity (email / phone / openId), mark `undoneAt`.
 *
 * Direction is always "source → target (the account you are signed in as)".
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import {
  accountMerges,
  albums,
  anniversaries,
  backupTargets,
  backups,
  comments,
  familyMembers,
  families,
  invitations,
  likes,
  loveStories,
  media,
  mediaAnalysis,
  notifications,
  oauthAccounts,
  pushTokens,
  restoreJobs,
  shares,
  studioJobs,
  userPreferences,
  users,
  verificationCodes,
  type AccountMerge,
} from "@/drizzle/schema";
import { runIfLeader } from "@/server/_core/coordination";
import { getDb } from "@/server/db";

async function requireDatabase() {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
  return database;
}

const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export const MERGE_UNDO_DAYS = Math.max(0, Number(process.env.MERGE_UNDO_DAYS ?? 14));

export interface MergeOutcome {
  mergeId: number;
  sourceUserId: number;
  moved: Record<string, number>;
  undoDeadline: Date | null;
}

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything needed to reverse the merge. Ids are recorded *before* the
 * UPDATE so the undo can target exactly the rows that moved — not rows the
 * target created afterwards.
 */
export interface MergeLedger {
  v: 1;
  /** table → column → ids re-pointed to the target */
  repointed: Record<string, { column: string; ids: number[] }>;
  /** familyMembers rows of the source deleted because the target was already a member */
  membershipsDropped: Array<{ familyId: number; role: string; joinedAt: string }>;
  /** target membership rows whose role was raised: id → previous role */
  rolesRaised: Array<{ id: number; previousRole: string }>;
  /** likes of the source deleted because the target already liked the same media */
  likesDropped: Array<{ mediaId: number; createdAt: string }>;
  /** user fields copied onto the target (set back to null on undo) */
  targetPatched: string[];
  /** source identity restored on undo */
  source: { email: string | null; phone: string | null; phoneVerifiedAt: string | null; openId: string };
  /** source singleton rows */
  sourcePreferences: Record<string, unknown> | null;
  backupTargetsMoved: number[];
  backupTargetsDropped: number;
}

/** Pure: how many rows a ledger would touch on undo (for the UI / CSV). */
export function ledgerRowCount(ledger: MergeLedger): number {
  return Object.values(ledger.repointed).reduce((n, r) => n + r.ids.length, 0) + ledger.membershipsDropped.length + ledger.likesDropped.length + ledger.backupTargetsMoved.length;
}

/** Pure: can this merge still be undone at `now`? */
export function canUndo(m: Pick<AccountMerge, "undoDeadline" | "undoneAt" | "purgedAt">, now = new Date()): boolean {
  return !m.undoneAt && !m.purgedAt && !!m.undoDeadline && m.undoDeadline.getTime() > now.getTime();
}

/* ------------------------------------------------------------------ */
/* Source lookup                                                       */
/* ------------------------------------------------------------------ */

/** Find the other account by email; refuses self / unknown / already-merged. */
export async function findMergeSource(targetUserId: number, email: string) {
  const database = await requireDatabase();
  const [src] = await database.select().from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.mergedIntoUserId))).limit(1);
  if (!src) return null;
  if (src.id === targetUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "That is already your account" });
  return src;
}

/* ------------------------------------------------------------------ */
/* P14 — preview + conflict wizard                                     */
/* ------------------------------------------------------------------ */

export type MembershipChoice = "target" | "source";
/** familyId → which side's role to keep where both are members */
export type MergeChoices = Record<string, MembershipChoice>;

export interface MergePreview {
  source: { id: number; name: string | null; email: string | null; phone: string | null; avatar: string | null; hasPassword: boolean; oauthProviders: string[]; createdAt: Date };
  /** counts of rows that will move */
  counts: Record<string, number>;
  /** families only the source belongs to → membership moves as-is */
  familiesToJoin: Array<{ familyId: number; name: string; role: string }>;
  /** families both belong to → conflict; default keeps the higher role */
  conflicts: Array<{ familyId: number; name: string; targetRole: string; sourceRole: string; defaultKeep: MembershipChoice; resultingRole: string }>;
  /** user fields that would be copied from source → target (because target lacks them) */
  fieldsToFill: string[];
  /** likes dropped as duplicates */
  duplicateLikes: number;
  undoDays: number;
}

/** Pure: default side to keep is whichever has the higher role (tie → target). */
export function defaultChoice(targetRole: string, sourceRole: string): MembershipChoice {
  return (ROLE_RANK[sourceRole] ?? 0) > (ROLE_RANK[targetRole] ?? 0) ? "source" : "target";
}

/** Pure: apply user choices on top of defaults. Unknown family ids are ignored. */
export function resolveChoices(conflicts: Array<{ familyId: number; targetRole: string; sourceRole: string }>, choices: MergeChoices | null | undefined): Map<number, MembershipChoice> {
  const out = new Map<number, MembershipChoice>();
  for (const c of conflicts) {
    const picked = choices?.[String(c.familyId)];
    out.set(c.familyId, picked === "source" || picked === "target" ? picked : defaultChoice(c.targetRole, c.sourceRole));
  }
  return out;
}

/** Everything the wizard shows before the user confirms. */
export async function previewMerge(targetUserId: number, sourceUserId: number): Promise<MergePreview> {
  const database = await requireDatabase();
  const [target] = await database.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  const [source] = await database.select().from(users).where(and(eq(users.id, sourceUserId), isNull(users.mergedIntoUserId))).limit(1);
  if (!target || !source) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

  const cnt = async (table: AnyTable, column: string) => {
    const col = (table as unknown as Record<string, unknown>)[column] as typeof albums.createdBy;
    const [r] = await database.select({ n: sql<number>`count(*)` }).from(table).where(eq(col, sourceUserId));
    return Number(r?.n ?? 0);
  };
  const counts: Record<string, number> = {
    families: await cnt(families as unknown as AnyTable, "createdBy"),
    albums: await cnt(albums, "createdBy"),
    media: await cnt(media as unknown as AnyTable, "uploadedBy"),
    comments: await cnt(comments as unknown as AnyTable, "userId"),
    likes: await cnt(likes as unknown as AnyTable, "userId"),
    loveStories: await cnt(loveStories as unknown as AnyTable, "createdBy"),
    anniversaries: await cnt(anniversaries as unknown as AnyTable, "createdBy"),
    shares: await cnt(shares as unknown as AnyTable, "userId"),
    notifications: await cnt(notifications as unknown as AnyTable, "userId"),
    studioJobs: await cnt(studioJobs as unknown as AnyTable, "userId"),
    backups: await cnt(backups as unknown as AnyTable, "userId"),
    pushTokens: await cnt(pushTokens as unknown as AnyTable, "userId"),
    oauthAccounts: await cnt(oauthAccounts as unknown as AnyTable, "userId"),
    backupTargets: await cnt(backupTargets as unknown as AnyTable, "userId"),
  };

  const src = await database.select({ familyId: familyMembers.familyId, role: familyMembers.role, name: families.name }).from(familyMembers).leftJoin(families, eq(families.id, familyMembers.familyId)).where(eq(familyMembers.userId, sourceUserId));
  const tgt = await database.select({ familyId: familyMembers.familyId, role: familyMembers.role }).from(familyMembers).where(eq(familyMembers.userId, targetUserId));
  const tgtByFamily = new Map(tgt.map((m) => [m.familyId, m.role]));
  const familiesToJoin: MergePreview["familiesToJoin"] = [];
  const conflicts: MergePreview["conflicts"] = [];
  for (const m of src) {
    const tr = tgtByFamily.get(m.familyId);
    if (tr === undefined) familiesToJoin.push({ familyId: m.familyId, name: m.name ?? `#${m.familyId}`, role: m.role });
    else {
      const keep = defaultChoice(tr, m.role);
      conflicts.push({ familyId: m.familyId, name: m.name ?? `#${m.familyId}`, targetRole: tr, sourceRole: m.role, defaultKeep: keep, resultingRole: keep === "source" ? m.role : tr });
    }
  }

  const [dup] = await database
    .select({ n: sql<number>`count(*)` })
    .from(likes)
    .where(and(eq(likes.userId, sourceUserId), sql`${likes.mediaId} IN (SELECT mediaId FROM (SELECT mediaId FROM likes WHERE userId = ${targetUserId}) t)`));

  const fieldsToFill: string[] = [];
  if (!target.phone && source.phone) fieldsToFill.push("phone");
  if (!target.passwordHash && source.passwordHash) fieldsToFill.push("password");
  if (!target.avatar && source.avatar) fieldsToFill.push("avatar");
  if (!target.name && source.name) fieldsToFill.push("name");
  const providers = await database.select({ provider: oauthAccounts.provider }).from(oauthAccounts).where(eq(oauthAccounts.userId, sourceUserId));

  return {
    source: { id: source.id, name: source.name, email: source.email, phone: source.phone, avatar: source.avatar, hasPassword: !!source.passwordHash, oauthProviders: providers.map((p) => p.provider), createdAt: source.createdAt },
    counts,
    familiesToJoin,
    conflicts,
    fieldsToFill,
    duplicateLikes: Number(dup?.n ?? 0),
    undoDays: MERGE_UNDO_DAYS,
  };
}

/* ------------------------------------------------------------------ */
/* Merge                                                               */
/* ------------------------------------------------------------------ */

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof requireDatabase>>["transaction"]>[0]>[0];
type AnyTable = typeof albums;

const count = (r: unknown) => Number((Array.isArray(r) ? (r[0] as { affectedRows?: number }) : (r as { affectedRows?: number }))?.affectedRows ?? 0);

/** Record ids then re-point `table.column` from source → target. */
async function repoint(tx: Tx, ledger: MergeLedger, name: string, table: AnyTable, column: string, sourceUserId: number, targetUserId: number): Promise<number> {
  const col = (table as unknown as Record<string, unknown>)[column] as typeof albums.createdBy;
  const idCol = (table as unknown as Record<string, unknown>).id as typeof albums.id;
  const rows = await tx.select({ id: idCol }).from(table).where(eq(col, sourceUserId));
  const ids = rows.map((r) => Number(r.id));
  ledger.repointed[name] = { column, ids };
  if (ids.length === 0) return 0;
  return count(await tx.update(table).set({ [column]: targetUserId } as never).where(inArray(idCol, ids)));
}

/**
 * Perform the merge. Caller must have already verified the `merge_account`
 * code for `source.email`. Runs inside a transaction so a mid-way failure
 * leaves both accounts intact.
 */
export async function performMerge(targetUserId: number, sourceUserId: number, now = new Date(), choices: MergeChoices | null = null): Promise<MergeOutcome> {
  const database = await requireDatabase();
  if (targetUserId === sourceUserId) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge an account into itself" });
  const [target] = await database.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  const [source] = await database.select().from(users).where(eq(users.id, sourceUserId)).limit(1);
  if (!target || !source) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
  if (source.mergedIntoUserId) throw new TRPCError({ code: "CONFLICT", message: "That account was already merged" });
  if (target.mergedIntoUserId) throw new TRPCError({ code: "CONFLICT", message: "Your account is itself pending a merge" });

  const moved: Record<string, number> = {};
  const ledger: MergeLedger = {
    v: 1,
    repointed: {},
    membershipsDropped: [],
    rolesRaised: [],
    likesDropped: [],
    targetPatched: [],
    source: { email: source.email, phone: source.phone, phoneVerifiedAt: source.phoneVerifiedAt?.toISOString() ?? null, openId: source.openId },
    sourcePreferences: null,
    backupTargetsMoved: [],
    backupTargetsDropped: 0,
  };
  const undoDeadline = MERGE_UNDO_DAYS > 0 ? new Date(now.getTime() + MERGE_UNDO_DAYS * 86_400_000) : null;
  let mergeId = 0;

  await database.transaction(async (tx) => {
    // 1. Family memberships: where both are members keep the higher role on target, drop source row.
    const srcMemberships = await tx.select().from(familyMembers).where(eq(familyMembers.userId, sourceUserId));
    const tgtMemberships = await tx.select().from(familyMembers).where(eq(familyMembers.userId, targetUserId));
    const tgtByFamily = new Map(tgtMemberships.map((m) => [m.familyId, m]));
    // P14: per-family keep choice (wizard) — default = higher role.
    const picks = resolveChoices(
      srcMemberships.filter((m) => tgtByFamily.has(m.familyId)).map((m) => ({ familyId: m.familyId, targetRole: tgtByFamily.get(m.familyId)!.role, sourceRole: m.role })),
      choices,
    );
    const movedMembershipIds: number[] = [];
    for (const m of srcMemberships) {
      const existing = tgtByFamily.get(m.familyId);
      if (existing) {
        if (picks.get(m.familyId) === "source" && m.role !== existing.role) {
          ledger.rolesRaised.push({ id: existing.id, previousRole: existing.role });
          await tx.update(familyMembers).set({ role: m.role }).where(eq(familyMembers.id, existing.id));
        }
        ledger.membershipsDropped.push({ familyId: m.familyId, role: m.role, joinedAt: m.joinedAt.toISOString() });
        await tx.delete(familyMembers).where(eq(familyMembers.id, m.id));
      } else {
        await tx.update(familyMembers).set({ userId: targetUserId }).where(eq(familyMembers.id, m.id));
        movedMembershipIds.push(m.id);
      }
    }
    ledger.repointed.familyMembers = { column: "userId", ids: movedMembershipIds };
    moved.familyMembers = movedMembershipIds.length;

    // 2. Likes: drop source likes that would collide with target's, move the rest.
    const collide = await tx
      .select({ id: likes.id, mediaId: likes.mediaId, createdAt: likes.createdAt })
      .from(likes)
      .where(and(eq(likes.userId, sourceUserId), sql`${likes.mediaId} IN (SELECT mediaId FROM (SELECT mediaId FROM likes WHERE userId = ${targetUserId}) t)`));
    if (collide.length) {
      ledger.likesDropped = collide.map((c) => ({ mediaId: c.mediaId, createdAt: c.createdAt.toISOString() }));
      await tx.delete(likes).where(inArray(likes.id, collide.map((c) => c.id)));
    }
    moved.likes = await repoint(tx, ledger, "likes", likes as unknown as AnyTable, "userId", sourceUserId, targetUserId);

    // 3. Plain ownership re-points (ids recorded for undo).
    moved.families = await repoint(tx, ledger, "families", families as unknown as AnyTable, "createdBy", sourceUserId, targetUserId);
    moved.albums = await repoint(tx, ledger, "albums", albums, "createdBy", sourceUserId, targetUserId);
    moved.media = await repoint(tx, ledger, "media", media as unknown as AnyTable, "uploadedBy", sourceUserId, targetUserId);
    moved.comments = await repoint(tx, ledger, "comments", comments as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    moved.loveStories = await repoint(tx, ledger, "loveStories", loveStories as unknown as AnyTable, "createdBy", sourceUserId, targetUserId);
    moved.anniversaries = await repoint(tx, ledger, "anniversaries", anniversaries as unknown as AnyTable, "createdBy", sourceUserId, targetUserId);
    moved.invitations = await repoint(tx, ledger, "invitations", invitations as unknown as AnyTable, "invitedBy", sourceUserId, targetUserId);
    moved.shares = await repoint(tx, ledger, "shares", shares as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    moved.notifications = await repoint(tx, ledger, "notifications", notifications as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    moved.notificationsActed = await repoint(tx, ledger, "notificationsActed", notifications as unknown as AnyTable, "actorId", sourceUserId, targetUserId);
    moved.studioJobs = await repoint(tx, ledger, "studioJobs", studioJobs as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    moved.backups = await repoint(tx, ledger, "backups", backups as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    moved.pushTokens = await repoint(tx, ledger, "pushTokens", pushTokens as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    moved.oauthAccounts = await repoint(tx, ledger, "oauthAccounts", oauthAccounts as unknown as AnyTable, "userId", sourceUserId, targetUserId);
    // restoreJobs (varchar id) + mediaAnalysis (mediaId pk) have non-int ids → plain re-point, recorded by key.
    const rj = await tx.select({ id: restoreJobs.id }).from(restoreJobs).where(eq(restoreJobs.userId, sourceUserId));
    moved.restoreJobs = rj.length ? count(await tx.update(restoreJobs).set({ userId: targetUserId }).where(inArray(restoreJobs.id, rj.map((r) => r.id)))) : 0;
    (ledger as unknown as Record<string, unknown>).restoreJobIds = rj.map((r) => r.id);
    const ma = await tx.select({ id: mediaAnalysis.mediaId }).from(mediaAnalysis).where(eq(mediaAnalysis.analyzedBy, sourceUserId));
    moved.mediaAnalysis = ma.length ? count(await tx.update(mediaAnalysis).set({ analyzedBy: targetUserId }).where(inArray(mediaAnalysis.mediaId, ma.map((r) => r.id)))) : 0;
    ledger.repointed.mediaAnalysis = { column: "analyzedBy", ids: ma.map((r) => r.id) };

    // 4. Login identities: phone moves if target has none; password / avatar / name fill gaps.
    const patch: Partial<typeof users.$inferInsert> = {};
    if (!target.phone && source.phone) {
      patch.phone = source.phone;
      patch.phoneVerifiedAt = source.phoneVerifiedAt;
      ledger.targetPatched.push("phone");
    }
    if (!target.passwordHash && source.passwordHash) {
      patch.passwordHash = source.passwordHash;
      ledger.targetPatched.push("passwordHash");
    }
    if (!target.avatar && source.avatar) {
      patch.avatar = source.avatar;
      ledger.targetPatched.push("avatar");
    }
    if (!target.name && source.name) {
      patch.name = source.name;
      ledger.targetPatched.push("name");
    }
    // Free the unique phone / email / openId on the source so the target update cannot collide; soft-delete it.
    await tx
      .update(users)
      .set({ phone: null, email: source.email ? `merged+${source.id}@invalid.local` : null, openId: `merged:${source.id}:${source.openId}`.slice(0, 64), mergedIntoUserId: targetUserId, mergedAt: now })
      .where(eq(users.id, sourceUserId));
    if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, targetUserId));

    // 5. Per-user singletons: keep target's, drop source's (preferences remembered for undo).
    const [srcPrefs] = await tx.select().from(userPreferences).where(eq(userPreferences.userId, sourceUserId)).limit(1);
    ledger.sourcePreferences = srcPrefs ? (srcPrefs as unknown as Record<string, unknown>) : null;
    await tx.delete(userPreferences).where(eq(userPreferences.userId, sourceUserId));
    // P13: backup targets are multi-row — just move them over.
    const bt = await tx.select({ id: backupTargets.id }).from(backupTargets).where(eq(backupTargets.userId, sourceUserId));
    ledger.backupTargetsMoved = bt.map((b) => b.id);
    moved.backupTargets = bt.length ? count(await tx.update(backupTargets).set({ userId: targetUserId }).where(inArray(backupTargets.id, ledger.backupTargetsMoved))) : 0;
    await tx.delete(verificationCodes).where(eq(verificationCodes.userId, sourceUserId));

    // 6. Audit (with ledger). Source row stays (soft-deleted) until purge.
    const ins = await tx.insert(accountMerges).values({ targetUserId, sourceUserId, sourceEmail: source.email, sourcePhone: source.phone, moved: JSON.stringify(moved), ledger: JSON.stringify(ledger), undoDeadline, choices: choices && Object.keys(choices).length ? JSON.stringify(choices) : null });
    mergeId = Number(ins[0].insertId);
    if (!undoDeadline) {
      await tx.delete(users).where(eq(users.id, sourceUserId));
      await tx.update(accountMerges).set({ purgedAt: now }).where(eq(accountMerges.id, mergeId));
    }
  });

  return { mergeId, sourceUserId, moved, undoDeadline };
}

/* ------------------------------------------------------------------ */
/* Undo                                                                */
/* ------------------------------------------------------------------ */

const TABLES: Record<string, AnyTable> = {
  families: families as unknown as AnyTable,
  albums,
  media: media as unknown as AnyTable,
  comments: comments as unknown as AnyTable,
  loveStories: loveStories as unknown as AnyTable,
  anniversaries: anniversaries as unknown as AnyTable,
  invitations: invitations as unknown as AnyTable,
  shares: shares as unknown as AnyTable,
  notifications: notifications as unknown as AnyTable,
  notificationsActed: notifications as unknown as AnyTable,
  studioJobs: studioJobs as unknown as AnyTable,
  backups: backups as unknown as AnyTable,
  pushTokens: pushTokens as unknown as AnyTable,
  oauthAccounts: oauthAccounts as unknown as AnyTable,
  likes: likes as unknown as AnyTable,
  familyMembers: familyMembers as unknown as AnyTable,
};

/** Reverse a merge within its undo window. Only the target (signed-in) user may undo. */
export async function undoMerge(targetUserId: number, mergeId: number, now = new Date()): Promise<{ restored: Record<string, number>; sourceUserId: number }> {
  const database = await requireDatabase();
  const [m] = await database.select().from(accountMerges).where(and(eq(accountMerges.id, mergeId), eq(accountMerges.targetUserId, targetUserId))).limit(1);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Merge not found" });
  if (!canUndo(m, now)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: m.undoneAt ? "Already undone" : "The undo window has closed" });
  if (!m.ledger) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This merge predates undo support" });
  const ledger = JSON.parse(m.ledger) as MergeLedger & { restoreJobIds?: string[] };
  const [source] = await database.select().from(users).where(eq(users.id, m.sourceUserId)).limit(1);
  if (!source || !source.mergedIntoUserId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Source account no longer exists" });
  // The identity must still be free (target could have since taken the phone / someone else the email).
  if (ledger.source.email) {
    const [clash] = await database.select({ id: users.id }).from(users).where(and(eq(users.email, ledger.source.email), isNull(users.mergedIntoUserId))).limit(1);
    if (clash && clash.id !== m.sourceUserId) throw new TRPCError({ code: "CONFLICT", message: "The original email is now used by another account" });
  }

  const restored: Record<string, number> = {};
  await database.transaction(async (tx) => {
    const src = m.sourceUserId;
    for (const [name, entry] of Object.entries(ledger.repointed)) {
      const table = TABLES[name];
      if (!table || entry.ids.length === 0) {
        restored[name] = 0;
        continue;
      }
      const col = (table as unknown as Record<string, unknown>)[entry.column] as typeof albums.createdBy;
      const idCol = (table as unknown as Record<string, unknown>).id as typeof albums.id;
      restored[name] = count(await tx.update(table).set({ [entry.column]: src } as never).where(and(inArray(idCol, entry.ids), eq(col, targetUserId))));
    }
    if (ledger.repointed.mediaAnalysis?.ids.length) {
      restored.mediaAnalysis = count(await tx.update(mediaAnalysis).set({ analyzedBy: src }).where(and(inArray(mediaAnalysis.mediaId, ledger.repointed.mediaAnalysis.ids), eq(mediaAnalysis.analyzedBy, targetUserId))));
    }
    if (ledger.restoreJobIds?.length) restored.restoreJobs = count(await tx.update(restoreJobs).set({ userId: src }).where(inArray(restoreJobs.id, ledger.restoreJobIds)));
    for (const r of ledger.rolesRaised) await tx.update(familyMembers).set({ role: r.previousRole as never }).where(eq(familyMembers.id, r.id));
    for (const d of ledger.membershipsDropped) await tx.insert(familyMembers).values({ familyId: d.familyId, userId: src, role: d.role as never, joinedAt: new Date(d.joinedAt) }).onDuplicateKeyUpdate({ set: { role: d.role as never } });
    restored.membershipsRestored = ledger.membershipsDropped.length;
    for (const l of ledger.likesDropped) await tx.insert(likes).values({ mediaId: l.mediaId, userId: src, createdAt: new Date(l.createdAt) }).onDuplicateKeyUpdate({ set: { userId: src } });
    restored.likesRestored = ledger.likesDropped.length;
    if (ledger.backupTargetsMoved.length) restored.backupTargets = count(await tx.update(backupTargets).set({ userId: src }).where(inArray(backupTargets.id, ledger.backupTargetsMoved)));
    if (ledger.sourcePreferences) {
      const { createdAt: _c, updatedAt: _u, ...prefs } = ledger.sourcePreferences as Record<string, unknown> & { createdAt?: unknown; updatedAt?: unknown };
      await tx.insert(userPreferences).values({ ...(prefs as typeof userPreferences.$inferInsert), userId: src, lastDigestAt: null }).onDuplicateKeyUpdate({ set: { userId: src } });
    }
    // Target: clear the fields we copied in (the source gets them back via its own row).
    const unpatch: Partial<typeof users.$inferInsert> = {};
    for (const f of ledger.targetPatched) {
      if (f === "phone") {
        unpatch.phone = null;
        unpatch.phoneVerifiedAt = null;
      } else (unpatch as Record<string, unknown>)[f] = null;
    }
    // Restore source identity *after* the target released the phone (unique index).
    if (Object.keys(unpatch).length) await tx.update(users).set(unpatch).where(eq(users.id, targetUserId));
    await tx
      .update(users)
      .set({ email: ledger.source.email, phone: ledger.source.phone, phoneVerifiedAt: ledger.source.phoneVerifiedAt ? new Date(ledger.source.phoneVerifiedAt) : null, openId: ledger.source.openId, mergedIntoUserId: null, mergedAt: null })
      .where(eq(users.id, src));
    await tx.update(accountMerges).set({ undoneAt: now }).where(eq(accountMerges.id, mergeId));
  });
  return { restored, sourceUserId: m.sourceUserId };
}

/* ------------------------------------------------------------------ */
/* Purge + history + CSV                                               */
/* ------------------------------------------------------------------ */

/** Delete soft-deleted source users whose undo window has closed. */
export async function purgeExpiredMerges(now = new Date()): Promise<number> {
  const database = await requireDatabase();
  const due = await database
    .select({ id: accountMerges.id, sourceUserId: accountMerges.sourceUserId })
    .from(accountMerges)
    .where(and(isNull(accountMerges.undoneAt), isNull(accountMerges.purgedAt), isNotNull(accountMerges.undoDeadline), lt(accountMerges.undoDeadline, now)))
    .limit(100);
  for (const m of due) {
    await database.delete(users).where(and(eq(users.id, m.sourceUserId), isNotNull(users.mergedIntoUserId)));
    await database.update(accountMerges).set({ purgedAt: now, ledger: null }).where(eq(accountMerges.id, m.id));
  }
  return due.length;
}

let purgeTimer: NodeJS.Timeout | null = null;
export function startMergePurgeScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
  if (process.env.MERGE_PURGE_SCHEDULER === "0" || purgeTimer) return;
  const tick = () => void runIfLeader("merge-purge", 60 * 60 * 1000, () => purgeExpiredMerges()).catch((e) => console.error("[merge] purge failed", e));
  purgeTimer = setInterval(tick, intervalMs);
  purgeTimer.unref?.();
  setTimeout(tick, 120_000).unref?.();
}

export function stopMergePurgeScheduler(): void {
  if (purgeTimer) clearInterval(purgeTimer);
  purgeTimer = null;
}

export async function listMerges(targetUserId: number, now = new Date()) {
  const database = await requireDatabase();
  const rows = await database.select().from(accountMerges).where(eq(accountMerges.targetUserId, targetUserId));
  return rows.map((m) => ({
    id: m.id,
    sourceUserId: m.sourceUserId,
    sourceEmail: m.sourceEmail,
    sourcePhone: m.sourcePhone,
    moved: JSON.parse(m.moved) as Record<string, number>,
    undoDeadline: m.undoDeadline,
    undoneAt: m.undoneAt,
    purgedAt: m.purgedAt,
    canUndo: canUndo(m, now),
    createdAt: m.createdAt,
  }));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Pure: CSV of the audit rows (one line per merge, moved counts flattened). */
export function mergeAuditCsv(rows: Array<Pick<AccountMerge, "id" | "targetUserId" | "sourceUserId" | "sourceEmail" | "sourcePhone" | "moved" | "undoDeadline" | "undoneAt" | "purgedAt" | "createdAt">>): string {
  const movedKeys = [...new Set(rows.flatMap((r) => Object.keys(JSON.parse(r.moved) as Record<string, number>)))].sort();
  const header = ["id", "createdAt", "targetUserId", "sourceUserId", "sourceEmail", "sourcePhone", "status", "undoDeadline", "undoneAt", "purgedAt", ...movedKeys.map((k) => `moved_${k}`)];
  const lines = rows.map((r) => {
    const moved = JSON.parse(r.moved) as Record<string, number>;
    const status = r.undoneAt ? "undone" : r.purgedAt ? "purged" : "merged";
    return [r.id, r.createdAt, r.targetUserId, r.sourceUserId, r.sourceEmail, r.sourcePhone, status, r.undoDeadline, r.undoneAt, r.purgedAt, ...movedKeys.map((k) => moved[k] ?? 0)].map(csvCell).join(",");
  });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** Audit export: the user's own merges, or everything for admins. */
export async function exportMergeAudit(opts: { userId: number; all: boolean }): Promise<string> {
  const database = await requireDatabase();
  const rows = opts.all ? await database.select().from(accountMerges).orderBy(accountMerges.id) : await database.select().from(accountMerges).where(eq(accountMerges.targetUserId, opts.userId)).orderBy(accountMerges.id);
  return mergeAuditCsv(rows);
}

/* ------------------------------------------------------------------ */
/* P15 — ownership audit view                                          */
/* ------------------------------------------------------------------ */

export const AUDIT_TABLES = ["media", "albums", "families", "comments", "likes", "loveStories", "anniversaries", "invitations", "shares", "notifications", "notificationsActed", "studioJobs", "backups", "pushTokens", "oauthAccounts", "familyMembers"] as const;
export type AuditTable = (typeof AUDIT_TABLES)[number];

export interface ProvenanceRow {
  mergeId: number;
  table: string;
  column: string;
  rowId: number;
  /** owner before the merge */
  fromUserId: number;
  /** owner after the merge */
  toUserId: number;
  mergedAt: Date;
  /** "merged" (still re-pointed) · "undone" (rolled back) · "purged" (source gone for good) */
  status: "merged" | "undone" | "purged";
  /** likes / memberships deleted as duplicates rather than re-pointed */
  dropped?: boolean;
}

/**
 * Pure: flatten one merge's ledger into per-row provenance records. Dropped
 * duplicates (likes / memberships) are included with `dropped: true` so the
 * audit shows what disappeared, not only what moved.
 */
export function ledgerToProvenance(m: Pick<AccountMerge, "id" | "targetUserId" | "sourceUserId" | "ledger" | "createdAt" | "undoneAt" | "purgedAt">, table?: string | null): ProvenanceRow[] {
  if (!m.ledger) return [];
  let ledger: MergeLedger;
  try {
    ledger = JSON.parse(m.ledger) as MergeLedger;
  } catch {
    return [];
  }
  const status: ProvenanceRow["status"] = m.undoneAt ? "undone" : m.purgedAt ? "purged" : "merged";
  const out: ProvenanceRow[] = [];
  for (const [name, r] of Object.entries(ledger.repointed ?? {})) {
    if (table && name !== table) continue;
    for (const id of r.ids) out.push({ mergeId: m.id, table: name, column: r.column, rowId: id, fromUserId: m.sourceUserId, toUserId: m.targetUserId, mergedAt: m.createdAt, status });
  }
  if (!table || table === "likes") for (const l of ledger.likesDropped ?? []) out.push({ mergeId: m.id, table: "likes", column: "userId", rowId: l.mediaId, fromUserId: m.sourceUserId, toUserId: m.targetUserId, mergedAt: m.createdAt, status, dropped: true });
  if (!table || table === "familyMembers") for (const d of ledger.membershipsDropped ?? []) out.push({ mergeId: m.id, table: "familyMembers", column: "userId", rowId: d.familyId, fromUserId: m.sourceUserId, toUserId: m.targetUserId, mergedAt: m.createdAt, status, dropped: true });
  return out;
}

export interface OwnershipAuditRow extends ProvenanceRow {
  /** human label of the row (photo title, album name, comment snippet …) when it still exists */
  label: string | null;
  /** who owns the row now (null = row gone) */
  currentOwnerId: number | null;
  familyId: number | null;
}

async function labelRows(database: NonNullable<Awaited<ReturnType<typeof getDb>>>, table: string, ids: number[]): Promise<Map<number, { label: string | null; owner: number | null; familyId: number | null }>> {
  const out = new Map<number, { label: string | null; owner: number | null; familyId: number | null }>();
  if (!ids.length) return out;
  const put = (rows: Array<{ id: number; label: string | null; owner: number | null; familyId: number | null }>) => rows.forEach((r) => out.set(Number(r.id), { label: r.label, owner: r.owner, familyId: r.familyId }));
  switch (table) {
    case "media":
      put(await database.select({ id: media.id, label: media.title, owner: media.uploadedBy, familyId: media.familyId }).from(media).where(inArray(media.id, ids)));
      break;
    case "albums":
      put(await database.select({ id: albums.id, label: albums.name, owner: albums.createdBy, familyId: albums.familyId }).from(albums).where(inArray(albums.id, ids)));
      break;
    case "families":
      put((await database.select({ id: families.id, label: families.name, owner: families.createdBy }).from(families).where(inArray(families.id, ids))).map((r) => ({ ...r, familyId: r.id })));
      break;
    case "comments":
      put((await database.select({ id: comments.id, label: comments.content, owner: comments.userId }).from(comments).where(inArray(comments.id, ids))).map((r) => ({ ...r, label: r.label?.slice(0, 60) ?? null, familyId: null })));
      break;
    case "loveStories":
      put(await database.select({ id: loveStories.id, label: loveStories.title, owner: loveStories.createdBy, familyId: loveStories.familyId }).from(loveStories).where(inArray(loveStories.id, ids)));
      break;
    case "anniversaries":
      put(await database.select({ id: anniversaries.id, label: anniversaries.couple, owner: anniversaries.createdBy, familyId: anniversaries.familyId }).from(anniversaries).where(inArray(anniversaries.id, ids)));
      break;
    case "backups":
      put((await database.select({ id: backups.id, owner: backups.userId, label: backups.storageKey }).from(backups).where(inArray(backups.id, ids))).map((r) => ({ ...r, label: r.label.split("/").pop() ?? null, familyId: null })));
      break;
    default:
      break;
  }
  return out;
}

/**
 * Ownership audit for the caller's merges (admins may pass `all`). Filter by
 * merge / table; paginated. Rows are decorated with their current label and
 * owner so an admin can see "photo X came from account B and now belongs to
 * A (still true / rolled back)".
 */
export async function ownershipAudit(opts: { userId: number; all: boolean; mergeId?: number | null; table?: string | null; offset?: number; limit?: number }): Promise<{ total: number; rows: OwnershipAuditRow[]; tables: Array<{ table: string; count: number }>; merges: Array<{ id: number; sourceEmail: string | null; createdAt: Date; status: ProvenanceRow["status"] }> }> {
  const database = await requireDatabase();
  const where = opts.all ? (opts.mergeId ? eq(accountMerges.id, opts.mergeId) : undefined) : opts.mergeId ? and(eq(accountMerges.targetUserId, opts.userId), eq(accountMerges.id, opts.mergeId)) : eq(accountMerges.targetUserId, opts.userId);
  const merges = where ? await database.select().from(accountMerges).where(where).orderBy(accountMerges.id) : await database.select().from(accountMerges).orderBy(accountMerges.id);
  const everything = merges.flatMap((m) => ledgerToProvenance(m));
  const counts = new Map<string, number>();
  for (const r of everything) counts.set(r.table, (counts.get(r.table) ?? 0) + 1);
  const filtered = opts.table ? everything.filter((r) => r.table === opts.table) : everything;
  filtered.sort((a, b) => b.mergedAt.getTime() - a.mergedAt.getTime() || a.table.localeCompare(b.table) || a.rowId - b.rowId);
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const page = filtered.slice(offset, offset + limit);
  // decorate per table
  const byTable = new Map<string, number[]>();
  for (const r of page) if (!r.dropped) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.rowId]);
  const labels = new Map<string, Awaited<ReturnType<typeof labelRows>>>();
  for (const [t, ids] of byTable) labels.set(t, await labelRows(database, t, [...new Set(ids)]));
  const rows: OwnershipAuditRow[] = page.map((r) => {
    const info = r.dropped ? undefined : labels.get(r.table)?.get(r.rowId);
    return { ...r, label: info?.label ?? null, currentOwnerId: info?.owner ?? null, familyId: info?.familyId ?? null };
  });
  return {
    total: filtered.length,
    rows,
    tables: [...counts.entries()].map(([table, count]) => ({ table, count })).sort((a, b) => b.count - a.count),
    merges: merges.map((m) => ({ id: m.id, sourceEmail: m.sourceEmail, createdAt: m.createdAt, status: m.undoneAt ? "undone" : m.purgedAt ? "purged" : "merged" })),
  };
}

/** Pure: CSV of the provenance rows (with optional labels). */
export function ownershipAuditCsv(rows: Array<ProvenanceRow & Partial<Pick<OwnershipAuditRow, "label" | "currentOwnerId" | "familyId">>>): string {
  const header = ["mergeId", "mergedAt", "status", "table", "column", "rowId", "fromUserId", "toUserId", "dropped", "currentOwnerId", "familyId", "label"];
  const lines = rows.map((r) => [r.mergeId, r.mergedAt, r.status, r.table, r.column, r.rowId, r.fromUserId, r.toUserId, r.dropped ? 1 : 0, r.currentOwnerId ?? "", r.familyId ?? "", r.label ?? ""].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
