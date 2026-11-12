CREATE TABLE `alertChannels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('webhook','slack','wecom','dingtalk') NOT NULL,
	`name` varchar(64) NOT NULL,
	`urlEnc` text NOT NULL,
	`secretEnc` text,
	`enabled` boolean NOT NULL DEFAULT true,
	`lastStatus` varchar(16),
	`lastError` varchar(300),
	`lastSentAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alertChannels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alertRules` (
	`kind` enum('push','backup','backup_remote','studio','restore','mail','sms','push_open','alert') NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`minRatePct` int NOT NULL,
	`minSamples` int NOT NULL,
	`windowHours` int NOT NULL,
	`silencedUntil` timestamp,
	`updatedBy` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alertRules_kind` PRIMARY KEY(`kind`)
);
--> statement-breakpoint
CREATE TABLE `backupRemoteUploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`backupId` int NOT NULL,
	`targetId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('queued','uploaded','failed') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`nextAttemptAt` timestamp,
	`lastError` varchar(500),
	`uploadedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `backupRemoteUploads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pushDigestQueue` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('like','comment','reply','upload','invite','member_joined','anniversary','share','system') NOT NULL,
	`actorName` varchar(128),
	`preview` varchar(500),
	`familyId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pushDigestQueue_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `metricEvents` MODIFY COLUMN `kind` enum('push','backup','backup_remote','studio','restore','mail','sms','push_open','alert') NOT NULL;--> statement-breakpoint
ALTER TABLE `accountMerges` ADD `ledger` mediumtext;--> statement-breakpoint
ALTER TABLE `accountMerges` ADD `undoDeadline` timestamp;--> statement-breakpoint
ALTER TABLE `accountMerges` ADD `undoneAt` timestamp;--> statement-breakpoint
ALTER TABLE `accountMerges` ADD `purgedAt` timestamp;--> statement-breakpoint
-- P13: backupTargets becomes multi-row per user; existing rows keep working (one target each) and get an id.
ALTER TABLE `backupTargets` DROP PRIMARY KEY, ADD `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY FIRST;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `label` varchar(64);--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `enabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `health` enum('unknown','ok','degraded','down') DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `lastCheckedAt` timestamp;--> statement-breakpoint
ALTER TABLE `media` ADD `contentHash` varchar(64);--> statement-breakpoint
ALTER TABLE `restoreJobs` ADD `targetId` int;--> statement-breakpoint
ALTER TABLE `restoreJobs` ADD `options` text;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushDigest` enum('off','daily','weekly') DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushDigestHour` int DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `lastDigestAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `mergedIntoUserId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `mergedAt` timestamp;--> statement-breakpoint
CREATE INDEX `remote_uploads_backup_idx` ON `backupRemoteUploads` (`backupId`);--> statement-breakpoint
CREATE INDEX `remote_uploads_retry_idx` ON `backupRemoteUploads` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `push_digest_user_idx` ON `pushDigestQueue` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `backup_targets_user_idx` ON `backupTargets` (`userId`);--> statement-breakpoint
CREATE INDEX `media_family_hash_idx` ON `media` (`familyId`,`contentHash`);