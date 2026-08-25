CREATE TYPE "public"."automation_run_trigger_source" AS ENUM('manual', 'scheduled');--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "trigger_source" "automation_run_trigger_source";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "triggered_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "scheduled_fire_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_owner_pinned_updated_idx" ON "conversations" USING btree ("owner_type","owner_id","pinned_at" DESC NULLS LAST,"updated_at" DESC NULLS LAST);