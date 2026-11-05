PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_crew_members` (
	`crew_id` integer NOT NULL,
	`runner_id` integer NOT NULL,
	PRIMARY KEY(`crew_id`, `runner_id`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runner_id`) REFERENCES `runners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_crew_members`("crew_id", "runner_id") SELECT "crew_id", "runner_id" FROM `crew_members`;--> statement-breakpoint
DROP TABLE `crew_members`;--> statement-breakpoint
ALTER TABLE `__new_crew_members` RENAME TO `crew_members`;--> statement-breakpoint
PRAGMA foreign_keys=ON;