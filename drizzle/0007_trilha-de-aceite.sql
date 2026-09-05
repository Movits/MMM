CREATE TABLE `nda_acceptances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dealRoomId` int NOT NULL,
	`userId` int NOT NULL,
	`papel` enum('owner','interested') NOT NULL,
	`ipAddress` varchar(45),
	`userAgent` text,
	`locale` varchar(10),
	`textoExibido` text,
	`textoHash` varchar(64),
	`acceptedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nda_acceptances_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `consents` ADD `textHash` varchar(64);--> statement-breakpoint
CREATE INDEX `nda_acc_room_idx` ON `nda_acceptances` (`dealRoomId`);--> statement-breakpoint
CREATE INDEX `nda_acc_user_idx` ON `nda_acceptances` (`userId`);