ALTER TABLE `backupTargets` MODIFY COLUMN `kind` enum('webdav','s3','gdrive') NOT NULL DEFAULT 'webdav';--> statement-breakpoint
ALTER TABLE `verificationCodes` MODIFY COLUMN `purpose` enum('password_reset','verify_email','login_2fa','verify_phone','login_sms') NOT NULL;--> statement-breakpoint
ALTER TABLE `backupTargets` ADD `config` text;