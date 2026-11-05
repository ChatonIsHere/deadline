CREATE TABLE `gig_reserves` (
	`gig_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`gig_id`, `user_id`),
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `gig_slots` ADD `state` text DEFAULT 'interested' NOT NULL;--> statement-breakpoint
ALTER TABLE `gigs` ADD `session_at` integer;