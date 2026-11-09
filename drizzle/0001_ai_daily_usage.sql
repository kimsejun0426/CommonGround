CREATE TABLE `cg_ai_daily_usage` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`utc_day` text NOT NULL,
	`requests` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cg_ai_daily_usage_day_idx` ON `cg_ai_daily_usage` (`utc_day`);