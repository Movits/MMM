ALTER TABLE `opportunities` ADD `destaqueAte` timestamp;--> statement-breakpoint
ALTER TABLE `opportunities` ADD `destacadaPor` int;--> statement-breakpoint
CREATE INDEX `opp_destaque_idx` ON `opportunities` (`destaqueAte`);