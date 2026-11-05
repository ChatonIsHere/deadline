CREATE TABLE `crew_allies` (
	`crew_id` integer NOT NULL,
	`runner_id` integer NOT NULL,
	PRIMARY KEY(`crew_id`, `runner_id`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crew_invites` (
	`crew_id` integer NOT NULL,
	`runner_id` integer NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`crew_id`, `runner_id`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `crew_members` ADD `rank` text DEFAULT 'Member' NOT NULL;--> statement-breakpoint
ALTER TABLE `crews` ADD `ranks` text DEFAULT '["Founder","Lieutenant","Member","Prospect"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `fixer_ratings` ADD `comment` text;--> statement-breakpoint
ALTER TABLE `fixer_ratings` ADD `rated_at` integer;--> statement-breakpoint
ALTER TABLE `gigs` ADD `overflow_message_ids` text DEFAULT '[]' NOT NULL;