import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "../server/routers";
import { getDb } from "../server/db";
import {
  albums,
  anniversaries,
  comments,
  families,
  familyMembers,
  likes,
  loveStories,
  media,
  oauthAccounts,
  shares,
  users,
} from "../drizzle/schema";
import type { TrpcContext } from "../server/_core/context";

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
let familyId = 0;
let albumId = 0;
let mediaId = 0;
let commentId = 0;
let detailAlbumId = 0;
let shareId = "";

function createContext(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      hostname: "localhost",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

describeIntegration("API and database integration", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
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
    await database
      .delete(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));
    if (familyId) {
      await database.delete(comments).where(eq(comments.mediaId, mediaId));
      await database.delete(likes).where(eq(likes.mediaId, mediaId));
      await database.delete(media).where(eq(media.familyId, familyId));
    }
    if (albumId) await database.delete(albums).where(eq(albums.id, albumId));
    if (detailAlbumId)
      await database.delete(albums).where(eq(albums.id, detailAlbumId));
    if (familyId) {
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
    familyId = Number(familyResult[0].insertId);
    expect(familyId).toBeGreaterThan(0);
    await expect(caller.family.getFamily({ familyId })).resolves.toMatchObject({
      id: familyId,
    });
    await expect(caller.family.getUserFamilies()).resolves.toHaveLength(1);
    await expect(caller.family.getMembers({ familyId })).resolves.toHaveLength(
      1,
    );

    const albumResult = await caller.album.createAlbum({
      familyId,
      name: "CI Album",
      description: "Album route test",
      category: "integration",
    });
    albumId = Number(albumResult[0].insertId);
    await expect(caller.album.listAlbums({ familyId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: albumId })]),
    );
    await expect(caller.album.getAlbum({ albumId })).resolves.toMatchObject({
      id: albumId,
    });

    const mediaResult = await caller.album.uploadMedia({
      albumId,
      familyId,
      type: "photo",
      url: "https://example.test/ci-photo.jpg",
      title: "CI photo",
      fileSize: 128,
    });
    mediaId = Number(mediaResult[0].insertId);
    await expect(caller.album.getMediaByAlbum({ albumId })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: mediaId, type: "photo" }),
      ]),
    );

    await caller.album.addLike({ mediaId });
    await expect(caller.album.getLikes({ mediaId })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ mediaId, userId })]),
    );
    await caller.album.removeLike({ mediaId });
    await expect(caller.album.getLikes({ mediaId })).resolves.toHaveLength(0);

    const commentResult = await caller.album.addComment({
      mediaId,
      content: "Great memory",
      rating: 5,
    });
    expect(commentResult).toBeUndefined();
    const commentsAfterCreate = await caller.album.getComments({ mediaId });
    expect(commentsAfterCreate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "Great memory" }),
      ]),
    );
    commentId = commentsAfterCreate[0]?.id ?? 0;
    await caller.album.deleteComment({ commentId, mediaId });
    await expect(caller.album.getComments({ mediaId })).resolves.toHaveLength(
      0,
    );

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

    const detailAlbum = await caller.albumDetail.createAlbum({
      familyId,
      title: "Detailed CI Album",
      type: "memory",
    });
    detailAlbumId = detailAlbum.id;
    await expect(
      caller.albumDetail.getAlbum({ id: detailAlbumId }),
    ).resolves.toMatchObject({ id: detailAlbumId });
    await expect(
      caller.albumDetail.getAlbumStats({ id: detailAlbumId }),
    ).resolves.toMatchObject({ mediaCount: 0 });

    const upload = await caller.media.initUpload({
      fileName: "ci-second-photo.jpg",
      fileSize: 64,
      fileType: "image",
      albumId,
    });
    await expect(
      caller.media.completeUpload({
        uploadId: upload.uploadId,
        fileName: "ci-second-photo.jpg",
        fileSize: 64,
        fileType: "image",
        albumId,
        familyId,
      }),
    ).resolves.toMatchObject({ type: "photo", albumId });
    await expect(caller.media.getMediaList({ albumId })).resolves.toEqual(
      expect.any(Array),
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
    ).resolves.toMatchObject({ clicks: 1 });
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
      intruderCaller.album.getAlbum({ albumId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      intruderCaller.album.getMediaByAlbum({ albumId }),
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
});
