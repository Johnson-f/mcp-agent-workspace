CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'worker');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('agent', 'automation');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('queued', 'running', 'waiting_for_user', 'completed', 'completed_partial', 'failed', 'cancelled', 'expired', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."run_step_type" AS ENUM('message', 'brief_created', 'tool_selected', 'tool_call_started', 'tool_call_completed', 'tool_call_failed', 'approval_requested', 'approval_granted', 'approval_rejected', 'evidence_degraded', 'budget_reached', 'final_output', 'run_failed');--> statement-breakpoint
CREATE TABLE "audit_log_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"event_name" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"run_id" uuid,
	"redacted_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" "run_step_type" NOT NULL,
	"summary" text NOT NULL,
	"visible_to_user" boolean DEFAULT true NOT NULL,
	"related_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redacted_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" "run_kind" NOT NULL,
	"state" "run_state" DEFAULT 'queued' NOT NULL,
	"title" text NOT NULL,
	"conversation_id" uuid,
	"run_brief_version_id" uuid,
	"automation_id" uuid,
	"automation_version_id" uuid,
	"temporal_workflow_id" text,
	"temporal_run_id" text,
	"started_by_user_id" uuid,
	"final_run_step_id" uuid,
	"final_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure" jsonb,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_automation_parent_check" CHECK (("runs"."kind" = 'agent' AND "runs"."automation_id" IS NULL AND "runs"."automation_version_id" IS NULL) OR ("runs"."kind" = 'automation' AND "runs"."automation_id" IS NOT NULL AND "runs"."automation_version_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_log_events" ADD CONSTRAINT "audit_log_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_events" ADD CONSTRAINT "audit_log_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_events_owner_created_idx" ON "audit_log_events" USING btree ("owner_type","owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_events_run_created_idx" ON "audit_log_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_events_target_idx" ON "audit_log_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_occurred_idx" ON "run_steps" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "run_steps_owner_occurred_idx" ON "run_steps" USING btree ("owner_type","owner_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_owner_created_idx" ON "runs" USING btree ("owner_type","owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_state_created_idx" ON "runs" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "runs_temporal_workflow_idx" ON "runs" USING btree ("temporal_workflow_id");