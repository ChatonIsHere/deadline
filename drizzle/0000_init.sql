CREATE TABLE `crew_members` (
	`crew_id` integer NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`crew_id`, `user_id`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `crews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tagline` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crews_name_unique` ON `crews` (`name`);--> statement-breakpoint
CREATE TABLE `gig_objectives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gig_id` integer NOT NULL,
	`text` text NOT NULL,
	`bonus` integer,
	`position` integer NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `gig_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gig_id` integer NOT NULL,
	`crew_id` integer,
	`user_id` text,
	`position` integer NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `gigs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `gigs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`fixer_name` text NOT NULL,
	`location` text NOT NULL,
	`type` text,
	`pay` integer NOT NULL,
	`objective` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text NOT NULL,
	`thread_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
