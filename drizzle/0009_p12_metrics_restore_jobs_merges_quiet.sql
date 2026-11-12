CREATE TABLE `accountMerges` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetUserId` int NOT NULL,
	`sourceUserId` int NOT NULL,
	`sourceEmail` varchar(320),
	`sourcePhone` varchar(32),
	`moved` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `accountMerges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `metricEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('push','backup','backup_remote','studio','restore','mail','sms') NOT NULL,
	`ok` boolean NOT NULL,
	`durationMs` int,
	`detail` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `metricEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restoreJobs` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`familyId` int NOT NULL,
	`backupId` int,
	`importKey` varchar(512),
	`remoteKey` varchar(512),
	`albums` text,
	`status` enum('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`stage` varchar(32) NOT NULL DEFAULT 'queued',
	`result` text,
	`error` varchar(500),
	`workerId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restoreJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `verificationCodes` MODIFY COLUMN `purpose` enum('password_reset','verify_email','login_2fa','verify_phone','login_sms','merge_account') NOT NULL;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `quietStart` int;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `quietEnd` int;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `quietTz` varchar(64);--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushMutedTypes` text;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushMutedFamilies` text;--> statement-breakpoint
CREATE INDEX `metric_events_kind_created_idx` ON `metricEvents` (`kind`,`createdAt`);--> statement-breakpoint
CREATE INDEX `restore_jobs_user_created_idx` ON `restoreJobs` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `restore_jobs_status_idx` ON `restoreJobs` (`status`,`createdAt`);