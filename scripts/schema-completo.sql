CREATE TABLE `ai_match_suggestions` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_a_id` bigint NOT NULL,
	`contact_b_id` bigint NOT NULL,
	`pair_low_contact_id` bigint NOT NULL,
	`pair_high_contact_id` bigint NOT NULL,
	`match_score` int NOT NULL,
	`match_type` enum('exact','category','semantic') NOT NULL,
	`matched_assets` json NOT NULL,
	`matched_needs` json NOT NULL,
	`reason_text` text NOT NULL,
	`status` enum('pending','viewed','accepted','dismissed') NOT NULL DEFAULT 'pending',
	`notified_at` bigint,
	`viewed_at` bigint,
	`accepted_at` bigint,
	`dismissed_at` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `ai_match_suggestions_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_match_owner_pair_unique_idx` UNIQUE(`owner_id`,`pair_low_contact_id`,`pair_high_contact_id`)
);
--> statement-breakpoint
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
CREATE TABLE `connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`requesterId` int NOT NULL,
	`recipientId` int NOT NULL,
	`status` enum('pending','accepted','declined','blocked') NOT NULL DEFAULT 'pending',
	`message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contact_assets` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_id` bigint NOT NULL,
	`tag_slug` varchar(160) NOT NULL,
	`tag_label` varchar(200) NOT NULL,
	`category` varchar(120),
	`description` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `contact_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contact_contexts` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_id` bigint NOT NULL,
	`context_id` varchar(36) NOT NULL,
	`event_date` varchar(20),
	`city` varchar(100),
	`country` varchar(100),
	`notes` varchar(1000),
	`relationship_type` varchar(20) NOT NULL DEFAULT 'profissional',
	`visibility` varchar(10) NOT NULL DEFAULT 'private',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `contact_contexts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contact_needs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_id` bigint NOT NULL,
	`tag_slug` varchar(160) NOT NULL,
	`tag_label` varchar(200) NOT NULL,
	`category` varchar(120),
	`description` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `contact_needs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `context_media` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`context_id` varchar(36) NOT NULL,
	`storage_path` varchar(512) NOT NULL,
	`file_type` varchar(50) NOT NULL,
	`file_size` bigint NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`caption` varchar(255),
	`thumbnail_path` varchar(512),
	`sort_order` int NOT NULL DEFAULT 0,
	`uploaded_by` varchar(128) NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `context_media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `context_participants` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`context_id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`company` varchar(200),
	`role` varchar(200),
	`notes` varchar(500),
	`converted_contact_id` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `context_participants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `context_types` (
	`id` varchar(36) NOT NULL,
	`name` varchar(80) NOT NULL,
	`slug` varchar(80) NOT NULL,
	`icon_name` varchar(50),
	`color_token` varchar(30),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `context_types_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contexts` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128),
	`context_type_id` varchar(36),
	`name` varchar(100) NOT NULL,
	`description` text,
	`event_date` varchar(20),
	`city` varchar(100),
	`country` varchar(100),
	`notes` text,
	`is_custom` boolean NOT NULL DEFAULT false,
	`visibility` varchar(10) NOT NULL DEFAULT 'private',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `contexts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_room_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dealRoomId` int NOT NULL,
	`uploadedBy` int NOT NULL,
	`name` varchar(300) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`url` text NOT NULL,
	`mimeType` varchar(100),
	`sizeBytes` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_room_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_room_messages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`dealRoomId` int NOT NULL,
	`senderId` int NOT NULL,
	`content` text NOT NULL,
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deal_room_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deal_rooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opportunityId` int NOT NULL,
	`ownerId` int NOT NULL,
	`interestedId` int NOT NULL,
	`status` enum('awaiting_nda','active','closed') NOT NULL DEFAULT 'awaiting_nda',
	`ndaAcceptedByOwner` boolean NOT NULL DEFAULT false,
	`ndaAcceptedByOwnerAt` timestamp,
	`ndaAcceptedByInterested` boolean NOT NULL DEFAULT false,
	`ndaAcceptedByInterestedAt` timestamp,
	`interestMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deal_rooms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `direct_messages` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`senderId` int NOT NULL,
	`recipientId` int,
	`groupId` int,
	`encryptedContent` text NOT NULL,
	`isRead` boolean DEFAULT false,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `direct_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `enrichment_messages` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`role` varchar(10) NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`token_count` int,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `enrichment_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `enrichment_sessions` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_id` bigint NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`questions_answered` int NOT NULL DEFAULT 0,
	`questions_skipped` int NOT NULL DEFAULT 0,
	`summary` text,
	`last_activity_at` bigint NOT NULL,
	`completed_at` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `enrichment_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `enrichment_suggestions` (
	`id` varchar(36) NOT NULL,
	`session_id` varchar(36) NOT NULL,
	`message_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`contact_id` bigint NOT NULL,
	`field_type` varchar(30) NOT NULL,
	`suggested_value` text NOT NULL,
	`applied_value` text,
	`tag_id` varchar(36),
	`tag_is_new` boolean NOT NULL DEFAULT false,
	`confidence` decimal(4,3) NOT NULL DEFAULT '0.000',
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`actioned_at` bigint,
	`actioned_by` varchar(20),
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `enrichment_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gold_access_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`grantedTo` int NOT NULL,
	`grantedBy` int NOT NULL,
	`reason` text,
	`revokedAt` timestamp,
	`revokedBy` int,
	`revokeReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gold_access_grants_id` PRIMARY KEY(`id`)
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
CREATE TABLE `matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`matchedUserId` int,
	`overallScore` int NOT NULL DEFAULT 0,
	`specialtyScore` int DEFAULT 0,
	`objectivesScore` int DEFAULT 0,
	`incomeScore` int DEFAULT 0,
	`locationScore` int DEFAULT 0,
	`valuesScore` int DEFAULT 0,
	`aiInsight` text,
	`aiGeneratedAt` timestamp,
	`userSeen` boolean NOT NULL DEFAULT false,
	`userDismissed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `matches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meeting_contact_suggestions` (
	`id` varchar(36) NOT NULL,
	`meeting_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`existing_contact_id` bigint,
	`full_name` varchar(200) NOT NULL,
	`job_title` varchar(200),
	`company` varchar(200),
	`phone` varchar(50),
	`email` varchar(320),
	`source_entity_ids` json,
	`confidence` decimal(4,3) NOT NULL DEFAULT '0.000',
	`status` enum('pending','created','linked','ignored') NOT NULL DEFAULT 'pending',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `meeting_contact_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meeting_entities` (
	`id` varchar(36) NOT NULL,
	`meeting_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`value` text NOT NULL,
	`normalized_value` varchar(500),
	`confidence` decimal(4,3) NOT NULL DEFAULT '0.000',
	`status` enum('pending','confirmed','ignored') NOT NULL DEFAULT 'pending',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `meeting_entities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meeting_recordings` (
	`id` varchar(36) NOT NULL,
	`meeting_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`storage_key` varchar(512) NOT NULL,
	`storage_url` varchar(512) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`duration_seconds` int NOT NULL,
	`expires_at` bigint NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `meeting_recordings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `meeting_transcript_translations` (
	`id` varchar(36) NOT NULL,
	`meeting_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`language` varchar(12) NOT NULL,
	`translated_text` text NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `meeting_transcript_translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_transcript_translations_owner_meeting_language_idx` UNIQUE(`owner_id`,`meeting_id`,`language`)
);
--> statement-breakpoint
CREATE TABLE `meeting_transcripts` (
	`id` varchar(36) NOT NULL,
	`meeting_id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`transcript` text NOT NULL,
	`segments` json,
	`language` varchar(12),
	`duration_seconds` int,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `meeting_transcripts_id` PRIMARY KEY(`id`),
	CONSTRAINT `meeting_transcripts_meeting_id_unique` UNIQUE(`meeting_id`)
);
--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`title` varchar(200) NOT NULL,
	`contact_id` bigint,
	`context_id` varchar(36),
	`status` enum('draft','recording','processing','ready','failed','deleted') NOT NULL DEFAULT 'draft',
	`consent_granted` boolean NOT NULL DEFAULT false,
	`consent_at` bigint,
	`language` varchar(12) NOT NULL DEFAULT 'pt',
	`processing_error` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `meetings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memory_documents` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(128) NOT NULL,
	`source_type` varchar(40) NOT NULL,
	`source_id` varchar(128) NOT NULL,
	`title` varchar(300) NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`embedding` json,
	`content_hash` varchar(64) NOT NULL,
	`indexed_at` bigint NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `memory_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `national_leaders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`nominatedBy` int NOT NULL,
	`region` varchar(120) NOT NULL,
	`specialty` varchar(200),
	`isActive` boolean NOT NULL DEFAULT true,
	`revokedAt` timestamp,
	`revokedBy` int,
	`revokeReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `national_leaders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publishedBy` int NOT NULL,
	`title` varchar(300) NOT NULL,
	`description` text NOT NULL,
	`type` enum('offer','demand','investment','partnership','distribution','other') NOT NULL,
	`sector` varchar(100),
	`country` varchar(2),
	`region` varchar(100),
	`tags` json,
	`frauenTrustScore` float DEFAULT 0,
	`complianceLevel` enum('green','yellow','orange','red','pending') NOT NULL DEFAULT 'pending',
	`complianceExplanation` text,
	`suggestedDocuments` json,
	`lastComplianceAt` timestamp,
	`isConfidential` boolean NOT NULL DEFAULT false,
	`status` enum('draft','pending','active','rejected','closed','removed') NOT NULL DEFAULT 'pending',
	`moderatedBy` int,
	`moderationNote` text,
	`moderatedAt` timestamp,
	`viewCount` int DEFAULT 0,
	`interestCount` int DEFAULT 0,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `opportunities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunity_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opportunityId` int NOT NULL,
	`uploadedBy` int NOT NULL,
	`name` varchar(300) NOT NULL,
	`url` text NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`mimeType` varchar(100),
	`sizeBytes` bigint,
	`isConfidential` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunity_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunity_interests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opportunityId` int NOT NULL,
	`userId` int NOT NULL,
	`message` text,
	`status` enum('pending','viewed','contacted','declined') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunity_interests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `opportunity_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opportunityAId` int NOT NULL,
	`opportunityBId` int NOT NULL,
	`score` float NOT NULL,
	`aiExplanation` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunity_matches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_requests` (
	`id` varchar(36) NOT NULL,
	`ip_address` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `platform_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('new_match','interest_received','gold_granted','gold_revoked','opportunity_approved','opportunity_rejected','new_message','compliance_update','system') NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` text,
	`actionUrl` varchar(500),
	`isRead` boolean DEFAULT false,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `president_validations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`opportunityId` int NOT NULL,
	`validatedBy` int NOT NULL,
	`status` varchar(32) NOT NULL,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `president_validations_id` PRIMARY KEY(`id`),
	CONSTRAINT `pres_val_opp_unq` UNIQUE(`opportunityId`)
);
--> statement-breakpoint
CREATE TABLE `private_contacts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`ownerId` varchar(128) NOT NULL,
	`fullName` varchar(200) NOT NULL,
	`photoUrl` varchar(512),
	`jobTitle` varchar(200),
	`company` varchar(200),
	`country` varchar(100),
	`state` varchar(100),
	`city` varchar(100),
	`phone` varchar(50),
	`whatsapp` varchar(50),
	`email` varchar(254),
	`linkedinUrl` varchar(512),
	`instagram` varchar(100),
	`profileTags` json,
	`cardImageUrl` varchar(512),
	`cardOcrText` text,
	`notes` text,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `private_contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `saved_opportunities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`opportunityId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `saved_opportunities_id` PRIMARY KEY(`id`)
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
CREATE TABLE `sivc_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`verificationId` int NOT NULL,
	`module` varchar(64) NOT NULL,
	`field` varchar(64) NOT NULL,
	`declaredValue` text,
	`verifiedValue` text,
	`status` varchar(32) NOT NULL DEFAULT 'unverified',
	`confidenceScore` int DEFAULT 0,
	`weight` int DEFAULT 1,
	`isMandatory` boolean DEFAULT false,
	`source` varchar(64),
	`auditLog` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sivc_checks_id` PRIMARY KEY(`id`),
	CONSTRAINT `sivc_chk_unq` UNIQUE(`verificationId`,`module`,`field`)
);
--> statement-breakpoint
CREATE TABLE `sivc_consents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`consentType` varchar(64) NOT NULL,
	`ipAddress` varchar(45),
	`payloadJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sivc_consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sivc_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`verificationId` int NOT NULL,
	`userId` int NOT NULL,
	`module` varchar(64) NOT NULL,
	`docType` varchar(64) NOT NULL,
	`fileKey` varchar(500) NOT NULL,
	`url` text,
	`mimeType` varchar(100),
	`sizeBytes` bigint,
	`ocrStatus` varchar(32) NOT NULL DEFAULT 'processing',
	`ocrText` text,
	`extractedData` json,
	`confidenceScore` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sivc_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sivc_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'in_progress',
	`level` varchar(32),
	`overallScore` int DEFAULT 0,
	`mandatoryPassed` boolean DEFAULT false,
	`consentGrantedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sivc_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategic_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`createdBy` int NOT NULL,
	`memberIds` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategic_groups_id` PRIMARY KEY(`id`)
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
CREATE TABLE `user_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`displayName` varchar(100),
	`bio` text,
	`gender` enum('male','female','prefer_not_to_say'),
	`avatarUrl` text,
	`city` varchar(100),
	`country` varchar(2),
	`sectors` json,
	`languages` json,
	`linkedinUrl` text,
	`websiteUrl` text,
	`profileCompleteness` int DEFAULT 0,
	`company` varchar(200),
	`personType` enum('individual','legal_entity','mei'),
	`companySize` enum('mei','micro','small','medium','large'),
	`companyCnpj` varchar(18),
	`jobTitle` varchar(200),
	`activityArea` varchar(200),
	`interestSectors` json,
	`institutionalNetwork` varchar(300),
	`currentResources` text,
	`whatIHave` json,
	`whatINeed` json,
	`primarySpecialty` varchar(100),
	`secondarySpecialties` json,
	`currentRole` varchar(200),
	`currentCompany` varchar(200),
	`sector` varchar(100),
	`seekingTypes` json,
	`businessInterests` json,
	`preferredCompanySize` varchar(50),
	`openToRemote` boolean DEFAULT false,
	`availableForTravel` boolean DEFAULT false,
	`workStyle` varchar(50),
	`values` json,
	`incomeRange` varchar(50),
	`investmentCapacity` varchar(50),
	`lookingForInvestment` boolean DEFAULT false,
	`investmentAmountSeeking` varchar(50),
	`experienceYears` int,
	`educationLevel` varchar(50),
	`age` int,
	`encryptedSensitiveData` text,
	`lastAiAnalysisAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_profiles_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`passwordHash` text,
	`emailVerified` boolean NOT NULL DEFAULT false,
	`loginMethod` varchar(64) DEFAULT 'email',
	`role` enum('bronze','silver','gold','admin','president') NOT NULL DEFAULT 'bronze',
	`country` varchar(2),
	`company` varchar(200),
	`position` varchar(200),
	`isActive` boolean NOT NULL DEFAULT true,
	`isVerified` boolean NOT NULL DEFAULT false,
	`onboardingCompleted` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `ai_match_owner_status_score_idx` ON `ai_match_suggestions` (`owner_id`,`status`,`match_score`);--> statement-breakpoint
CREATE INDEX `ai_match_contact_a_idx` ON `ai_match_suggestions` (`contact_a_id`);--> statement-breakpoint
CREATE INDEX `ai_match_contact_b_idx` ON `ai_match_suggestions` (`contact_b_id`);--> statement-breakpoint
CREATE INDEX `audit_userId_idx` ON `audit_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_createdAt_idx` ON `audit_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `conn_requester_idx` ON `connections` (`requesterId`);--> statement-breakpoint
CREATE INDEX `conn_recipient_idx` ON `connections` (`recipientId`);--> statement-breakpoint
CREATE INDEX `contact_assets_owner_contact_idx` ON `contact_assets` (`owner_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_assets_owner_slug_idx` ON `contact_assets` (`owner_id`,`tag_slug`);--> statement-breakpoint
CREATE INDEX `contact_assets_owner_category_idx` ON `contact_assets` (`owner_id`,`category`);--> statement-breakpoint
CREATE INDEX `contact_needs_owner_contact_idx` ON `contact_needs` (`owner_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `contact_needs_owner_slug_idx` ON `contact_needs` (`owner_id`,`tag_slug`);--> statement-breakpoint
CREATE INDEX `contact_needs_owner_category_idx` ON `contact_needs` (`owner_id`,`category`);--> statement-breakpoint
CREATE INDEX `drd_room_idx` ON `deal_room_documents` (`dealRoomId`);--> statement-breakpoint
CREATE INDEX `drm_room_idx` ON `deal_room_messages` (`dealRoomId`);--> statement-breakpoint
CREATE INDEX `drm_sender_idx` ON `deal_room_messages` (`senderId`);--> statement-breakpoint
CREATE INDEX `dr_opportunity_idx` ON `deal_rooms` (`opportunityId`);--> statement-breakpoint
CREATE INDEX `dr_owner_idx` ON `deal_rooms` (`ownerId`);--> statement-breakpoint
CREATE INDEX `dr_interested_idx` ON `deal_rooms` (`interestedId`);--> statement-breakpoint
CREATE INDEX `dm_sender_idx` ON `direct_messages` (`senderId`);--> statement-breakpoint
CREATE INDEX `dm_recipient_idx` ON `direct_messages` (`recipientId`);--> statement-breakpoint
CREATE INDEX `dm_group_idx` ON `direct_messages` (`groupId`);--> statement-breakpoint
CREATE INDEX `gold_grantedTo_idx` ON `gold_access_grants` (`grantedTo`);--> statement-breakpoint
CREATE INDEX `gold_grantedBy_idx` ON `gold_access_grants` (`grantedBy`);--> statement-breakpoint
CREATE INDEX `attempts_identifier_idx` ON `login_attempts` (`identifier`);--> statement-breakpoint
CREATE INDEX `attempts_ip_idx` ON `login_attempts` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `match_userId_idx` ON `matches` (`userId`);--> statement-breakpoint
CREATE INDEX `match_matchedUserId_idx` ON `matches` (`matchedUserId`);--> statement-breakpoint
CREATE INDEX `match_score_idx` ON `matches` (`overallScore`);--> statement-breakpoint
CREATE INDEX `meeting_contact_suggestions_owner_meeting_idx` ON `meeting_contact_suggestions` (`owner_id`,`meeting_id`);--> statement-breakpoint
CREATE INDEX `meeting_contact_suggestions_status_idx` ON `meeting_contact_suggestions` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_entities_owner_meeting_idx` ON `meeting_entities` (`owner_id`,`meeting_id`);--> statement-breakpoint
CREATE INDEX `meeting_entities_status_idx` ON `meeting_entities` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_recordings_meeting_idx` ON `meeting_recordings` (`meeting_id`);--> statement-breakpoint
CREATE INDEX `meeting_recordings_owner_expires_idx` ON `meeting_recordings` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `meeting_transcripts_owner_meeting_idx` ON `meeting_transcripts` (`owner_id`,`meeting_id`);--> statement-breakpoint
CREATE INDEX `meetings_owner_created_idx` ON `meetings` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `meetings_owner_status_idx` ON `meetings` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `memory_documents_owner_source_idx` ON `memory_documents` (`owner_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `memory_documents_owner_indexed_idx` ON `memory_documents` (`owner_id`,`indexed_at`);--> statement-breakpoint
CREATE INDEX `nat_lead_active_idx` ON `national_leaders` (`isActive`);--> statement-breakpoint
CREATE INDEX `nat_lead_user_idx` ON `national_leaders` (`userId`);--> statement-breakpoint
CREATE INDEX `opp_publishedBy_idx` ON `opportunities` (`publishedBy`);--> statement-breakpoint
CREATE INDEX `opp_type_idx` ON `opportunities` (`type`);--> statement-breakpoint
CREATE INDEX `opp_status_idx` ON `opportunities` (`status`);--> statement-breakpoint
CREATE INDEX `opp_sector_idx` ON `opportunities` (`sector`);--> statement-breakpoint
CREATE INDEX `opp_country_idx` ON `opportunities` (`country`);--> statement-breakpoint
CREATE INDEX `opp_compliance_idx` ON `opportunities` (`complianceLevel`);--> statement-breakpoint
CREATE INDEX `opp_fts_idx` ON `opportunities` (`frauenTrustScore`);--> statement-breakpoint
CREATE INDEX `doc_opportunity_idx` ON `opportunity_documents` (`opportunityId`);--> statement-breakpoint
CREATE INDEX `interest_opp_idx` ON `opportunity_interests` (`opportunityId`);--> statement-breakpoint
CREATE INDEX `interest_user_idx` ON `opportunity_interests` (`userId`);--> statement-breakpoint
CREATE INDEX `omatch_oppA_idx` ON `opportunity_matches` (`opportunityAId`);--> statement-breakpoint
CREATE INDEX `omatch_oppB_idx` ON `opportunity_matches` (`opportunityBId`);--> statement-breakpoint
CREATE INDEX `omatch_score_idx` ON `opportunity_matches` (`score`);--> statement-breakpoint
CREATE INDEX `prr_ip_created_idx` ON `password_reset_requests` (`ip_address`,`created_at`);--> statement-breakpoint
CREATE INDEX `prt_token_idx` ON `password_reset_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `prt_userId_idx` ON `password_reset_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `pnotif_userId_idx` ON `platform_notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `pnotif_type_idx` ON `platform_notifications` (`type`);--> statement-breakpoint
CREATE INDEX `pc_owner_idx` ON `private_contacts` (`ownerId`);--> statement-breakpoint
CREATE INDEX `pc_owner_name_idx` ON `private_contacts` (`ownerId`,`fullName`);--> statement-breakpoint
CREATE INDEX `pc_owner_company_idx` ON `private_contacts` (`ownerId`,`company`);--> statement-breakpoint
CREATE INDEX `pc_owner_country_idx` ON `private_contacts` (`ownerId`,`country`);--> statement-breakpoint
CREATE INDEX `pc_owner_updated_idx` ON `private_contacts` (`ownerId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `saved_user_idx` ON `saved_opportunities` (`userId`);--> statement-breakpoint
CREATE INDEX `saved_opp_idx` ON `saved_opportunities` (`opportunityId`);--> statement-breakpoint
CREATE INDEX `security_userId_idx` ON `security_events` (`userId`);--> statement-breakpoint
CREATE INDEX `security_eventType_idx` ON `security_events` (`eventType`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `session_token_idx` ON `sessions` (`sessionToken`);--> statement-breakpoint
CREATE INDEX `sivc_con_user_idx` ON `sivc_consents` (`userId`);--> statement-breakpoint
CREATE INDEX `sivc_doc_ver_idx` ON `sivc_documents` (`verificationId`);--> statement-breakpoint
CREATE INDEX `sivc_ver_user_idx` ON `sivc_verifications` (`userId`);--> statement-breakpoint
CREATE INDEX `group_createdBy_idx` ON `strategic_groups` (`createdBy`);--> statement-breakpoint
CREATE INDEX `device_userId_idx` ON `trusted_devices` (`userId`);--> statement-breakpoint
CREATE INDEX `profile_userId_idx` ON `user_profiles` (`userId`);--> statement-breakpoint
CREATE INDEX `profile_country_idx` ON `user_profiles` (`country`);