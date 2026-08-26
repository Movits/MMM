CREATE TABLE `audit_logs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(100) NOT NULL,
	`resource` varchar(100),
	`resourceId` varchar(64),
	`details` json,
	`ipAddress` varchar(45),
	`userAgent` text,
	`status` enum('success','failure','blocked') NOT NULL DEFAULT 'success',
	`riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'low',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`identifier` varchar(320) NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`success` boolean NOT NULL DEFAULT false,
	`blockedUntil` timestamp,
	`attemptCount` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `login_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`eventType` enum('failed_login','suspicious_ip','multiple_sessions','brute_force_attempt','unusual_location','account_locked','password_reset','mfa_failed','data_export','admin_access') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`ipAddress` varchar(45),
	`details` json,
	`resolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`resolvedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `security_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`message` text NOT NULL,
	`type` enum('info','warning','alert','critical') NOT NULL DEFAULT 'info',
	`isRead` boolean NOT NULL DEFAULT false,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(128) NOT NULL,
	`userId` int NOT NULL,
	`ipAddress` varchar(45),
	`userAgent` text,
	`deviceFingerprint` varchar(64),
	`isTrustedDevice` boolean DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`expiresAt` timestamp NOT NULL,
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sessions_sessionToken_unique` UNIQUE(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`deviceName` varchar(100),
	`deviceFingerprint` varchar(64) NOT NULL,
	`userAgent` text,
	`ipAddress` varchar(45),
	`isActive` boolean NOT NULL DEFAULT true,
	`lastUsedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trusted_devices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_vault` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`encryptedData` text,
	`dataHash` varchar(64),
	`profileCompleteness` int DEFAULT 0,
	`capitalSocialScore` int DEFAULT 0,
	`badges` json,
	`specialties` json,
	`country` varchar(2),
	`city` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_vault_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin','moderator','premium','ambassador') NOT NULL DEFAULT 'user',
	`isActive` boolean NOT NULL DEFAULT true,
	`isVerified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE INDEX `audit_userId_idx` ON `audit_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_createdAt_idx` ON `audit_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `attempts_identifier_idx` ON `login_attempts` (`identifier`);--> statement-breakpoint
CREATE INDEX `attempts_ip_idx` ON `login_attempts` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `security_userId_idx` ON `security_events` (`userId`);--> statement-breakpoint
CREATE INDEX `security_eventType_idx` ON `security_events` (`eventType`);--> statement-breakpoint
CREATE INDEX `notif_userId_idx` ON `security_notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `session_token_idx` ON `sessions` (`sessionToken`);--> statement-breakpoint
CREATE INDEX `device_userId_idx` ON `trusted_devices` (`userId`);--> statement-breakpoint
CREATE INDEX `vault_userId_idx` ON `user_vault` (`userId`);