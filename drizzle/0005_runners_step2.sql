CREATE TABLE `fixer_ratings` (
	`gig_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`stars` integer NOT NULL,
	PRIMARY KEY(`gig_id`, `user_id`),
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gig_rewards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gig_id` integer NOT NULL,
	`runner_id` integer NOT NULL,
	`eb` integer,
	`ip` integer,
	`text` text,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text,
	`handle` text NOT NULL,
	`role` text NOT NULL,
	`extra_roles` text DEFAULT '[]' NOT NULL,
	`image_id` integer,
	`office_location` text,
	`specialties` text,
	`contact` text,
	`bio` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `crew_members` ADD `runner_id` integer REFERENCES runners(id);--> statement-breakpoint
ALTER TABLE `gig_reserves` ADD `runner_id` integer REFERENCES runners(id);--> statement-breakpoint
ALTER TABLE `gig_slots` ADD `runner_id` integer REFERENCES runners(id);--> statement-breakpoint
ALTER TABLE `gigs` ADD `fixer_runner_id` integer REFERENCES runners(id);--> statement-breakpoint
ALTER TABLE `gigs` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `gigs` ADD `reward_eb` integer;--> statement-breakpoint
ALTER TABLE `gigs` ADD `reward_ip` integer;--> statement-breakpoint
ALTER TABLE `gigs` ADD `reward_hq_ip` integer;--> statement-breakpoint
ALTER TABLE `gigs` ADD `reward_text` text;--> statement-breakpoint
ALTER TABLE `images` ADD `kind` text DEFAULT 'gig' NOT NULL;--> statement-breakpoint
-- Sign-ups and crews were people, now they are runners. Nothing to map them to, so they start empty.
UPDATE `gig_slots` SET `user_id` = NULL, `state` = 'interested', `asked_at` = NULL, `nudged` = 0;--> statement-breakpoint
DELETE FROM `gig_reserves`;--> statement-breakpoint
DELETE FROM `crew_members`;
