-- Public IDs. Added with a placeholder default, filled with random version 4 UUIDs, then made unique.
ALTER TABLE `crews` ADD `uuid` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `crews` SET `uuid` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)));--> statement-breakpoint
CREATE UNIQUE INDEX `crews_uuid_unique` ON `crews` (`uuid`);--> statement-breakpoint
ALTER TABLE `gigs` ADD `uuid` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `gigs` SET `uuid` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)));--> statement-breakpoint
CREATE UNIQUE INDEX `gigs_uuid_unique` ON `gigs` (`uuid`);--> statement-breakpoint
ALTER TABLE `runners` ADD `uuid` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `runners` SET `uuid` = lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)));--> statement-breakpoint
CREATE UNIQUE INDEX `runners_uuid_unique` ON `runners` (`uuid`);
