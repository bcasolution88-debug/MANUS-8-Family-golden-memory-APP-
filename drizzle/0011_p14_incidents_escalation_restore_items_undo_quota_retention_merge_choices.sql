CREATE TABLE `alertIncidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('push','backup','backup_remote','studio','restore','mail','sms','push_open','alert') NOT NULL,
	`status` enum('open','acked','resolved') NOT NULL DEFAULT 'open',
	`tier` int NOT NULL DEFAULT 1,
	`ratePct` int,
	`samples` int,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`lastNotifiedAt` timestamp,
	`ackedAt` timestamp,
	`ackedBy` int,
	`ackNote` varchar(300),
	`resolvedAt` timestamp,
	`timeline` mediumtext NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alertIncidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `copyExperimentStats` (
	`experiment` varchar(64) NOT NULL,
	`sentA` int NOT NULL DEFAULT 0,
	`sentB` int NOT NULL DEFAULT 0,
	`openA` int NOT NULL DEFAULT 0,
	`openB` int NOT NULL DEFAULT 0,
	`winner` varchar(1),
	`decidedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `copyExperimentStats_experiment` PRIMARY KEY(`experiment`)
);
--> statement-breakpoint
ALTER TABLE `accountMerges` ADD `choices` text;--> statement-breakpoint
ALTER TABLE `alertChannels` ADD `tier` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `keepCount` int;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `storageClass` varchar(32);--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `usedBytes` bigint;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `quotaBytes` bigint;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `quotaCheckedAt` timestamp;--> statement-breakpoint
ALTER TABLE `metricEvents` ADD `userId` int;--> statement-breakpoint
ALTER TABLE `restoreJobs` ADD `items` text;--> statement-breakpoint
ALTER TABLE `restoreJobs` ADD `created` mediumtext;--> statement-breakpoint
ALTER TABLE `restoreJobs` ADD `undoneAt` timestamp;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushDigestSmart` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushDigestPerFamily` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `alert_incidents_status_idx` ON `alertIncidents` (`status`,`openedAt`);--> statement-breakpoint
CREATE INDEX `alert_incidents_kind_idx` ON `alertIncidents` (`kind`,`openedAt`);--> statement-breakpoint
CREATE INDEX `metric_events_user_kind_idx` ON `metricEvents` (`userId`,`kind`);