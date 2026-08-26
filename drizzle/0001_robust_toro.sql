CREATE TABLE `ai_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`profileSummary` text,
	`strengthKeywords` json,
	`opportunityKeywords` json,
	`compatibilityVector` json,
	`modelUsed` varchar(100),
	`tokensUsed` int,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	CONSTRAINT `ai_analyses_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_analyses_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requesterId` int NOT NULL,
	`recipientId` int NOT NULL,
	`matchId` int,
	`status` enum('pending','accepted','rejected','blocked') NOT NULL DEFAULT 'pending',
	`message` text,
	`requesterNote` text,
	`respondedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`matchedUserId` int,
	`matchedOpportunityId` int,
	`overallScore` float NOT NULL,
	`specialtyScore` float DEFAULT 0,
	`objectivesScore` float DEFAULT 0,
	`incomeScore` float DEFAULT 0,
	`locationScore` float DEFAULT 0,
	`valuesScore` float DEFAULT 0,
	`aiInsight` text,
	`aiGeneratedAt` timestamp,
	`userSeen` boolean DEFAULT false,
	`userDismissed` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`connectionId` int NOT NULL,
	`senderId` int NOT NULL,
	`encryptedContent` text NOT NULL,
	`contentHash` varchar(64),
	`isRead` boolean DEFAULT false,
	`readAt` timestamp,
	`deletedBySender` boolean DEFAULT false,
	`deletedByRecipient` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creatorId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`type` enum('investment','partnership','mentorship','job','project','client','supplier','acquisition') NOT NULL,
	`sector` varchar(100),
	`requiredSpecialties` json,
	`location` varchar(200),
	`isRemote` boolean DEFAULT false,
	`budgetRange` enum('negotiable','under_10k','10k_50k','50k_200k','200k_1m','1m_plus'),
	`status` enum('active','paused','closed','filled') NOT NULL DEFAULT 'active',
	`expiresAt` timestamp,
	`viewCount` int DEFAULT 0,
	`interestCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `opportunities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('new_match','connection_request','connection_accepted','new_message','opportunity_match','profile_view','system') NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` text,
	`actionUrl` varchar(500),
	`relatedUserId` int,
	`relatedOpportunityId` int,
	`isRead` boolean DEFAULT false,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(100),
	`age` tinyint,
	`city` varchar(100),
	`country` varchar(2),
	`avatarUrl` text,
	`bio` text,
	`primarySpecialty` varchar(100),
	`secondarySpecialties` json,
	`experienceYears` tinyint,
	`educationLevel` enum('high_school','bachelor','master','phd','other'),
	`currentRole` varchar(100),
	`currentCompany` varchar(100),
	`sector` varchar(100),
	`seekingTypes` json,
	`businessInterests` json,
	`preferredCompanySize` enum('startup','small','medium','large','any') DEFAULT 'any',
	`openToRemote` boolean DEFAULT true,
	`availableForTravel` boolean DEFAULT false,
	`incomeRange` enum('under_3k','3k_7k','7k_15k','15k_30k','30k_plus'),
	`investmentCapacity` enum('none','under_10k','10k_50k','50k_200k','200k_plus'),
	`lookingForInvestment` boolean DEFAULT false,
	`investmentAmountSeeking` enum('none','under_50k','50k_200k','200k_1m','1m_plus'),
	`workStyle` enum('remote','hybrid','onsite','flexible') DEFAULT 'flexible',
	`languages` json,
	`values` json,
	`encryptedSensitiveData` text,
	`profileCompleteness` int DEFAULT 0,
	`lastAiAnalysisAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_profiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingCompleted` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_userId_idx` ON `ai_analyses` (`userId`);--> statement-breakpoint
CREATE INDEX `conn_requester_idx` ON `connections` (`requesterId`);--> statement-breakpoint
CREATE INDEX `conn_recipient_idx` ON `connections` (`recipientId`);--> statement-breakpoint
CREATE INDEX `conn_status_idx` ON `connections` (`status`);--> statement-breakpoint
CREATE INDEX `match_userId_idx` ON `matches` (`userId`);--> statement-breakpoint
CREATE INDEX `match_matchedUser_idx` ON `matches` (`matchedUserId`);--> statement-breakpoint
CREATE INDEX `match_score_idx` ON `matches` (`overallScore`);--> statement-breakpoint
CREATE INDEX `msg_connection_idx` ON `messages` (`connectionId`);--> statement-breakpoint
CREATE INDEX `msg_sender_idx` ON `messages` (`senderId`);--> statement-breakpoint
CREATE INDEX `msg_createdAt_idx` ON `messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `opp_creator_idx` ON `opportunities` (`creatorId`);--> statement-breakpoint
CREATE INDEX `opp_type_idx` ON `opportunities` (`type`);--> statement-breakpoint
CREATE INDEX `opp_status_idx` ON `opportunities` (`status`);--> statement-breakpoint
CREATE INDEX `opp_sector_idx` ON `opportunities` (`sector`);--> statement-breakpoint
CREATE INDEX `pnotif_userId_idx` ON `platform_notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `pnotif_type_idx` ON `platform_notifications` (`type`);--> statement-breakpoint
CREATE INDEX `profile_userId_idx` ON `user_profiles` (`userId`);--> statement-breakpoint
CREATE INDEX `profile_specialty_idx` ON `user_profiles` (`primarySpecialty`);--> statement-breakpoint
CREATE INDEX `profile_country_idx` ON `user_profiles` (`country`);--> statement-breakpoint
CREATE INDEX `profile_sector_idx` ON `user_profiles` (`sector`);