CREATE TABLE `cg_approved_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`scenario_json` text NOT NULL,
	`evaluation_json` text NOT NULL,
	`consents_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cg_quotes_owner_proposal_unique` ON `cg_approved_quotes` (`owner_id`,`proposal_id`);--> statement-breakpoint
CREATE TABLE `cg_payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`quote_hash` text NOT NULL,
	`quote_json` text NOT NULL,
	`expected_amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`create_request_id` text NOT NULL,
	`capture_request_id` text NOT NULL,
	`paypal_order_id` text,
	`capture_id` text,
	`approval_url` text,
	`status` text DEFAULT 'CREATING' NOT NULL,
	`verified_at` integer,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cg_payment_quote_buyer_unique` ON `cg_payment_attempts` (`owner_id`,`quote_id`,`buyer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cg_payment_order_unique` ON `cg_payment_attempts` (`paypal_order_id`);--> statement-breakpoint
CREATE INDEX `cg_payment_owner_idx` ON `cg_payment_attempts` (`owner_id`);--> statement-breakpoint
CREATE TABLE `cg_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`scenario_json` text NOT NULL,
	`proposal_json` text NOT NULL,
	`mode` text NOT NULL,
	`ai_selection_json` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cg_proposals_owner_idx` ON `cg_proposals` (`owner_id`);--> statement-breakpoint
CREATE TABLE `cg_workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`active_proposal_id` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`lock_token` text,
	`updated_at` integer NOT NULL
);
