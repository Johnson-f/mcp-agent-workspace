CREATE TYPE "public"."conversation_agent_turn_state" AS ENUM('running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."interactive_agent_approval_policy" AS ENUM('always_ask', 'tool_policy', 'auto_approve_eligible');--> statement-breakpoint
ALTER TYPE "public"."mcp_tool_call_status" ADD VALUE 'denied';--> statement-breakpoint
CREATE TABLE "conversation_agent_turns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_message_id" uuid NOT NULL,
	"assistant_message_id" uuid,
	"state" "conversation_agent_turn_state" DEFAULT 'running' NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interactive_agent_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"approval_policy" "interactive_agent_approval_policy" DEFAULT 'always_ask' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "agent_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "step_number" integer;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "arguments_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "result_artifact_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD COLUMN "denied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_agent_turns" ADD CONSTRAINT "conversation_agent_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_agent_turns" ADD CONSTRAINT "conversation_agent_turns_user_message_id_conversation_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_agent_turns" ADD CONSTRAINT "conversation_agent_turns_assistant_message_id_conversation_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactive_agent_preferences" ADD CONSTRAINT "interactive_agent_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_agent_turns_conversation_updated_idx" ON "conversation_agent_turns" USING btree ("conversation_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_agent_turns_user_message_uidx" ON "conversation_agent_turns" USING btree ("user_message_id");--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_agent_turn_id_conversation_agent_turns_id_fk" FOREIGN KEY ("agent_turn_id") REFERENCES "public"."conversation_agent_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_arguments_artifact_id_artifacts_id_fk" FOREIGN KEY ("arguments_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_calls" ADD CONSTRAINT "mcp_tool_calls_result_artifact_id_artifacts_id_fk" FOREIGN KEY ("result_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;