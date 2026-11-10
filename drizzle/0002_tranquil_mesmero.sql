CREATE TABLE `oauthAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('google','facebook') NOT NULL,
	`providerAccountId` varchar(255) NOT NULL,
	`accessToken` text NOT NULL,
	`idToken` text,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oauthAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`mediaId` int,
	`albumId` int,
	`platform` enum('wechat','facebook','instagram','whatsapp','link') NOT NULL,
	`caption` text,
	`shareUrl` text NOT NULL,
	`clicks` int NOT NULL DEFAULT 0,
	`shares` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `shares_id` PRIMARY KEY(`id`)
);
