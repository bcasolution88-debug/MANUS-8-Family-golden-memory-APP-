import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { appRouter } from "../server/routers";
import { getDb } from "../server/db";
import {
  albums,
  anniversaries,
  comments,
  families,
  familyMembers,
  invitations,
  likes,
  loveStories,
  backups,
  backupTargets,
  pushTokens,
  mediaAnalysis,
  studioJobs,
  userPreferences,
  verificationCodes,
  metricEvents,
  restoreJobs,
  accountMerges,
  onCallShifts,
  onCallHandovers,
  targetCopyJobs,
  pushDigestQueue,
  media,
  notifications,
  oauthAccounts,
  shares,
  users,
} from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";
import { __lastIssuedCodes } from "../server/verificationRouter";
import { findDueBackupUsers } from "../server/backupService";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeIntegration = testDatabaseUrl ? describe : describe.skip;

const testUser = {
  openId: `ci-integration-${Date.now()}`,
  email: `ci-${Date.now()}@example.test`,
  name: "CI Integration User",
  loginMethod: "integration",
  role: "user" as const,
};

const intruderUser = {
  openId: `ci-intruder-${Date.now()}`,
  email: `ci-intruder-${Date.now()}@example.test`,
  name: "CI Intruder",
  loginMethod: "integration",
  role: "user" as const,
};

let userId = 0;
let intruderId = 0;
let pwUserId = 0;
let familyId = 0;
let albumId = 0;
let mediaId = 0;
let commentId = 0;
let shareId = "";

function createContext(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      hostname: "localhost",
      headers: {},
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {
      clearCookie: () => undefined,
      cookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

describeIntegration("API and database integration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.RATE_LIMIT_DISABLED = "1";
    const database = await getDb();
    if (!database)
      throw new Error("TEST_DATABASE_URL did not create a database connection");

    await database.insert(users).values([testUser, intruderUser]);
    const rows = await database
      .select()
      .from(users)
      .where(eq(users.openId, testUser.openId))
      .limit(1);
    if (!rows[0]) throw new Error("Failed to create integration test user");
    userId = rows[0].id;
    const intruderRows = await database
      .select()
      .from(users)
      .where(eq(users.openId, intruderUser.openId))
      .limit(1);
    if (!intruderRows[0])
      throw new Error("Failed to create intruder test user");
    intruderId = intruderRows[0].id;
  });

  afterAll(async () => {
    const database = await getDb();
    if (!database || !userId) return;

    if (shareId) await database.delete(shares).where(eq(shares.id, shareId));
    await database.delete(notifications).where(eq(notifications.userId, userId));
    await database.delete(notifications).where(eq(notifications.userId, intruderId));
    await database
      .delete(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));
    if (familyId) {
      await database.delete(comments).where(eq(comments.mediaId, mediaId));
      await database.delete(likes).where(eq(likes.mediaId, mediaId));
      await database.delete(media).where(eq(media.familyId, familyId));
    }
    if (albumId) await database.delete(albums).where(eq(albums.id, albumId));
    if (familyId) {
      await database.delete(invitations).where(eq(invitations.familyId, familyId));
      await database
        .delete(loveStories)
        .where(eq(loveStories.familyId, familyId));
      await database
        .delete(anniversaries)
        .where(eq(anniversaries.familyId, familyId));
      await database
        .delete(familyMembers)
        .where(eq(familyMembers.familyId, familyId));
      await database.delete(families).where(eq(families.id, familyId));
    }
    await database.delete(verificationCodes).where(inArray(verificationCodes.email, [intruderUser.email, `ci-pw-x@example.test`]));
    if (pwUserId) {
      await database.delete(verificationCodes).where(eq(verificationCodes.userId, pwUserId));
      await database.delete(userPreferences).where(eq(userPreferences.userId, pwUserId));
      await database.delete(users).where(eq(users.id, pwUserId));
    }
    await database.delete(verificationCodes).where(eq(verificationCodes.userId, userId));
    await database.delete(backups).where(eq(backups.userId, userId));
    await database.delete(backupTargets).where(eq(backupTargets.userId, userId));
    await database.delete(pushTokens).where(eq(pushTokens.userId, userId));
    await database.delete(userPreferences).where(inArray(userPreferences.userId, [userId, intruderId]));
    await database.delete(mediaAnalysis).where(eq(mediaAnalysis.mediaId, mediaId));
    await database.delete(studioJobs).where(eq(studioJobs.userId, userId));
    await database.delete(restoreJobs).where(eq(restoreJobs.userId, userId));
    await database.delete(accountMerges).where(eq(accountMerges.targetUserId, userId));
    await database.delete(metricEvents).where(like(metricEvents.detail, "%ci-%"));
    await database.delete(users).where(eq(users.id, intruderId));
    await database.delete(users).where(eq(users.id, userId));
  });

  it("runs public and authenticated API routes against MySQL", async () => {
    const database = await getDb();
    if (!database) throw new Error("Database connection unavailable");
    const rows = await database
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) throw new Error("Integration test user unavailable");

    const caller = appRouter.createCaller(createContext(user));

    await expect(
      caller.system.health({ timestamp: Date.now() }),
    ).resolves.toEqual({ ok: true });
    await expect(caller.auth.me()).resolves.toMatchObject({
      id: userId,
      openId: testUser.openId,
    });
    await expect(
      caller.oauth.getOAuthAccount({ provider: "google" }),
    ).resolves.toBeUndefined();

    const familyResult = await caller.family.createFamily({
      name: "CI Integration Family",
      description: "Temporary integration test data",
    });
    familyId = Number(familyResult?.id);
    expect(familyId).toBeGreaterThan(0);
    await expect(caller.family.getFamily({ familyId })).resolves.toMatchObject({
      id: familyId,
    });
    await expect(caller.family.getUserFamilies()).resolves.toHaveLength(1);
    await expect(caller.family.getMembers({ familyId })).resolves.toHaveLength(
      1,
    );

    // Family creator is owner (unified role model)
    await expect(caller.family.getMembers({ familyId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId, role: "owner" })]),
    );

    const album = await caller.album.create({
      familyId,
      name: "CI Album",
      description: "Album route test",
      category: "gathering",
    });
    albumId = album.id;
    expect(albumId).toBeGreaterThan(0);
    await expect(caller.album.list({ familyId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: albumId, mediaCount: 0 })]),
    );
    await expect(caller.album.list({ familyId, search: "CI Al" })).resolves.toHaveLength(1);
    await expect(caller.album.list({ familyId, category: "travel" })).resolves.toHaveLength(0);
    await expect(caller.album.get({ id: albumId })).resolves.toMatchObject({
      id: albumId,
    });
    await expect(
      caller.album.update({ id: albumId, description: "Updated by CI" }),
    ).resolves.toMatchObject({ id: albumId, description: "Updated by CI" });

    const upload = await caller.media.initUpload({
      fileName: "ci-photo.jpg",
      fileSize: 128,
      fileType: "image",
      albumId,
    });
    const uploaded = await caller.media.completeUpload({
      uploadId: upload.uploadId,
      fileName: "ci-photo.jpg",
      fileSize: 128,
      fileType: "image",
      albumId,
      familyId,
      title: "CI photo",
    });
    mediaId = uploaded.id;
    expect(uploaded).toMatchObject({ type: "photo", albumId });
    // P3: object keys are owner-prefixed and the stored URL is the access-controlled proxy path
    expect(upload.storageKey).toBe(`families/${familyId}/albums/${albumId}/${upload.uploadId}/ci-photo.jpg`);
    expect(uploaded.storageKey).toBe(upload.storageKey);
    expect(uploaded.url).toBe(`/manus-storage/${upload.storageKey}`);
    await expect(caller.media.getSignedUrl({ id: mediaId })).resolves.toMatchObject({
      url: expect.any(String),
      expiresAt: expect.any(Date),
    });
    // A client may not register an object under a foreign prefix
    await expect(
      caller.media.completeUpload({
        uploadId: upload.uploadId,
        fileName: "ci-photo.jpg",
        fileSize: 128,
        fileType: "image",
        albumId,
        familyId,
        storageKey: `families/999/albums/999/${upload.uploadId}/ci-photo.jpg`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.media.getMediaList({ albumId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mediaId, type: "photo" }),
      ]),
    );
    await expect(caller.album.stats({ id: albumId })).resolves.toMatchObject({
      mediaCount: 1,
      photoCount: 1,
      videoCount: 0,
    });

    // P5: thumbnail presign, keyset list, family-wide recent, move between albums
    expect(upload.thumbnailKey).toBe(`families/${familyId}/albums/${albumId}/${upload.uploadId}/thumb_ci-photo.jpg`);
    const page = await caller.media.listMedia({ albumId, take: 10 });
    expect(page.items.map((m) => m.id)).toContain(mediaId);
    expect(page.nextCursor).toBeUndefined();
    await expect(caller.media.recent({ familyId, take: 5 })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: mediaId, albumName: "CI Album" })]),
    );
    const other = await caller.album.create({ familyId, name: "CI Other", category: "travel" });
    await expect(caller.media.moveMedia({ ids: [mediaId], targetAlbumId: other.id })).resolves.toEqual({ moved: 1 });
    await expect(caller.media.getMedia({ id: mediaId })).resolves.toMatchObject({ albumId: other.id });
    await expect(caller.media.moveMedia({ ids: [mediaId], targetAlbumId: albumId })).resolves.toEqual({ moved: 1 });
    await caller.album.delete({ id: other.id });

    // Likes are idempotent and keep media.likeCount in sync
    await expect(caller.interaction.hasLiked({ mediaId })).resolves.toEqual({ liked: false });
    const like1 = await caller.interaction.createLike({ mediaId });
    await expect(caller.interaction.hasLiked({ mediaId })).resolves.toEqual({ liked: true });
    const like2 = await caller.interaction.createLike({ mediaId });
    expect(like2.id).toBe(like1.id);
    await expect(caller.interaction.getLikes({ mediaId })).resolves.toHaveLength(1);
    await expect(caller.media.getMedia({ id: mediaId })).resolves.toMatchObject({ likeCount: 1 });
    await caller.interaction.deleteLike({ mediaId });
    await expect(caller.interaction.getLikes({ mediaId })).resolves.toHaveLength(0);
    await expect(caller.media.getMedia({ id: mediaId })).resolves.toMatchObject({ likeCount: 0 });

    const comment = await caller.interaction.createComment({
      mediaId,
      content: "Great memory",
      rating: 5,
    });
    commentId = comment.id;
    expect(comment).toMatchObject({ content: "Great memory", userId });
    // P4: comments carry the author profile
    await expect(caller.interaction.getComments({ mediaId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ author: expect.objectContaining({ id: userId }) })]),
    );
    await expect(caller.interaction.getComments({ mediaId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: commentId, content: "Great memory" }),
      ]),
    );
    await expect(caller.media.getMedia({ id: mediaId })).resolves.toMatchObject({ commentCount: 1 });
    await caller.interaction.deleteComment({ id: commentId });
    await expect(caller.interaction.getComments({ mediaId })).resolves.toHaveLength(0);
    await expect(caller.media.getMedia({ id: mediaId })).resolves.toMatchObject({ commentCount: 0 });

    // Self-actions never produce notifications for the actor
    await expect(caller.notification.unreadCount()).resolves.toMatchObject({ total: 0 });

    await caller.family.createLoveStory({
      familyId,
      chapter: 1,
      year: 1990,
      title: "First memory",
    });
    await expect(caller.family.getLoveStories({ familyId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "First memory" }),
      ]),
    );

    await caller.family.createAnniversary({
      familyId,
      type: "golden",
      date: new Date("2030-01-01T00:00:00.000Z"),
      couple: "CI Couple",
    });
    await expect(caller.family.getAnniversaries({ familyId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ couple: "CI Couple" }),
      ]),
    );

    const share = await caller.interaction.createShare({
      mediaId,
      platform: "link",
      caption: "CI share",
    });
    shareId = share.id;
    await expect(caller.interaction.getShares({ mediaId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: shareId })]),
    );
    await expect(
      caller.interaction.getShareStats({ id: shareId }),
    ).resolves.toMatchObject({ clicks: 0 });
    await caller.interaction.recordShareClick({ id: shareId });
    await expect(
      caller.interaction.getShareStats({ id: shareId }),
    ).resolves.toMatchObject({ clicks: 1, status: "active" });

    // P3 share lifecycle: expiry presets, extend, revoke, status filter
    const expiring = await caller.interaction.createShare({ albumId, platform: "link", expiresInDays: 7 });
    expect(expiring.status).toBe("active");
    expect(expiring.expiresAt).toBeInstanceOf(Date);
    const extended = await caller.interaction.updateShareExpiry({ id: expiring.id, expiresInDays: null });
    expect(extended.expiresAt).toBeNull();

    const revoked = await caller.interaction.revokeShare({ id: expiring.id });
    expect(revoked.status).toBe("revoked");
    await expect(caller.interaction.revokeShare({ id: expiring.id })).resolves.toMatchObject({ status: "revoked" });
    await expect(caller.interaction.recordShareClick({ id: expiring.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.interaction.updateShareExpiry({ id: expiring.id, expiresInDays: 30 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.interaction.getShares({ albumId, status: "active" })).resolves.toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: expiring.id })]),
    );
    await expect(caller.interaction.getShares({ albumId, status: "all" })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expiring.id, status: "revoked" })]),
    );
  });

  it("only the owner can revoke or extend a share", async () => {
    const database = await getDb();
    if (!database) throw new Error("Database connection unavailable");
    const rows = await database.select().from(users).where(eq(users.id, intruderId)).limit(1);
    const intruderCaller = appRouter.createCaller(createContext(rows[0]!));
    await expect(intruderCaller.interaction.revokeShare({ id: shareId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      intruderCaller.interaction.updateShareExpiry({ id: shareId, expiresInDays: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects cross-family BOLA/IDOR access", async () => {
    const database = await getDb();
    if (!database) throw new Error("Database connection unavailable");
    const intruderRows = await database
      .select()
      .from(users)
      .where(eq(users.id, intruderId))
      .limit(1);
    const intruder = intruderRows[0];
    if (!intruder) throw new Error("Intruder test user unavailable");
    const intruderCaller = appRouter.createCaller(createContext(intruder));

    await expect(
      intruderCaller.family.getFamily({ familyId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.family.getMembers({ familyId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.album.get({ id: albumId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.album.list({ familyId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.media.getMediaList({ albumId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.interaction.createLike({ mediaId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.media.getMedia({ id: mediaId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.interaction.getShareStats({ id: shareId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.interaction.createShare({ mediaId, platform: "link" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("P6: timeline aggregation, profile stats, invitations and story/anniversary edits", async () => {
    const database = await getDb();
    if (!database) throw new Error("Database connection unavailable");
    const [owner] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
    const [guest] = await database.select().from(users).where(eq(users.id, intruderId)).limit(1);
    if (!owner || !guest) throw new Error("Test users unavailable");
    const ownerCaller = appRouter.createCaller(createContext(owner));
    const guestCaller = appRouter.createCaller(createContext(guest));

    // Timeline aggregates uploads / stories / anniversaries, filterable by type + search
    const feed = await ownerCaller.timeline.list({ familyId, range: "all" });
    expect(feed.map((e) => e.type)).toEqual(expect.arrayContaining(["upload", "story", "anniversary"]));
    const uploadEvent = feed.find((e) => e.type === "upload");
    expect(uploadEvent).toMatchObject({ albumId, count: 1, actor: expect.objectContaining({ id: userId }) });
    await expect(ownerCaller.timeline.list({ familyId, type: "story" })).resolves.toEqual([
      expect.objectContaining({ type: "story", preview: expect.stringContaining("First memory") }),
    ]);
    await expect(ownerCaller.timeline.list({ familyId, search: "no-such-term-xyz" })).resolves.toHaveLength(0);
    await expect(guestCaller.timeline.list({ familyId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Profile stats + update
    await expect(ownerCaller.profile.stats()).resolves.toMatchObject({ uploads: 1, photos: 1, stories: 1 });
    await ownerCaller.profile.update({ relationship: "爷爷" });
    await expect(ownerCaller.auth.me()).resolves.toMatchObject({ relationship: "爷爷" });

    // updateFamily is admin-only
    await ownerCaller.family.updateFamily({ familyId, name: "CI Family Renamed" });
    await expect(ownerCaller.family.getFamily({ familyId })).resolves.toMatchObject({ name: "CI Family Renamed" });
    await expect(
      guestCaller.family.updateFamily({ familyId, name: "Hijack" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Invite an unknown email -> pending code; re-invite refreshes the same row; list / revoke
    const pendingEmail = `ci-pending-${Date.now()}@example.test`;
    const invite1 = await ownerCaller.family.inviteByEmail({ familyId, email: pendingEmail });
    expect(invite1.status).toBe("pending");
    if (invite1.status !== "pending") throw new Error("unreachable");
    expect(invite1.code).toMatch(/^[A-Z0-9]{12}$/);
    const invite2 = await ownerCaller.family.inviteByEmail({ familyId, email: pendingEmail });
    if (invite2.status !== "pending") throw new Error("unreachable");
    expect(invite2.invitationId).toBe(invite1.invitationId);
    expect(invite2.code).not.toBe(invite1.code);
    await expect(ownerCaller.family.listInvitations({ familyId })).resolves.toHaveLength(1);
    // The old code is dead after refresh
    await expect(guestCaller.family.acceptInvitation({ code: invite1.code })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Guest redeems the fresh code (lower-case tolerated) and becomes an editor
    await expect(guestCaller.family.acceptInvitation({ code: invite2.code.toLowerCase() })).resolves.toEqual({ familyId });
    await expect(ownerCaller.family.getMembers({ familyId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: intruderId, role: "editor" })]),
    );
    await expect(ownerCaller.family.listInvitations({ familyId })).resolves.toHaveLength(0);
    // Member joined notification reaches the owner
    const joinFeed = await ownerCaller.notification.list({ type: "member_joined" });
    expect(joinFeed.items[0]).toMatchObject({ actorId: intruderId, familyId });
    await ownerCaller.notification.markAllRead();

    // Inviting an existing member is a CONFLICT; inviting an existing user adds directly
    await expect(
      ownerCaller.family.inviteByEmail({ familyId, email: guest.email! }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const revokable = await ownerCaller.family.inviteByEmail({ familyId, email: `ci-revoke-${Date.now()}@example.test` });
    if (revokable.status !== "pending") throw new Error("unreachable");
    await ownerCaller.family.revokeInvitation({ id: revokable.invitationId });
    await expect(ownerCaller.family.listInvitations({ familyId })).resolves.toHaveLength(0);
    await expect(guestCaller.family.acceptInvitation({ code: revokable.code })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Love story / anniversary update + delete, with author|admin gating
    const [story] = await ownerCaller.family.getLoveStories({ familyId });
    expect(story).toBeDefined();
    await ownerCaller.family.updateLoveStory({ id: story!.id, title: "First memory (edited)", year: 1991 });
    await expect(ownerCaller.family.getLoveStories({ familyId })).resolves.toEqual([
      expect.objectContaining({ title: "First memory (edited)", year: 1991 }),
    ]);
    await expect(
      guestCaller.family.updateLoveStory({ id: story!.id, title: "Hijack" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const guestStory = await guestCaller.family.createLoveStory({ familyId, chapter: 2, title: "Guest chapter" });
    await guestCaller.family.deleteLoveStory({ id: guestStory.id });
    await expect(ownerCaller.family.getLoveStories({ familyId })).resolves.toHaveLength(1);

    const [anniv] = await ownerCaller.family.getAnniversaries({ familyId });
    expect(anniv).toBeDefined();
    await ownerCaller.family.updateAnniversary({ id: anniv!.id, couple: "CI Couple (edited)", type: "diamond" });
    await expect(ownerCaller.family.getAnniversaries({ familyId })).resolves.toEqual([
      expect.objectContaining({ couple: "CI Couple (edited)", type: "diamond" }),
    ]);
    await expect(
      guestCaller.family.deleteAnniversary({ id: anniv!.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const extra = await ownerCaller.family.createAnniversary({
      familyId,
      type: "silver",
      date: new Date("2031-06-01T00:00:00.000Z"),
      couple: "CI Extra",
    });
    await ownerCaller.family.deleteAnniversary({ id: extra.id });
    await expect(ownerCaller.family.getAnniversaries({ familyId })).resolves.toHaveLength(1);

    // P7: invitation preview (any signed-in user), storage usage, avatar key validation, studio templates/suggest
    const previewable = await ownerCaller.family.inviteByEmail({ familyId, email: `ci-preview-${Date.now()}@example.test` });
    if (previewable.status !== "pending") throw new Error("unreachable");
    const preview = await guestCaller.family.previewInvitation({ code: previewable.code.toLowerCase() });
    expect(preview).toMatchObject({
      status: "pending",
      expired: false,
      alreadyMember: true, // guest joined above
      family: expect.objectContaining({ id: familyId, memberCount: 2 }),
      inviter: expect.objectContaining({ id: userId }),
    });
    await ownerCaller.family.revokeInvitation({ id: previewable.invitationId });
    await expect(guestCaller.family.previewInvitation({ code: previewable.code })).resolves.toMatchObject({ status: "declined" });
    await expect(guestCaller.family.previewInvitation({ code: "NOPE00000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const usage = await ownerCaller.profile.storageUsage();
    expect(usage.count).toBe(1);
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.quotaBytes).toBeGreaterThan(usage.usedBytes);
    expect(usage.families).toEqual(expect.arrayContaining([expect.objectContaining({ familyId, count: 1 })]));

    await expect(
      ownerCaller.profile.completeAvatarUpload({ storageKey: `users/${intruderId}/avatar/x.jpg` }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      ownerCaller.profile.completeAvatarUpload({ storageKey: `families/${familyId}/albums/${albumId}/x.jpg` }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const withAvatar = await ownerCaller.profile.completeAvatarUpload({ storageKey: `users/${userId}/avatar/ci.jpg` });
    expect(withAvatar?.avatar).toBe(`/manus-storage/users/${userId}/avatar/ci.jpg`);
    await expect(ownerCaller.profile.avatarUrl({ avatar: "https://example.test/a.png" })).resolves.toEqual({ url: "https://example.test/a.png", signed: false });

    const studio = await ownerCaller.studio.templates();
    expect(studio.templates.length).toBeGreaterThanOrEqual(5);
    const suggestion = await ownerCaller.studio.suggest({ albumId, mediaIds: [mediaId], templateId: "romantic", language: "zh" });
    expect(suggestion.captions).toHaveLength(1);
    expect(suggestion.title.length).toBeGreaterThan(0);
    await expect(
      guestCaller.studio.suggest({ albumId, mediaIds: [mediaId], templateId: "romantic" }),
    ).resolves.toBeTruthy(); // guest is an editor here
    await expect(
      ownerCaller.studio.suggest({ albumId, mediaIds: [mediaId, 999999999], templateId: "romantic" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerCaller.studio.job({ jobId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // P8: preferences gate notifications; hideActivity filters timeline; password auth; AI analyze (heuristic); studio job persistence; export
    await expect(guestCaller.preferences.get()).resolves.toMatchObject({ notifyEnabled: true, notifyLikes: true, hideActivity: false });
    await guestCaller.preferences.update({ notifyLikes: false });
    await ownerCaller.notification.markAllRead();
    await guestCaller.notification.markAllRead();
    // owner likes guest's... guest has no media; instead guest disables comment notifications and owner comments on owner's own photo → no-op; test like gating the other way:
    await ownerCaller.preferences.update({ notifyLikes: false });
    await guestCaller.interaction.deleteLike({ mediaId }).catch(() => undefined);
    await guestCaller.interaction.createLike({ mediaId });
    await expect(ownerCaller.notification.list({ type: "like", unreadOnly: true })).resolves.toMatchObject({ items: [] });
    await ownerCaller.preferences.update({ notifyLikes: true });
    await guestCaller.interaction.deleteLike({ mediaId });
    await guestCaller.interaction.createLike({ mediaId });
    const likeFeed = await ownerCaller.notification.list({ type: "like", unreadOnly: true });
    expect(likeFeed.items).toHaveLength(1);
    await ownerCaller.notification.markAllRead();

    // hideActivity: guest's like disappears from owner's timeline but not from guest's own view
    await expect(ownerCaller.timeline.list({ familyId, type: "like" })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "like", actor: expect.objectContaining({ id: intruderId }) })]),
    );
    await guestCaller.preferences.update({ hideActivity: true });
    await expect(ownerCaller.timeline.list({ familyId, type: "like" })).resolves.toEqual([]);
    await expect(guestCaller.timeline.list({ familyId, type: "like" })).resolves.toHaveLength(1);
    await guestCaller.preferences.update({ hideActivity: false, notifyLikes: true });
    await guestCaller.interaction.deleteLike({ mediaId });

    // Password auth: register new user, wrong password, login, duplicate, OAuth-user precondition
    const pwEmail = `ci-pw-${Date.now()}@example.test`;
    const anon = appRouter.createCaller(createContext(null as unknown as typeof owner));
    const reg = await anon.auth.register({ email: pwEmail, password: "hunter2hunter2", name: "CI Password" });
    expect(reg.sessionToken.split(".")).toHaveLength(3);
    expect(reg.user.email).toBe(pwEmail);
    pwUserId = reg.user.id;
    await expect(anon.auth.register({ email: pwEmail, password: "hunter2hunter2", name: "Dup" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(anon.auth.login({ email: pwEmail, password: "wrong-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.auth.login({ email: pwEmail.toUpperCase(), password: "hunter2hunter2" })).resolves.toMatchObject({ user: { id: pwUserId } });
    await expect(anon.auth.login({ email: owner.email!, password: "whatever123" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(ownerCaller.auth.passwordStatus()).resolves.toMatchObject({ hasPassword: false });
    await ownerCaller.auth.changePassword({ newPassword: "owner-pass-123" });
    await expect(ownerCaller.auth.passwordStatus()).resolves.toMatchObject({ hasPassword: true });
    await expect(ownerCaller.auth.changePassword({ currentPassword: "nope", newPassword: "another-pass-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.auth.login({ email: owner.email!, password: "owner-pass-123" })).resolves.toMatchObject({ user: { id: userId } });

    // AI: heuristic analysis (no LLM in CI), cache, tagPerson → peopleIndex/byPerson, recommend shape
    const analysis = await ownerCaller.ai.analyze({ mediaId, language: "zh" });
    expect(analysis.source).toBe("heuristic");
    expect(analysis.tags.length).toBeGreaterThan(0);
    await expect(ownerCaller.ai.analyze({ mediaId })).resolves.toMatchObject({ source: "cache" });
    await expect(ownerCaller.ai.get({ mediaId })).resolves.toMatchObject({ mediaId });
    await expect(ownerCaller.ai.tagPerson({ mediaId, personId: "p1", userId: intruderId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rec = await ownerCaller.ai.recommend({ familyId });
    expect(rec.totalPhotos).toBe(1);
    expect(rec.unanalyzed).toBe(0);
    expect(rec.nextAnniversary).toMatchObject({ couple: expect.any(String) });
    await expect(ownerCaller.ai.peopleIndex({ familyId })).resolves.toMatchObject({ analyzed: 1, people: [] });
    await expect(guestCaller.ai.recommend({ familyId: 999999 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // P9: emailed codes — reset password, verify email, 2FA gate on login (console mail transport in CI)
    const resetReq = await anon.auth.requestPasswordReset({ email: pwEmail, language: "zh" });
    expect(resetReq).toMatchObject({ ok: true, delivered: false, mailConfigured: false });
    // no account → still ok, no enumeration
    await expect(anon.auth.requestPasswordReset({ email: `nobody-${Date.now()}@example.test` })).resolves.toMatchObject({ ok: true, delivered: false });
    const resetCode = __lastIssuedCodes.get(`${pwEmail}:password_reset`);
    expect(resetCode).toMatch(/^\d{6}$/);
    await expect(anon.auth.resetPassword({ email: pwEmail, code: "000000", newPassword: "new-pass-12345" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const resetRes = await anon.auth.resetPassword({ email: pwEmail, code: resetCode!, newPassword: "new-pass-12345" });
    expect(resetRes.sessionToken.split(".")).toHaveLength(3);
    // code is single-use
    await expect(anon.auth.resetPassword({ email: pwEmail, code: resetCode!, newPassword: "another-pass-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(anon.auth.login({ email: pwEmail, password: "hunter2hunter2" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.auth.login({ email: pwEmail, password: "new-pass-12345" })).resolves.toMatchObject({ requires2fa: false, user: { id: pwUserId } });

    // Reset-by-code also marks the email verified; 2FA can now be enabled for the pw user
    const [pwRow] = await database.select().from(users).where(eq(users.id, pwUserId)).limit(1);
    const pwCaller = appRouter.createCaller(createContext(pwRow!));
    await expect(pwCaller.auth.securityStatus()).resolves.toMatchObject({ emailVerified: true, hasPassword: true, twoFactorEnabled: false, mailConfigured: false });
    // Owner (OAuth, unverified) cannot enable 2FA until verified
    await expect(ownerCaller.auth.setTwoFactor({ enabled: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await ownerCaller.auth.requestEmailVerification({ language: "zh" });
    const verifyCode = __lastIssuedCodes.get(`${owner.email!.toLowerCase()}:verify_email`);
    await expect(ownerCaller.auth.verifyEmail({ code: "999999" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(ownerCaller.auth.verifyEmail({ code: verifyCode! })).resolves.toMatchObject({ verified: true });
    await expect(ownerCaller.auth.securityStatus()).resolves.toMatchObject({ emailVerified: true });

    // 2FA flow: enable on pw user → login returns challenge → complete2fa signs in
    await expect(pwCaller.auth.setTwoFactor({ enabled: true })).resolves.toEqual({ twoFactorEnabled: true });
    const challenge = await anon.auth.login({ email: pwEmail, password: "new-pass-12345" });
    expect(challenge.requires2fa).toBe(true);
    if (!challenge.requires2fa) throw new Error("unreachable");
    const twoFaCode = __lastIssuedCodes.get(`${pwEmail}:login_2fa`)!;
    await expect(anon.auth.complete2fa({ challengeId: challenge.challengeId, email: pwEmail, code: "123123" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.auth.complete2fa({ challengeId: challenge.challengeId, email: pwEmail, code: twoFaCode })).resolves.toMatchObject({ user: { id: pwUserId } });
    await pwCaller.auth.setTwoFactor({ enabled: false });
    await expect(anon.auth.login({ email: pwEmail, password: "new-pass-12345" })).resolves.toMatchObject({ requires2fa: false });

    // P9: backups — run now, list, status, download (inline since storage isn't configured in CI), delete
    const backup = await ownerCaller.backup.runNow({ language: "zh" });
    expect(backup.itemCount).toBe(1);
    expect(backup.bytes).toBeGreaterThan(100);
    expect(backup.storageKey.startsWith(`users/${userId}/backups/`)).toBe(true);
    await expect(ownerCaller.backup.list()).resolves.toHaveLength(1);
    await expect(ownerCaller.backup.status()).resolves.toMatchObject({ autoBackup: false, lastItemCount: 1, nextRunAt: null });
    const dl = await ownerCaller.backup.download({ id: backup.id });
    expect(dl.inline).toBeTruthy();
    expect(JSON.parse(dl.inline!).count).toBe(1);
    await expect(guestCaller.backup.download({ id: backup.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await ownerCaller.preferences.update({ autoBackup: true });
    await expect(ownerCaller.backup.status()).resolves.toMatchObject({ autoBackup: true, nextRunAt: expect.any(Date) });
    // fresh backup exists → not due; nobody else opted in
    await expect(findDueBackupUsers()).resolves.toEqual([]);
    await ownerCaller.preferences.update({ autoBackup: false });
    await expect(ownerCaller.backup.delete({ id: backup.id })).resolves.toEqual({ deleted: 1 });

    // P10: zip backup with media (storage not configured in CI → files skipped, manifest still lists them)
    const zipBackup = await ownerCaller.backup.runNow({ language: "zh", includeMedia: true });
    expect(zipBackup).toMatchObject({ format: "zip", itemCount: 1, mediaCount: 0, skippedCount: 1, remoteStatus: null });
    expect(zipBackup.storageKey.endsWith(".zip")).toBe(true);
    expect(zipBackup.bytes).toBeGreaterThan(22); // non-empty archive
    await expect(ownerCaller.backup.status()).resolves.toMatchObject({ lastFormat: "zip", includeMedia: false, target: null });
    await expect(ownerCaller.backup.delete({ id: zipBackup.id })).resolves.toEqual({ deleted: 1 });
    // WebDAV target: bad URL rejected before any network call; unreachable host surfaces PRECONDITION_FAILED
    await expect(ownerCaller.backup.setTarget({ kind: "webdav", url: "ftp://nope/", username: "u", password: "p" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerCaller.backup.testTarget()).rejects.toMatchObject({ code: "NOT_FOUND" });

    // P10: phone + SMS channel (console transport in CI)
    await expect(ownerCaller.auth.requestPhoneVerification({ phone: "13800138000", language: "zh" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const phoneReq = await ownerCaller.auth.requestPhoneVerification({ phone: "+86 138 0013 8000", language: "zh" });
    expect(phoneReq).toMatchObject({ channel: "sms", delivered: false, phoneMasked: expect.stringContaining("8000") });
    await expect(ownerCaller.auth.securityStatus()).resolves.toMatchObject({ phoneVerified: false, twoFactorChannel: "email", phoneMasked: expect.stringContaining("****") });
    await expect(ownerCaller.auth.setTwoFactorChannel({ channel: "sms" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const phoneCode = __lastIssuedCodes.get("+8613800138000:verify_phone")!;
    expect(phoneCode).toMatch(/^\d{6}$/);
    await expect(ownerCaller.auth.verifyPhone({ code: "000000" === phoneCode ? "000001" : "000000" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(ownerCaller.auth.verifyPhone({ code: phoneCode })).resolves.toMatchObject({ verified: true });
    await expect(ownerCaller.auth.setTwoFactorChannel({ channel: "sms" })).resolves.toEqual({ twoFactorChannel: "sms" });
    await expect(ownerCaller.auth.securityStatus()).resolves.toMatchObject({ phoneVerified: true, twoFactorChannel: "sms" });
    // Same number cannot be claimed by another account
    await expect(guestCaller.auth.requestPhoneVerification({ phone: "+8613800138000", language: "zh" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(ownerCaller.auth.removePhone()).resolves.toEqual({ removed: true });
    await expect(ownerCaller.auth.securityStatus()).resolves.toMatchObject({ phone: null, twoFactorChannel: "email" });

    // P10: push device registration (dry-run transport)
    process.env.PUSH_DRY_RUN = "1";
    await expect(ownerCaller.push.register({ token: "garbage", platform: "ios" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const tok = "ExponentPushToken[ci-test-token-0000000001]";
    await expect(ownerCaller.push.register({ token: tok, platform: "android", deviceName: "CI" })).resolves.toMatchObject({ registered: true });
    await expect(ownerCaller.push.register({ token: tok, platform: "android", deviceName: "CI" })).resolves.toMatchObject({ registered: true }); // idempotent
    const dev = await ownerCaller.push.devices();
    expect(dev.devices).toHaveLength(1);
    expect(dev.devices[0]).toMatchObject({ platform: "android", deviceName: "CI", tokenSuffix: "00001]" });
    await expect(ownerCaller.push.test()).resolves.toMatchObject({ sent: 1, failed: 0 });
    await ownerCaller.preferences.update({ pushEnabled: false });
    await expect(ownerCaller.push.test()).resolves.toMatchObject({ sent: 0, skipped: 1 });
    await ownerCaller.preferences.update({ pushEnabled: true });
    await expect(ownerCaller.push.unregister({ token: tok })).resolves.toEqual({ removed: 1 });
    await expect(ownerCaller.push.devices()).resolves.toMatchObject({ devices: [] });
    delete process.env.PUSH_DRY_RUN;

    // P11: passwordless SMS sign-in (phone must be verified) + restore from a json backup + target kinds
    await ownerCaller.auth.requestPhoneVerification({ phone: "+8613900139000", language: "zh" });
    await ownerCaller.auth.verifyPhone({ code: __lastIssuedCodes.get("+8613900139000:verify_phone")! });
    await expect(anon.auth.requestSmsLogin({ phone: "+8600000000000", language: "zh" })).resolves.toMatchObject({ ok: true, delivered: false, challengeId: null }); // unknown number, no enumeration
    const smsLogin = await anon.auth.requestSmsLogin({ phone: "+86 139 0013 9000", language: "zh" });
    expect(smsLogin.challengeId).toBeTruthy();
    const smsLoginCode = __lastIssuedCodes.get("+8613900139000:login_sms")!;
    await expect(anon.auth.completeSmsLogin({ challengeId: smsLogin.challengeId!, phone: "+8613900139000", code: smsLoginCode === "000000" ? "000001" : "000000" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.auth.completeSmsLogin({ challengeId: smsLogin.challengeId!, phone: "+8613900139000", code: smsLoginCode })).resolves.toMatchObject({ user: { id: userId } });
    await ownerCaller.auth.removePhone();

    const jsonBackup = await ownerCaller.backup.runNow({ language: "zh", includeMedia: false });
    const plan = await ownerCaller.backup.restorePlan({ familyId, backupId: jsonBackup.id });
    expect(plan).toMatchObject({ format: "json", totalItems: 1, alreadyRestored: 0 });
    expect(plan.albums[0]).toMatchObject({ exists: true });
    const restored = await ownerCaller.backup.restore({ familyId, backupId: jsonBackup.id });
    expect(restored).toMatchObject({ albumsCreated: 0, mediaCreated: 1 });
    // Idempotent: second run skips everything
    const plan2 = await ownerCaller.backup.restorePlan({ familyId, backupId: jsonBackup.id });
    expect(plan2.alreadyRestored).toBe(1);
    const restored2 = await ownerCaller.backup.restore({ familyId, backupId: jsonBackup.id });
    expect(restored2.mediaCreated).toBe(0);
    expect(restored2.skipped[0]).toMatchObject({ reason: "already_restored" });
    // Viewer cannot restore into the family
    await expect(guestCaller.backup.restorePlan({ familyId, backupId: jsonBackup.id })).rejects.toThrow();
    await ownerCaller.backup.delete({ id: jsonBackup.id });
    // Clean restored media so later counts stay stable
    await database.delete(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));
    // Target kinds: s3 bad endpoint rejected; gdrive needs server config
    await expect(ownerCaller.backup.setTarget({ kind: "s3", url: "ftp://x", username: "a", password: "b", config: { bucket: "bkt", region: "us-east-1" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerCaller.backup.gdriveAuthUrl({ redirectUri: "https://app.example/settings" })).resolves.toMatchObject({ configured: !!process.env.GOOGLE_CLIENT_ID });
    await expect(ownerCaller.backup.status()).resolves.toMatchObject({ targetKinds: ["webdav", "s3", "gdrive"] });

    // P12: quiet hours silence a push.test (system type still delivers → sent counts) and per-type mute
    process.env.PUSH_DRY_RUN = "1";
    await ownerCaller.push.register({ token: "ExponentPushToken[p12quiet0000000000000]", platform: "ios", deviceName: "CI" });
    const nowMin = (() => {
      const d = new Date();
      return d.getUTCHours() * 60 + d.getUTCMinutes();
    })();
    await ownerCaller.preferences.update({ quietStart: (nowMin + 1380) % 1440, quietEnd: (nowMin + 60) % 1440, quietTz: "UTC", pushMutedTypes: ["like"] });
    const prefsP12 = await ownerCaller.preferences.get();
    expect(prefsP12).toMatchObject({ quietTz: "UTC", pushMutedTypes: ["like"], pushMutedFamilies: [] });
    // system pushes bypass quiet hours by design
    await expect(ownerCaller.push.test()).resolves.toMatchObject({ sent: 1, skipped: 0 });
    await ownerCaller.preferences.update({ quietStart: null, quietEnd: null, pushMutedTypes: [], pushMutedFamilies: [familyId] });
    await expect(ownerCaller.preferences.get()).resolves.toMatchObject({ quietStart: null, pushMutedFamilies: [familyId] });
    await ownerCaller.preferences.update({ pushMutedFamilies: [] });
    await ownerCaller.push.unregister({ token: "ExponentPushToken[p12quiet0000000000000]" });
    delete process.env.PUSH_DRY_RUN;

    // P12: async + selective restore runs through the background queue
    const asyncBackup = await ownerCaller.backup.runNow({ language: "zh", includeMedia: false });
    const asyncPlan = await ownerCaller.backup.restorePlan({ familyId, backupId: asyncBackup.id, albums: ["__no_such_album__"] });
    expect(asyncPlan.totalItems).toBe(0);
    const { jobId } = await ownerCaller.backup.restoreAsync({ familyId, backupId: asyncBackup.id });
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    let job = await ownerCaller.backup.restoreJob({ jobId });
    for (let i = 0; i < 40 && job.status !== "completed" && job.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      job = await ownerCaller.backup.restoreJob({ jobId });
    }
    expect(job).toMatchObject({ status: "completed", progress: 100, source: `backup:${asyncBackup.id}` });
    expect(job.result?.mediaCreated).toBe(1);
    const jobsList = await ownerCaller.backup.restoreJobs();
    expect(jobsList.some((j) => j.id === jobId)).toBe(true);
    await expect(guestCaller.backup.restoreJob({ jobId })).rejects.toThrow();
    await expect(guestCaller.backup.restoreAsync({ familyId, backupId: asyncBackup.id })).rejects.toThrow();
    await ownerCaller.backup.delete({ id: asyncBackup.id });
    await database.delete(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));
    // No cloud target configured → empty history
    await expect(ownerCaller.backup.remoteList()).resolves.toEqual({ target: null, entries: [] });

    // P12: account merge — the other account's email must confirm with a code; its rows move over
    const mergeEmail = "ci-merge-src@example.test";
    await database.insert(users).values({ openId: "ci-merge-src-openid", name: "Merge Src", email: mergeEmail, loginMethod: "email", role: "user" });
    const [mergeSrc] = await database.select().from(users).where(eq(users.email, mergeEmail)).limit(1);
    const mergeSrcCaller = appRouter.createCaller(createContext(mergeSrc!));
    const srcFamily = (await mergeSrcCaller.family.createFamily({ name: "Src Family" }))!;
    await expect(ownerCaller.auth.requestMerge({ email: owner.email!, language: "zh" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerCaller.auth.requestMerge({ email: "nobody-ci@example.test", language: "zh" })).resolves.toMatchObject({ ok: true, delivered: false });
    await expect(ownerCaller.auth.requestMerge({ email: mergeEmail, language: "zh" })).resolves.toMatchObject({ ok: true, destination: mergeEmail });
    const mergeCode = __lastIssuedCodes.get(`${mergeEmail}:merge_account`)!;
    expect(mergeCode).toMatch(/^\d{6}$/);
    await expect(ownerCaller.auth.completeMerge({ email: mergeEmail, code: mergeCode === "000000" ? "000001" : "000000" })).rejects.toThrow();
    const mergeOutcome = await ownerCaller.auth.completeMerge({ email: mergeEmail, code: mergeCode });
    expect(mergeOutcome).toMatchObject({ merged: true });
    const ownerFamilies = await ownerCaller.family.getUserFamilies();
    expect(ownerFamilies.some((f) => f.id === srcFamily.id)).toBe(true);
    // P13: the source is soft-deleted during the undo window (row kept, identity parked, cannot sign in)
    const [softDeleted] = await database.select().from(users).where(eq(users.id, mergeSrc!.id)).limit(1);
    expect(softDeleted?.mergedIntoUserId).toBe(userId);
    expect(softDeleted?.email).not.toBe(mergeEmail);
    expect(mergeOutcome.undoDeadline).toBeTruthy();
    await expect(anon.auth.requestSmsLogin({ phone: "+8600000000001", language: "zh" })).resolves.toMatchObject({ challengeId: null });
    let mergeHist = await ownerCaller.auth.mergeHistory();
    expect(mergeHist.length).toBeGreaterThanOrEqual(1);
    expect(mergeHist[0]).toMatchObject({ sourceEmail: mergeEmail, canUndo: true });

    // P13: audit CSV (own rows only for non-admin)
    const csvOut = await ownerCaller.auth.mergeAuditCsv({ all: true });
    expect(csvOut.all).toBe(false);
    expect(csvOut.content.split("\r\n")[0]).toContain("sourceEmail");
    expect(csvOut.content).toContain(mergeEmail);

    // P13: undo → family membership goes back, source identity restored, history flips
    const undone = await ownerCaller.auth.undoMerge({ mergeId: mergeHist[0]!.id });
    expect(undone.undone).toBe(true);
    expect((await ownerCaller.family.getUserFamilies()).some((f) => f.id === srcFamily.id)).toBe(false);
    const [restoredSrc] = await database.select().from(users).where(eq(users.id, mergeSrc!.id)).limit(1);
    expect(restoredSrc).toMatchObject({ email: mergeEmail, mergedIntoUserId: null, openId: "ci-merge-src-openid" });
    await expect(database.select().from(familyMembers).where(and(eq(familyMembers.familyId, srcFamily.id), eq(familyMembers.userId, mergeSrc!.id)))).resolves.toHaveLength(1);
    mergeHist = await ownerCaller.auth.mergeHistory();
    expect(mergeHist[0]).toMatchObject({ canUndo: false });
    expect(mergeHist[0]!.undoneAt).toBeTruthy();
    await expect(ownerCaller.auth.undoMerge({ mergeId: mergeHist[0]!.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // clean the source family + user
    await database.delete(familyMembers).where(eq(familyMembers.familyId, srcFamily.id));
    await database.delete(families).where(eq(families.id, srcFamily.id));
    await database.delete(userPreferences).where(eq(userPreferences.userId, mergeSrc!.id));
    await database.delete(users).where(eq(users.id, mergeSrc!.id));

    // P13: digest preference parks interaction pushes instead of sending (system still goes out)
    process.env.PUSH_DRY_RUN = "1";
    await ownerCaller.push.register({ token: "ExponentPushToken[p13digest000000000000]", platform: "android", deviceName: "CI" });
    await ownerCaller.preferences.update({ pushDigest: "daily", pushDigestHour: 20 });
    await expect(ownerCaller.preferences.get()).resolves.toMatchObject({ pushDigest: "daily", pushDigestHour: 20 });
    const sysPush = await ownerCaller.push.test();
    expect(sysPush.sent).toBe(1);
    const { pushToUsers } = await import("../server/_core/push");
    const parked = await pushToUsers({ userIds: [userId], type: "like", actorName: "CI", data: { familyId } });
    expect(parked).toMatchObject({ sent: 0, digested: 1 });
    await expect(database.select().from(pushDigestQueue).where(eq(pushDigestQueue.userId, userId))).resolves.toHaveLength(1);
    await expect(ownerCaller.push.opened({ type: "like", variant: "B" })).resolves.toMatchObject({ recorded: true, variant: "B" });
    await expect(ownerCaller.push.experiment()).resolves.toMatchObject({ enabled: false, variant: "A" });
    await ownerCaller.preferences.update({ pushDigest: "off" });
    await database.delete(pushDigestQueue).where(eq(pushDigestQueue.userId, userId));
    await ownerCaller.push.unregister({ token: "ExponentPushToken[p13digest000000000000]" });
    delete process.env.PUSH_DRY_RUN;

    // P13: restore conflict strategy — copy creates "<name> (恢复副本)", skip imports nothing; plan carries the diff
    const stratBackup = await ownerCaller.backup.runNow({ language: "zh", includeMedia: false });
    const planMerge = await ownerCaller.backup.restorePlan({ familyId, backupId: stratBackup.id, options: { albumConflict: "merge" } });
    expect(planMerge.options).toEqual({ albumConflict: "merge", dedupeByHash: true });
    expect(planMerge.albums[0]).toMatchObject({ exists: true, action: "merge", existingItems: 1 });
    const planSkip = await ownerCaller.backup.restorePlan({ familyId, backupId: stratBackup.id, options: { albumConflict: "skip" } });
    expect(planSkip).toMatchObject({ willImport: 0, skippedByStrategy: 1 });
    expect(planSkip.albums[0]).toMatchObject({ action: "skip", targetName: null });
    const planCopy = await ownerCaller.backup.restorePlan({ familyId, backupId: stratBackup.id, options: { albumConflict: "copy" } });
    expect(planCopy.albums[0]).toMatchObject({ action: "copy", willImport: 1 });
    expect(planCopy.albums[0]!.targetName).toMatch(/恢复副本/);
    const copied = await ownerCaller.backup.restore({ familyId, backupId: stratBackup.id, options: { albumConflict: "copy", dedupeByHash: false } });
    expect(copied).toMatchObject({ albumsCreated: 1, mediaCreated: 1 });
    const skippedRun = await ownerCaller.backup.restore({ familyId, backupId: stratBackup.id, options: { albumConflict: "skip" } });
    expect(skippedRun.mediaCreated).toBe(0);
    expect(skippedRun.skipped[0]).toMatchObject({ reason: "album_skipped" });
    await ownerCaller.backup.delete({ id: stratBackup.id });
    await database.delete(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));
    await database.delete(albums).where(and(eq(albums.familyId, familyId), like(albums.name, "%恢复副本%")));

    // P13: multi-target status shape + per-id operations on a missing target
    const st = await ownerCaller.backup.status();
    expect(Array.isArray(st.targets)).toBe(true);
    expect(st.targets).toHaveLength(0);
    await expect(ownerCaller.backup.testTarget({ id: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.backup.updateTarget({ id: 999_999, enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.backup.remoteUploads({ backupId: 1 })).resolves.toEqual([]);

    // P13: alert rules / channels are admin-only; rule defaults come from env
    await expect(ownerCaller.ops.alertRules()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerCaller.ops.alertChannels()).rejects.toMatchObject({ code: "FORBIDDEN" });

    // P14: visual restore preview — per-item diff with skip reasons, per-item selection, run records what it created
    const p14Backup = await ownerCaller.backup.runNow({ language: "zh", includeMedia: false });
    const p14Preview = await ownerCaller.backup.restorePreview({ familyId, backupId: p14Backup.id });
    expect(p14Preview.total).toBeGreaterThanOrEqual(1);
    expect(p14Preview.items.length).toBe(p14Preview.total);
    expect(p14Preview.items[0]).toMatchObject({ hasFile: false, previewDataUrl: null });
    expect(p14Preview.items[0]!.skipReason).toBeNull(); // nothing restored yet → will import
    expect(["photo", "video"]).toContain(p14Preview.items[0]!.type);
    const pickedId = p14Preview.items[0]!.id;
    const partialPlan = await ownerCaller.backup.restorePlan({ familyId, backupId: p14Backup.id, items: [999_999_999] });
    expect(partialPlan.totalItems).toBe(0);
    const p14Run = await ownerCaller.backup.restore({ familyId, backupId: p14Backup.id, items: [pickedId], options: { dedupeByHash: false } });
    expect(p14Run.mediaCreated).toBe(1);
    expect(p14Run.created.mediaIds).toHaveLength(1);
    const previewAfter = await ownerCaller.backup.restorePreview({ familyId, backupId: p14Backup.id });
    const seen = previewAfter.items.find((i) => i.id === pickedId)!;
    expect(seen.skipReason).toBe("already_restored");
    expect(seen.existing?.id).toBe(p14Run.created.mediaIds[0]);
    await expect(guestCaller.backup.restorePreview({ familyId, backupId: p14Backup.id })).rejects.toThrow();
    await database.delete(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));

    // P14: async restore → undo rolls back exactly what that job created
    const { jobId: undoJobId } = await ownerCaller.backup.restoreAsync({ familyId, backupId: p14Backup.id, items: [pickedId], options: { dedupeByHash: false } });
    let undoJob = await ownerCaller.backup.restoreJob({ jobId: undoJobId });
    for (let i = 0; i < 40 && undoJob.status !== "completed" && undoJob.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      undoJob = await ownerCaller.backup.restoreJob({ jobId: undoJobId });
    }
    expect(undoJob).toMatchObject({ status: "completed", canUndo: true });
    expect(undoJob.result?.mediaCreated).toBe(1);
    const restoredRows = await database.select().from(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));
    expect(restoredRows).toHaveLength(1);
    await expect(guestCaller.backup.undoRestore({ jobId: undoJobId })).rejects.toThrow();
    const undoOut = await ownerCaller.backup.undoRestore({ jobId: undoJobId });
    expect(undoOut).toMatchObject({ mediaDeleted: 1, albumsDeleted: 0 });
    await expect(database.select().from(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")))).resolves.toHaveLength(0);
    undoJob = await ownerCaller.backup.restoreJob({ jobId: undoJobId });
    expect(undoJob.canUndo).toBe(false);
    expect(undoJob.undoneAt).toBeTruthy();
    await expect(ownerCaller.backup.undoRestore({ jobId: undoJobId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await ownerCaller.backup.delete({ id: p14Backup.id });
    await database.delete(restoreJobs).where(eq(restoreJobs.userId, userId));

    // P14: digest personalization preferences + per-target retention / quota on a missing target
    await ownerCaller.preferences.update({ pushDigestSmart: true, pushDigestPerFamily: true });
    await expect(ownerCaller.preferences.get()).resolves.toMatchObject({ pushDigestSmart: true, pushDigestPerFamily: true });
    await ownerCaller.preferences.update({ pushDigestSmart: false, pushDigestPerFamily: false });
    await expect(ownerCaller.backup.updateTarget({ id: 999_999, keepCount: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.backup.targetQuota({ id: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.backup.pruneTarget({ id: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const p14Status = await ownerCaller.backup.status();
    expect(p14Status.storageClasses).toContain("DEEP_ARCHIVE");
    // A/B: no promoted winner without traffic; incidents are admin-only
    await expect(ownerCaller.push.experiment()).resolves.toMatchObject({ enabled: false, winner: null });
    await expect(ownerCaller.ops.incidents()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerCaller.ops.ackIncident({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // P14: merge wizard — preview does not consume the code; conflicts default to the higher role; choices are honoured + recorded
    const merge2Email = "ci-merge-src2@example.test";
    await database.insert(users).values({ openId: "ci-merge-src2-openid", name: "Merge Src 2", email: merge2Email, loginMethod: "email", role: "user" });
    const [merge2Src] = await database.select().from(users).where(eq(users.email, merge2Email)).limit(1);
    const merge2Caller = appRouter.createCaller(createContext(merge2Src!));
    const src2Family = (await merge2Caller.family.createFamily({ name: "Src Family 2" }))!;
    // source is also an admin in the owner's family → conflict (owner stays owner by default)
    await database.insert(familyMembers).values({ familyId, userId: merge2Src!.id, role: "admin" });
    await expect(ownerCaller.auth.requestMerge({ email: merge2Email, language: "zh" })).resolves.toMatchObject({ ok: true });
    const merge2Code = __lastIssuedCodes.get(`${merge2Email}:merge_account`)!;
    const wizard = await ownerCaller.auth.previewMerge({ email: merge2Email, code: merge2Code });
    expect(wizard.source).toMatchObject({ id: merge2Src!.id, email: merge2Email });
    expect(wizard.familiesToJoin.map((f) => f.familyId)).toEqual([src2Family.id]);
    expect(wizard.conflicts).toHaveLength(1);
    expect(wizard.conflicts[0]).toMatchObject({ familyId, targetRole: "owner", sourceRole: "admin", defaultKeep: "target", resultingRole: "owner" });
    expect(wizard.counts.familyMembers).toBe(2);
    // preview twice → code still valid (peek, not consume)
    await expect(ownerCaller.auth.previewMerge({ email: merge2Email, code: merge2Code })).resolves.toMatchObject({ conflicts: expect.any(Array) });
    await expect(ownerCaller.auth.previewMerge({ email: merge2Email, code: merge2Code === "000000" ? "000001" : "000000" })).rejects.toThrow();
    const merge2Out = await ownerCaller.auth.completeMerge({ email: merge2Email, code: merge2Code, choices: { [String(familyId)]: "source" } });
    expect(merge2Out.merged).toBe(true);
    const [ownerMembership] = await database.select().from(familyMembers).where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId))).limit(1);
    expect(ownerMembership?.role).toBe("admin"); // explicit "source" choice applied
    const [merge2Row] = await database.select().from(accountMerges).where(eq(accountMerges.sourceUserId, merge2Src!.id)).limit(1);
    expect(JSON.parse(merge2Row!.choices ?? "{}")).toEqual({ [String(familyId)]: "source" });
    // undo puts the owner role back
    const undone2 = await ownerCaller.auth.undoMerge({ mergeId: merge2Row!.id });
    expect(undone2.undone).toBe(true);
    const [ownerMembershipBack] = await database.select().from(familyMembers).where(and(eq(familyMembers.familyId, familyId), eq(familyMembers.userId, userId))).limit(1);
    expect(ownerMembershipBack?.role).toBe("owner");
    await database.delete(familyMembers).where(eq(familyMembers.userId, merge2Src!.id));
    await database.delete(familyMembers).where(eq(familyMembers.familyId, src2Family.id));
    await database.delete(families).where(eq(families.id, src2Family.id));
    await database.delete(accountMerges).where(eq(accountMerges.sourceUserId, merge2Src!.id));
    await database.delete(userPreferences).where(eq(userPreferences.userId, merge2Src!.id));
    await database.delete(users).where(eq(users.id, merge2Src!.id));

    // P15: ownership audit — build a merge, read it back per row, filter by table, export CSV, undo flips status
    const merge3Email = "ci-merge-src3@example.test";
    await database.insert(users).values({ openId: "ci-merge-src3-openid", name: "Merge Src 3", email: merge3Email, loginMethod: "email", role: "user" });
    const [merge3Src] = await database.select().from(users).where(eq(users.email, merge3Email)).limit(1);
    const merge3Caller = appRouter.createCaller(createContext(merge3Src!));
    const src3Family = (await merge3Caller.family.createFamily({ name: "Src Family 3" }))!;
    const src3Album = await merge3Caller.album.create({ familyId: src3Family.id, name: "Src3 Album", category: "daily" });
    await expect(ownerCaller.auth.requestMerge({ email: merge3Email, language: "zh" })).resolves.toMatchObject({ ok: true });
    const merge3Code = __lastIssuedCodes.get(`${merge3Email}:merge_account`)!;
    await ownerCaller.auth.completeMerge({ email: merge3Email, code: merge3Code });
    const own = await ownerCaller.auth.mergeOwnership({ all: false });
    expect(own.all).toBe(false);
    expect(own.merges.some((m) => m.sourceEmail === merge3Email && m.status === "merged")).toBe(true);
    const albumRow = own.rows.find((r) => r.table === "albums" && r.rowId === src3Album!.id);
    expect(albumRow).toMatchObject({ fromUserId: merge3Src!.id, toUserId: userId, currentOwnerId: userId, status: "merged", label: "Src3 Album", familyId: src3Family.id });
    const famRow = own.rows.find((r) => r.table === "families" && r.rowId === src3Family.id);
    expect(famRow).toMatchObject({ label: "Src Family 3", currentOwnerId: userId });
    const onlyAlbums = await ownerCaller.auth.mergeOwnership({ all: false, table: "albums" });
    expect(onlyAlbums.rows.every((r) => r.table === "albums")).toBe(true);
    expect(onlyAlbums.tables.find((t) => t.table === "albums")!.count).toBeGreaterThanOrEqual(1);
    const ownCsv = await ownerCaller.auth.mergeOwnershipCsv({ all: false, table: "albums" });
    expect(ownCsv.content.split("\r\n")[0]).toBe("mergeId,mergedAt,status,table,column,rowId,fromUserId,toUserId,dropped,currentOwnerId,familyId,label");
    expect(ownCsv.content).toContain("Src3 Album");
    // non-admin asking for all → still scoped to own
    expect((await ownerCaller.auth.mergeOwnership({ all: true })).all).toBe(false);
    const [merge3Row] = await database.select().from(accountMerges).where(eq(accountMerges.sourceUserId, merge3Src!.id)).limit(1);
    await ownerCaller.auth.undoMerge({ mergeId: merge3Row!.id });
    const afterUndo = await ownerCaller.auth.mergeOwnership({ all: false, mergeId: merge3Row!.id });
    expect(afterUndo.rows.length).toBeGreaterThan(0);
    expect(afterUndo.rows.every((r) => r.status === "undone")).toBe(true);
    expect(afterUndo.rows.find((r) => r.table === "albums")?.currentOwnerId).toBe(merge3Src!.id);
    await database.delete(albums).where(eq(albums.familyId, src3Family.id));
    await database.delete(familyMembers).where(eq(familyMembers.familyId, src3Family.id));
    await database.delete(families).where(eq(families.id, src3Family.id));
    await database.delete(accountMerges).where(eq(accountMerges.sourceUserId, merge3Src!.id));
    await database.delete(userPreferences).where(eq(userPreferences.userId, merge3Src!.id));
    await database.delete(users).where(eq(users.id, merge3Src!.id));

    // P15: digest highlights preference · copy jobs guard rails · on-call / orphans are admin-only
    await ownerCaller.preferences.update({ pushDigestHighlights: false });
    await expect(ownerCaller.preferences.get()).resolves.toMatchObject({ pushDigestHighlights: false });
    await ownerCaller.preferences.update({ pushDigestHighlights: true });
    await expect(ownerCaller.backup.copyTarget({ fromTargetId: 1, toTargetId: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(ownerCaller.backup.copyTarget({ fromTargetId: 999_998, toTargetId: 999_999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.backup.copyJobs()).resolves.toEqual([]);
    await expect(ownerCaller.backup.copyJob({ jobId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerCaller.backup.cancelCopy({ jobId: "00000000-0000-4000-8000-000000000000" })).resolves.toEqual({ cancelled: false });
    await expect(ownerCaller.ops.onCall()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerCaller.ops.addShift({ userId, weekday: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerCaller.ops.orphanScans()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerCaller.ops.scanOrphans()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // undo restore result now carries object-storage counters (no storage configured → zeros, not unsupported)
    const p15Backup = await ownerCaller.backup.runNow({ language: "zh", includeMedia: false });
    const p15Run = await ownerCaller.backup.restore({ familyId, backupId: p15Backup.id, options: { dedupeByHash: false } });
    expect(p15Run.uploadedKeys).toEqual([]);
    const { jobId: p15JobId } = await ownerCaller.backup.restoreAsync({ familyId, backupId: p15Backup.id, options: { dedupeByHash: false } });
    let p15Job = await ownerCaller.backup.restoreJob({ jobId: p15JobId });
    for (let i = 0; i < 40 && p15Job.status !== "completed" && p15Job.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 250));
      p15Job = await ownerCaller.backup.restoreJob({ jobId: p15JobId });
    }
    expect(p15Job.status).toBe("completed");
    const p15Undo = await ownerCaller.backup.undoRestore({ jobId: p15JobId });
    expect(p15Undo).toMatchObject({ objectsDeleted: 0, objectsFailed: 0, objectsUnsupported: false });
    await ownerCaller.backup.delete({ id: p15Backup.id });
    await database.delete(media).where(and(eq(media.familyId, familyId), like(media.description, "%restoredFrom:%")));
    await database.delete(restoreJobs).where(eq(restoreJobs.userId, userId));
    await database.delete(targetCopyJobs).where(eq(targetCopyJobs.userId, userId));
    await database.delete(onCallShifts).where(eq(onCallShifts.createdBy, userId));
    await database.delete(onCallHandovers).where(eq(onCallHandovers.createdBy, userId));

    // P10: ops diagnostics are admin-only
    await expect(ownerCaller.ops.channels()).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Studio jobs are persisted rows: myJobs empty, job lookup NOT_FOUND, retry on unknown
    await expect(ownerCaller.studio.myJobs()).resolves.toEqual([]);
    await expect(ownerCaller.studio.retry({ jobId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Export
    const csv = await ownerCaller.profile.exportData({ format: "csv", includeLinks: false });
    expect(csv.count).toBe(1);
    expect(csv.content.split("\r\n")).toHaveLength(2);
    expect(csv.content).toContain("albumName");
    const json = await ownerCaller.profile.exportData({ format: "json", includeLinks: true });
    const parsed = JSON.parse(json.content) as { items: { downloadUrl?: string }[] };
    expect(parsed.items[0]?.downloadUrl).toBeTruthy();

    // Reset membership so the roles test below starts from a clean slate
    await guestCaller.family.removeMember({ familyId, userId: intruderId });
    await expect(ownerCaller.family.getMembers({ familyId })).resolves.toHaveLength(1);
    await ownerCaller.notification.markAllRead();
    await guestCaller.notification.markAllRead();
  });

  it("enforces family roles and delivers notifications", async () => {
    const database = await getDb();
    if (!database) throw new Error("Database connection unavailable");
    const [owner] = await database.select().from(users).where(eq(users.id, userId)).limit(1);
    const [guest] = await database.select().from(users).where(eq(users.id, intruderId)).limit(1);
    if (!owner || !guest) throw new Error("Test users unavailable");
    const ownerCaller = appRouter.createCaller(createContext(owner));
    const guestCaller = appRouter.createCaller(createContext(guest));

    // Owner invites guest as viewer -> guest receives an `invite` notification
    await ownerCaller.family.addMember({ familyId, userId: intruderId, role: "viewer" });
    await expect(guestCaller.notification.unreadCount()).resolves.toMatchObject({ total: 1 });
    const inviteFeed = await guestCaller.notification.list({});
    expect(inviteFeed.items[0]).toMatchObject({ type: "invite", actorId: userId, familyId });
    expect(inviteFeed.items[0]?.actor).toMatchObject({ id: userId });

    // Duplicate membership is rejected by UNIQUE(familyId,userId)
    await expect(
      ownerCaller.family.addMember({ familyId, userId: intruderId, role: "viewer" }),
    ).rejects.toThrow();

    // Viewer can read but not create
    await expect(guestCaller.album.get({ id: albumId })).resolves.toMatchObject({ id: albumId });
    await expect(
      guestCaller.album.create({ familyId, name: "Viewer album" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      guestCaller.family.updateMemberRole({ familyId, userId, role: "viewer" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Viewer likes owner's photo -> owner gets a `like` notification; liking twice doesn't duplicate
    await guestCaller.interaction.createLike({ mediaId });
    await guestCaller.interaction.createLike({ mediaId });
    const ownerUnread = await ownerCaller.notification.unreadCount();
    expect(ownerUnread.likes).toBe(1);
    const ownerFeed = await ownerCaller.notification.list({ type: "like" });
    expect(ownerFeed.items).toHaveLength(1);
    expect(ownerFeed.items[0]).toMatchObject({ mediaId, actorId: intruderId });

    // Promote to editor -> can comment -> owner gets `comment` with preview
    await ownerCaller.family.updateMemberRole({ familyId, userId: intruderId, role: "editor" });
    await guestCaller.interaction.createComment({ mediaId, content: "Lovely photo!" });
    const commentFeed = await ownerCaller.notification.list({ type: "comment" });
    expect(commentFeed.items[0]).toMatchObject({ preview: "Lovely photo!", actorId: intruderId });

    // Mark read / mark all read
    const firstId = commentFeed.items[0]!.id;
    await ownerCaller.notification.markRead({ ids: [firstId] });
    await expect(ownerCaller.notification.list({ unreadOnly: true })).resolves.toMatchObject({
      items: expect.not.arrayContaining([expect.objectContaining({ id: firstId })]),
    });
    await ownerCaller.notification.markAllRead();
    await expect(ownerCaller.notification.unreadCount()).resolves.toMatchObject({ total: 0 });

    // Owner cannot be demoted or removed; member can leave
    await expect(
      ownerCaller.family.updateMemberRole({ familyId, userId, role: "viewer" }),
    ).rejects.toThrow(/Owner/);
    await expect(
      guestCaller.family.removeMember({ familyId, userId }),
    ).rejects.toThrow(/Owner/);
    await guestCaller.family.removeMember({ familyId, userId: intruderId });
    await expect(ownerCaller.family.getMembers({ familyId })).resolves.toHaveLength(1);

    // Album delete cascades media/likes/comments
    await ownerCaller.album.delete({ id: albumId });
    await expect(ownerCaller.album.list({ familyId })).resolves.toHaveLength(0);
    const leftover = await database.select().from(media).where(eq(media.albumId, albumId));
    expect(leftover).toHaveLength(0);
    albumId = 0;
  });
});
