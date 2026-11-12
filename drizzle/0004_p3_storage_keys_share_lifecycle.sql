ALTER TABLE `media` ADD `storageKey` varchar(512);--> statement-breakpoint
ALTER TABLE `media` ADD `thumbnailKey` varchar(512);--> statement-breakpoint
ALTER TABLE `shares` ADD `revokedAt` timestamp;--> statement-breakpoint
CREATE INDEX `shares_user_created_idx` ON `shares` (`userId`,`createdAt`);