CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`familyId` int,
	`type` enum('like','comment','reply','upload','invite','member_joined','anniversary','share','system') NOT NULL,
	`actorId` int,
	`mediaId` int,
	`albumId` int,
	`commentId` int,
	`preview` varchar(500),
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
-- Role unification: member -> editor, family creators -> owner.
-- Step 1: widen the enum so both old and new values are valid during the data fix.
ALTER TABLE `familyMembers` MODIFY COLUMN `role` enum('owner','admin','editor','viewer','member') NOT NULL DEFAULT 'editor';--> statement-breakpoint
UPDATE `familyMembers` SET `role` = 'editor' WHERE `role` = 'member';--> statement-breakpoint
UPDATE `familyMembers` fm INNER JOIN `families` f ON f.`id` = fm.`familyId` AND f.`createdBy` = fm.`userId` SET fm.`role` = 'owner';--> statement-breakpoint
-- Step 2: narrow to the final enum.
ALTER TABLE `familyMembers` MODIFY COLUMN `role` enum('owner','admin','editor','viewer') NOT NULL DEFAULT 'editor';--> statement-breakpoint
-- Dedupe before adding UNIQUE constraints (keep the earliest row).
DELETE fm1 FROM `familyMembers` fm1 INNER JOIN `familyMembers` fm2 ON fm1.`familyId` = fm2.`familyId` AND fm1.`userId` = fm2.`userId` AND fm1.`id` > fm2.`id`;--> statement-breakpoint
ALTER TABLE `familyMembers` ADD CONSTRAINT `familyMembers_family_user_uq` UNIQUE(`familyId`,`userId`);--> statement-breakpoint
DELETE l1 FROM `likes` l1 INNER JOIN `likes` l2 ON l1.`mediaId` = l2.`mediaId` AND l1.`userId` = l2.`userId` AND l1.`id` > l2.`id`;--> statement-breakpoint
ALTER TABLE `likes` ADD CONSTRAINT `likes_media_user_uq` UNIQUE(`mediaId`,`userId`);--> statement-breakpoint
-- Keep denormalised counters consistent with the deduped rows.
UPDATE `media` m SET m.`likeCount` = (SELECT COUNT(*) FROM `likes` l WHERE l.`mediaId` = m.`id`), m.`commentCount` = (SELECT COUNT(*) FROM `comments` c WHERE c.`mediaId` = m.`id`);--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`userId`,`readAt`);--> statement-breakpoint
CREATE INDEX `albums_family_created_idx` ON `albums` (`familyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `comments_media_created_idx` ON `comments` (`mediaId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `familyMembers_user_idx` ON `familyMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `media_album_created_idx` ON `media` (`albumId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `media_family_created_idx` ON `media` (`familyId`,`createdAt`);