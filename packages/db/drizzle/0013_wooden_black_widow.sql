CREATE TYPE "public"."conversation_activity_kind" AS ENUM('reasoning_summary', 'tool', 'automation', 'status');--> statement-breakpoint
CREATE TYPE "public"."conversation_activity_status" AS ENUM('running', 'waiting', 'completed', 'failed', 'incomplete');--> statement-breakpoint
CREATE TABLE "conversation_turn_activities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"assistant_message_id" uuid,
	"sequence" integer NOT NULL,
	"kind" "conversation_activity_kind" NOT NULL,
	"status" "conversation_activity_status" NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"tool_call_id" uuid,
	"public_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_turn_activities_sequence_check" CHECK ("conversation_turn_activities"."sequence" > 0),
	CONSTRAINT "conversation_turn_activities_title_check" CHECK (char_length("conversation_turn_activities"."title") <= 200),
	CONSTRAINT "conversation_turn_activities_content_check" CHECK ("conversation_turn_activities"."content" IS NULL OR char_length("conversation_turn_activities"."content") <= 16384)
);
--> statement-breakpoint
ALTER TABLE "conversation_turn_activities" ADD CONSTRAINT "conversation_turn_activities_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_activities" ADD CONSTRAINT "conversation_turn_activities_assistant_message_id_conversation_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_turn_activities" ADD CONSTRAINT "conversation_turn_activities_tool_call_id_mcp_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."mcp_tool_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turn_activities_turn_sequence_uidx" ON "conversation_turn_activities" USING btree ("turn_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_turn_activities_tool_call_uidx" ON "conversation_turn_activities" USING btree ("tool_call_id") WHERE "conversation_turn_activities"."tool_call_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_turn_activities_conversation_started_idx" ON "conversation_turn_activities" USING btree ("conversation_id","started_at","sequence");