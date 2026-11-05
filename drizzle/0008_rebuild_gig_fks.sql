-- Columns added with ALTER TABLE lost their ON DELETE rules (gigs.fixer_runner_id,
-- gig_slots.runner_id, gig_reserves.runner_id). SQLite can't change a foreign key, so the
-- gig tables get rebuilt and their rows copied. The new children point at __new_gigs. The
-- old children are dropped first, so dropping the old gigs cascades into nothing. The
-- renames then repoint everything at gigs.
CREATE TABLE `__new_gigs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`fixer_name` text NOT NULL,
	`fixer_runner_id` integer,
	`fixer_id` text,
	`location` text NOT NULL,
	`type` text,
	`pay` integer NOT NULL,
	`objective` text NOT NULL,
	`image_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text NOT NULL,
	`thread_id` text,
	`session_at` integer,
	`reminded_day` integer DEFAULT false NOT NULL,
	`reminded_soon` integer DEFAULT false NOT NULL,
	`summary` text,
	`reward_eb` integer,
	`reward_ip` integer,
	`reward_hq_ip` integer,
	`reward_text` text,
	`overflow_message_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`fixer_runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_gigs` (`id`, `name`, `fixer_name`, `fixer_runner_id`, `fixer_id`, `location`, `type`, `pay`, `objective`, `image_id`, `status`, `created_by`, `thread_id`, `session_at`, `reminded_day`, `reminded_soon`, `summary`, `reward_eb`, `reward_ip`, `reward_hq_ip`, `reward_text`, `overflow_message_ids`, `created_at`)
SELECT `id`, `name`, `fixer_name`, `fixer_runner_id`, `fixer_id`, `location`, `type`, `pay`, `objective`, `image_id`, `status`, `created_by`, `thread_id`, `session_at`, `reminded_day`, `reminded_soon`, `summary`, `reward_eb`, `reward_ip`, `reward_hq_ip`, `reward_text`, `overflow_message_ids`, `created_at` FROM `gigs`;
--> statement-breakpoint
CREATE TABLE `__new_gig_objectives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gig_id` integer NOT NULL,
	`text` text NOT NULL,
	`bonus` integer,
	`position` integer NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `__new_gigs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_gig_objectives` (`id`, `gig_id`, `text`, `bonus`, `position`)
SELECT `id`, `gig_id`, `text`, `bonus`, `position` FROM `gig_objectives`;
--> statement-breakpoint
CREATE TABLE `__new_gig_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gig_id` integer NOT NULL,
	`crew_id` integer,
	`user_id` text,
	`runner_id` integer,
	`state` text DEFAULT 'interested' NOT NULL,
	`asked_at` integer,
	`nudged` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`gig_id`) REFERENCES `__new_gigs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_gig_slots` (`id`, `gig_id`, `crew_id`, `user_id`, `runner_id`, `state`, `asked_at`, `nudged`, `position`)
SELECT `id`, `gig_id`, `crew_id`, `user_id`, `runner_id`, `state`, `asked_at`, `nudged`, `position` FROM `gig_slots`;
--> statement-breakpoint
CREATE TABLE `__new_gig_reserves` (
	`gig_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`runner_id` integer,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`gig_id`, `user_id`),
	FOREIGN KEY (`gig_id`) REFERENCES `__new_gigs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_gig_reserves` (`gig_id`, `user_id`, `runner_id`, `joined_at`)
SELECT `gig_id`, `user_id`, `runner_id`, `joined_at` FROM `gig_reserves`;
--> statement-breakpoint
CREATE TABLE `__new_gig_rewards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gig_id` integer NOT NULL,
	`runner_id` integer NOT NULL,
	`eb` integer,
	`ip` integer,
	`text` text,
	FOREIGN KEY (`gig_id`) REFERENCES `__new_gigs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_gig_rewards` (`id`, `gig_id`, `runner_id`, `eb`, `ip`, `text`)
SELECT `id`, `gig_id`, `runner_id`, `eb`, `ip`, `text` FROM `gig_rewards`;
--> statement-breakpoint
CREATE TABLE `__new_fixer_ratings` (
	`gig_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`stars` integer NOT NULL,
	`comment` text,
	`rated_at` integer,
	PRIMARY KEY(`gig_id`, `user_id`),
	FOREIGN KEY (`gig_id`) REFERENCES `__new_gigs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fixer_ratings` (`gig_id`, `user_id`, `stars`, `comment`, `rated_at`)
SELECT `gig_id`, `user_id`, `stars`, `comment`, `rated_at` FROM `fixer_ratings`;
--> statement-breakpoint
DROP TABLE `gig_objectives`;--> statement-breakpoint
DROP TABLE `gig_slots`;--> statement-breakpoint
DROP TABLE `gig_reserves`;--> statement-breakpoint
DROP TABLE `gig_rewards`;--> statement-breakpoint
DROP TABLE `fixer_ratings`;--> statement-breakpoint
DROP TABLE `gigs`;--> statement-breakpoint
ALTER TABLE `__new_gigs` RENAME TO `gigs`;--> statement-breakpoint
ALTER TABLE `__new_gig_objectives` RENAME TO `gig_objectives`;--> statement-breakpoint
ALTER TABLE `__new_gig_slots` RENAME TO `gig_slots`;--> statement-breakpoint
ALTER TABLE `__new_gig_reserves` RENAME TO `gig_reserves`;--> statement-breakpoint
ALTER TABLE `__new_gig_rewards` RENAME TO `gig_rewards`;--> statement-breakpoint
ALTER TABLE `__new_fixer_ratings` RENAME TO `fixer_ratings`;--> statement-breakpoint
-- Existing crews get a Founder: the first runner added, preferring the crew owner's runners.
UPDATE `crew_members` SET `rank` = 'Founder'
WHERE `rowid` IN (
	SELECT (
		SELECT m.`rowid` FROM `crew_members` m JOIN `runners` r ON r.`id` = m.`runner_id`
		WHERE m.`crew_id` = c.`id`
		ORDER BY (r.`owner_id` IS c.`owner_id`) DESC, m.`rowid`
		LIMIT 1
	) FROM `crews` c
);
