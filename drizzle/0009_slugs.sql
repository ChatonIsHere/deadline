ALTER TABLE `crews` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `crews_slug_unique` ON `crews` (`slug`);--> statement-breakpoint
ALTER TABLE `runners` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `runners_slug_unique` ON `runners` (`slug`);