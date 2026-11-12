CREATE TABLE `backups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`bytes` int NOT NULL,
	`itemCount` int NOT NULL,
	`trigger` enum('scheduled','manual') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verificationCodes` (
	`id` varchar(36) NOT NULL,
	`userId` int,
	`email` varchar(320) NOT NULL,
	`purpose` enum('password_reset','verify_email','login_2fa') NOT NULL,
	`codeHash` varchar(255) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expiresAt` timestamp NOT NULL,
	`consumedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verificationCodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `studioJobs` ADD `workerId` varchar(128);--> statement-breakpoint
ALTER TABLE `studioJobs` ADD `startedAt` timestamp;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `twoFactorEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `emailVerifiedAt` timestamp;--> statement-breakpoint
CREATE INDEX `backups_user_created_idx` ON `backups` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `verification_email_purpose_idx` ON `verificationCodes` (`email`,`purpose`,`createdAt`);--> statement-breakpoint
CREATE INDEX `studio_jobs_status_created_idx` ON `studioJobs` (`status`,`createdAt`);