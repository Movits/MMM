ALTER TABLE `connections` MODIFY COLUMN `status` enum('pending','accepted','declined','blocked','in_review','not_forwarded') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `connections` ADD `moderatedBy` int;--> statement-breakpoint
ALTER TABLE `connections` ADD `moderationNote` text;--> statement-breakpoint
ALTER TABLE `connections` ADD `moderatedAt` timestamp;--> statement-breakpoint
ALTER TABLE `connections` ADD `reciprocatedAt` timestamp;--> statement-breakpoint
CREATE INDEX `conn_status_idx` ON `connections` (`status`);