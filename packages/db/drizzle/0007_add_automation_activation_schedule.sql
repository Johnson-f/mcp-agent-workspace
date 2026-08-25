CREATE TYPE "public"."automation_missed_run_policy" AS ENUM('skip', 'backfill_if_enabled');--> statement-breakpoint
CREATE TYPE "public"."automation_overlap_policy" AS ENUM('skip', 'queue_one', 'cancel_old', 'allow_overlap');--> statement-breakpoint
CREATE TYPE "public"."automation_schedule_kind" AS ENUM('manual_only', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."automation_state" AS ENUM('draft', 'pending_approval', 'live', 'paused', 'needs_reconfiguration', 'archived');--> statement-breakpoint
CREATE TYPE "public"."automation_version_state" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TABLE "automation_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"state" "automation_version_state" DEFAULT 'draft' NOT NULL,
	"run_brief_version_id" uuid NOT NULL,
	"schedule_kind" "automation_schedule_kind" NOT NULL,
	"schedule_timezone" text NOT NULL,
	"schedule_rule" text,
	"missed_run_policy" "automation_missed_run_policy" DEFAULT 'skip' NOT NULL,
	"overlap_policy" "automation_overlap_policy" DEFAULT 'skip' NOT NULL,
	"schedule_config" jsonb NOT NULL,
	"run_budget" jsonb NOT NULL,
	"output_destination" jsonb NOT NULL,
	"retention_policy" jsonb NOT NULL,
	"tool_authorization_snapshot" jsonb NOT NULL,
	"activation_preflight" jsonb,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"superseded_by_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_versions_number_check" CHECK ("automation_versions"."version_number" > 0),
	CONSTRAINT "automation_versions_recurring_rule_check" CHECK ("automation_versions"."schedule_kind" = 'manual_only' OR "automation_versions"."schedule_rule" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"state" "automation_state" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"temporal_schedule_id" text,
	"consecutive_failure_count" integer DEFAULT 0 NOT NULL,
	"failure_threshold" integer DEFAULT 3 NOT NULL,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"needs_reconfiguration_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automations_failure_count_check" CHECK ("automations"."consecutive_failure_count" >= 0),
	CONSTRAINT "automations_failure_threshold_check" CHECK ("automations"."failure_threshold" > 0)
);
--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_versions_number_uidx" ON "automation_versions" USING btree ("automation_id","version_number");--> statement-breakpoint
CREATE INDEX "automation_versions_automation_state_idx" ON "automation_versions" USING btree ("automation_id","state");--> statement-breakpoint
CREATE INDEX "automation_versions_run_brief_idx" ON "automation_versions" USING btree ("run_brief_version_id");--> statement-breakpoint
CREATE INDEX "automations_owner_state_idx" ON "automations" USING btree ("owner_type","owner_id","state");--> statement-breakpoint
CREATE INDEX "automations_owner_created_idx" ON "automations" USING btree ("owner_type","owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "automations_temporal_schedule_uidx" ON "automations" USING btree ("temporal_schedule_id");