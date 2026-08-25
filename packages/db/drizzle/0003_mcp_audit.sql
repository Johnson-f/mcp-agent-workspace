CREATE TYPE "public"."mcp_approval_status" AS ENUM('not_required', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."mcp_tool_call_status" AS ENUM('pending', 'awaiting_approval', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "mcp_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid,
	"tool_id" uuid,
	"idempotency_key" text NOT NULL,
	"connection_name" text NOT NULL,
	"tool_name" text NOT NULL,
	"arguments_redacted" jsonb NOT NULL,
	"arguments_hash" text NOT NULL,
	"result_redacted" jsonb,
	"status" "mcp_tool_call_status" DEFAULT 'pending' NOT NULL,
	"approval_status" "mcp_approval_status" DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_calls_duration_ms_check" CHECK ("mcp_tool_calls"."duration_ms" IS NULL OR "mcp_tool_calls"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_connection_id_mcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_tool_id_mcp_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."mcp_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tool_calls_user_idempotency_uidx" ON "mcp_tool_calls" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_user_created_idx" ON "mcp_tool_calls" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_connection_created_idx" ON "mcp_tool_calls" USING btree ("connection_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mcp_tool_calls_status_created_idx" ON "mcp_tool_calls" USING btree ("status","created_at");