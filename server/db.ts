import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, 
  users,
  families,
  InsertFamily,
  familyMembers,
  InsertFamilyMember,
  albums,
  InsertAlbum,
  media,
  InsertMedia,
  likes,
  InsertLike,
  comments,
  InsertComment,
  loveStories,
  InsertLoveStory,
  anniversaries,
  InsertAnniversary,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod", "avatar", "relationship"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Family operations
export async function createFamily(data: InsertFamily) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(families).values(data);
  return result;
}

export async function getFamilyById(familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(families).where(eq(families.id, familyId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserFamilies(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db
    .select()
    .from(families)
    .innerJoin(familyMembers, eq(families.id, familyMembers.familyId))
    .where(eq(familyMembers.userId, userId));
  
  return result.map(r => r.families);
}

// Family member operations
export async function addFamilyMember(data: InsertFamilyMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.insert(familyMembers).values(data);
}

export async function getFamilyMembers(familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db
    .select()
    .from(familyMembers)
    .innerJoin(users, eq(familyMembers.userId, users.id))
    .where(eq(familyMembers.familyId, familyId));
  
  return result.map(r => ({ ...r.familyMembers, user: r.users }));
}

// Album operations
export async function createAlbum(data: InsertAlbum) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.insert(albums).values(data);
}

export async function getAlbumsByFamily(familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(albums).where(eq(albums.familyId, familyId)).orderBy(desc(albums.createdAt));
}

export async function getAlbumById(albumId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(albums).where(eq(albums.id, albumId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Media operations
export async function uploadMedia(data: InsertMedia) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.insert(media).values(data);
}

export async function getMediaByAlbum(albumId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(media).where(eq(media.albumId, albumId)).orderBy(desc(media.createdAt));
}

export async function getMediaById(mediaId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Like operations
export async function addLike(data: InsertLike) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(likes).values(data);
  
  // Update like count
  const mediaItem = await getMediaById(data.mediaId);
  if (mediaItem) {
    await db.update(media).set({ likeCount: (mediaItem.likeCount || 0) + 1 }).where(eq(media.id, data.mediaId));
  }
}

export async function removeLike(mediaId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(likes).where(and(eq(likes.mediaId, mediaId), eq(likes.userId, userId)));
  
  // Update like count
  const mediaItem = await getMediaById(mediaId);
  if (mediaItem) {
    await db.update(media).set({ likeCount: Math.max(0, (mediaItem.likeCount || 0) - 1) }).where(eq(media.id, mediaId));
  }
}

export async function getLikesByMedia(mediaId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(likes).where(eq(likes.mediaId, mediaId));
}

// Comment operations
export async function addComment(data: InsertComment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(comments).values(data);
  
  // Update comment count
  const mediaItem = await getMediaById(data.mediaId);
  if (mediaItem) {
    await db.update(media).set({ commentCount: (mediaItem.commentCount || 0) + 1 }).where(eq(media.id, data.mediaId));
  }
}

export async function getCommentsByMedia(mediaId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db
    .select()
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.mediaId, mediaId))
    .orderBy(desc(comments.createdAt));
  
  return result.map(r => ({ ...r.comments, user: r.users }));
}

export async function deleteComment(commentId: number, mediaId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(comments).where(eq(comments.id, commentId));
  
  // Update comment count
  const mediaItem = await getMediaById(mediaId);
  if (mediaItem) {
    await db.update(media).set({ commentCount: Math.max(0, (mediaItem.commentCount || 0) - 1) }).where(eq(media.id, mediaId));
  }
}

// Love Story operations
export async function createLoveStory(data: InsertLoveStory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.insert(loveStories).values(data);
}

export async function getLoveStoriesByFamily(familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(loveStories).where(eq(loveStories.familyId, familyId)).orderBy(desc(loveStories.chapter));
}

// Anniversary operations
export async function createAnniversary(data: InsertAnniversary) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.insert(anniversaries).values(data);
}

export async function getAnniversariesByFamily(familyId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db.select().from(anniversaries).where(eq(anniversaries.familyId, familyId)).orderBy(desc(anniversaries.date));
}
