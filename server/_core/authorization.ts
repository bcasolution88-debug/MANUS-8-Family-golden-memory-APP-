import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { albums, familyMembers, media, shares } from "../../drizzle/schema";
import { getDb } from "../db";

async function requireDb() {
  const database = await getDb();
  if (!database)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return database;
}

export async function requireFamilyMember(userId: number, familyId: number) {
  const database = await requireDb();
  const rows = await database
    .select({ id: familyMembers.id, role: familyMembers.role })
    .from(familyMembers)
    .where(
      and(
        eq(familyMembers.familyId, familyId),
        eq(familyMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!rows[0]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this family",
    });
  }
  return rows[0];
}

export async function requireFamilyAdmin(userId: number, familyId: number) {
  const member = await requireFamilyMember(userId, familyId);
  if (member.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Family administrator permission required",
    });
  }
  return member;
}

export async function requireAlbumAccess(userId: number, albumId: number) {
  const database = await requireDb();
  const rows = await database
    .select({ album: albums })
    .from(albums)
    .innerJoin(
      familyMembers,
      and(
        eq(familyMembers.familyId, albums.familyId),
        eq(familyMembers.userId, userId),
      ),
    )
    .where(eq(albums.id, albumId))
    .limit(1);

  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Album access denied" });
  }
  return rows[0].album;
}

export async function requireMediaAccess(userId: number, mediaId: number) {
  const database = await requireDb();
  const rows = await database
    .select({ media: media })
    .from(media)
    .innerJoin(
      familyMembers,
      and(
        eq(familyMembers.familyId, media.familyId),
        eq(familyMembers.userId, userId),
      ),
    )
    .where(eq(media.id, mediaId))
    .limit(1);

  if (!rows[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Media access denied" });
  }
  return rows[0].media;
}

export async function requireShareAccess(userId: number, shareId: string) {
  const database = await requireDb();
  const rows = await database
    .select()
    .from(shares)
    .where(eq(shares.id, shareId))
    .limit(1);
  const share = rows[0];
  if (!share)
    throw new TRPCError({ code: "NOT_FOUND", message: "Share not found" });

  if (share.userId === userId) return share;
  if (share.mediaId) {
    await requireMediaAccess(userId, share.mediaId);
    return share;
  }
  if (share.albumId) {
    await requireAlbumAccess(userId, share.albumId);
    return share;
  }
  throw new TRPCError({ code: "FORBIDDEN", message: "Share access denied" });
}

export async function requireMediaBelongsToAlbum(
  userId: number,
  mediaId: number,
  albumId: number,
) {
  const item = await requireMediaAccess(userId, mediaId);
  if (item.albumId !== albumId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Media does not belong to this album",
    });
  }
  return item;
}
