CREATE TABLE `backupTargets` (
	`userId` int NOT NULL,
	`kind` enum('webdav') NOT NULL DEFAULT 'webdav',
	`url` varchar(512) NOT NULL,
	`username` varchar(255) NOT NULL,
	`secretEnc` text NOT NULL,
	`lastSuccessAt` timestamp,
	`lastError` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `backupTargets_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `pushTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` varchar(255) NOT NULL,
	`platform` enum('ios','android','web') NOT NULL,
	`deviceName` varchar(128),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`failedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pushTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `pushTokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `verificationCodes` MODIFY COLUMN `purpose` enum('password_reset','verify_email','login_2fa','verify_phone') NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `format` enum('json','zip') DEFAULT 'json' NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `mediaCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `skippedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backups` ADD `remoteStatus` varchar(16);--> statement-breakpoint
ALTER TABLE `backups` ADD `remoteError` varchar(500);--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `twoFactorChannel` enum('email','sms') DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `pushEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `userPreferences` ADD `backupIncludeMedia` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneVerifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `verificationCodes` ADD `channel` enum('email','sms') DEFAULT 'email' NOT NULL;--> statement-breakpoint
CREATE INDEX `push_tokens_user_idx` ON `pushTokens` (`userId`);