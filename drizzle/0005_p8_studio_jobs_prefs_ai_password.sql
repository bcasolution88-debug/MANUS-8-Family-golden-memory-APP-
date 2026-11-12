CREATE TABLE `mediaAnalysis` (
	`mediaId` int NOT NULL,
	`familyId` int NOT NULL,
	`caption` varchar(500),
	`suggestedTitle` varchar(255),
	`mood` varchar(64),
	`tags` text NOT NULL,
	`people` text NOT NULL,
	`model` varchar(128),
	`analyzedBy` int NOT NULL,
	`analyzedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mediaAnalysis_mediaId` PRIMARY KEY(`mediaId`)
);
--> statement-breakpoint
CREATE TABLE `studioJobs` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`familyId` int NOT NULL,
	`albumId` int NOT NULL,
	`status` enum('queued','rendering','uploading','completed','failed') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`stage` varchar(32) NOT NULL DEFAULT 'queued',
	`input` text NOT NULL,
	`mediaId` int,
	`error` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studioJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userPreferences` (
	`userId` int NOT NULL,
	`notifyEnabled` boolean NOT NULL DEFAULT true,
	`notifyComments` boolean NOT NULL DEFAULT true,
	`notifyLikes` boolean NOT NULL DEFAULT true,
	`notifyShares` boolean NOT NULL DEFAULT true,
	`notifyUploads` boolean NOT NULL DEFAULT true,
	`notifyAnniversaries` boolean NOT NULL DEFAULT true,
	`hideActivity` boolean NOT NULL DEFAULT false,
	`defaultPrivateAlbums` boolean NOT NULL DEFAULT false,
	`autoBackup` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `userPreferences_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
CREATE INDEX `media_analysis_family_idx` ON `mediaAnalysis` (`familyId`);--> statement-breakpoint
CREATE INDEX `studio_jobs_user_created_idx` ON `studioJobs` (`userId`,`createdAt`);