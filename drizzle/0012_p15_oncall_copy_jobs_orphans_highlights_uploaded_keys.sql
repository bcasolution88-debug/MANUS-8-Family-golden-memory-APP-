CREATE TABLE `onCallHandovers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fromUserId` int,
	`toUserId` int,
	`tier` int NOT NULL DEFAULT 1,
	`reason` varchar(16) NOT NULL DEFAULT 'auto',
	`note` varchar(300),
	`openIncidents` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `onCallHandovers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onCallShifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` varchar(8) NOT NULL DEFAULT 'weekly',
	`weekday` int,
	`startHour` int NOT NULL DEFAULT 0,
	`endHour` int NOT NULL DEFAULT 24,
	`tz` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
	`startsAt` timestamp,
	`endsAt` timestamp,
	`order` int NOT NULL DEFAULT 0,
	`tier` int NOT NULL DEFAULT 1,
	`enabled` boolean NOT NULL DEFAULT true,
	`note` varchar(200),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onCallShifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storageOrphanScans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`familyId` int,
	`scanned` int NOT NULL DEFAULT 0,
	`orphans` int NOT NULL DEFAULT 0,
	`orphanBytes` bigint NOT NULL DEFAULT 0,
	`keys` mediumtext,
	`deletedCount` int NOT NULL DEFAULT 0,
	`deletedAt` timestamp,
	`error` varchar(500),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `storageOrphanScans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `targetCopyJobs` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`fromTargetId` int NOT NULL,
	`toTargetId` int NOT NULL,
	`keys` mediumtext,
	`storageClass` varchar(32),
	`status` enum('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`total` int NOT NULL DEFAULT 0,
	`done` int NOT NULL DEFAULT 0,
	`failed` int NOT NULL DEFAULT 0,
	`bytes` bigint NOT NULL DEFAULT 0,
	`results` mediumtext,
	`error` varchar(500),
	`workerId` varchar(128),
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `targetCopyJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `restoreJobs` ADD `uploadedKeys` mediumtext;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushDigestHighlights` boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `on_call_handovers_created_idx` ON `onCallHandovers` (`createdAt`);--> statement-breakpoint
CREATE INDEX `on_call_shifts_user_idx` ON `onCallShifts` (`userId`);--> statement-breakpoint
CREATE INDEX `on_call_shifts_enabled_idx` ON `onCallShifts` (`enabled`,`tier`);--> statement-breakpoint
CREATE INDEX `storage_orphan_scans_created_idx` ON `storageOrphanScans` (`createdAt`);--> statement-breakpoint
CREATE INDEX `target_copy_jobs_user_idx` ON `targetCopyJobs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `target_copy_jobs_status_idx` ON `targetCopyJobs` (`status`,`createdAt`);