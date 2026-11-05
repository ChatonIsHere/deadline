CREATE TABLE `user_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`reminders` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE `gig_slots` ADD `asked_at` integer;--> statement-breakpoint
ALTER TABLE `gig_slots` ADD `nudged` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `gigs` ADD `reminded_day` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `gigs` ADD `reminded_soon` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `reminder_hours` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `confirm_hours` integer DEFAULT 48 NOT NULL;