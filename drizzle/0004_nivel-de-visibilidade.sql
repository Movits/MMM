ALTER TABLE `private_contacts` ADD `nivel_visibilidade` varchar(10) DEFAULT 'privado' NOT NULL;--> statement-breakpoint
CREATE INDEX `pc_nivel_idx` ON `private_contacts` (`nivel_visibilidade`);