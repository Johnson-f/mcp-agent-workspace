CREATE TYPE "public"."workspace_kind" AS ENUM('personal', 'team');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner_admin', 'editor', 'approver', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."conversation_message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('drafting', 'awaiting_user_input', 'ready_for_run_brief', 'run_brief_created', 'closed');--> statement-breakpoint
CREATE TYPE "public"."run_brief_mode" AS ENUM('manual_agent_run', 'automation');--> statement-breakpoint
CREATE TYPE "public"."run_brief_version_state" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."tool_authorization_snapshot_state" AS ENUM('proposed', 'approved', 'rejected', 'revoked', 'stale');--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "workspace_kind" DEFAULT 'personal' NOT NULL,
	"name" text NOT NULL,
	"personal_owner_user_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "conversation_message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contributed_to_run_brief_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"state" "conversation_state" DEFAULT 'drafting' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_brief_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"run_brief_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"mode" "run_brief_mode" NOT NULL,
	"state" "run_brief_version_state" NOT NULL,
	"schema_version" text NOT NULL,
	"structured_brief" jsonb NOT NULL,
	"evaluation" jsonb NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"superseded_by_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_brief_versions_number_check" CHECK ("run_brief_versions"."version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "run_briefs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"current_version_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_authorization_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_brief_version_id" uuid NOT NULL,
	"state" "tool_authorization_snapshot_state" NOT NULL,
	"mcp_connection_id" uuid,
	"mcp_tool_id" uuid,
	"server_id" text,
	"tool_name" text NOT NULL,
	"required" boolean NOT NULL,
	"write_capable" boolean NOT NULL,
	"schema_hash" text NOT NULL,
	"annotation_hash" text NOT NULL,
	"annotations" jsonb,
	"acknowledged_write_capability" boolean DEFAULT false NOT NULL,
	"allowed_outcome_boundary" text,
	"reason" text NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_personal_owner_user_id_users_id_fk" FOREIGN KEY ("personal_owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_brief_versions" ADD CONSTRAINT "run_brief_versions_run_brief_id_run_briefs_id_fk" FOREIGN KEY ("run_brief_id") REFERENCES "public"."run_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_brief_versions" ADD CONSTRAINT "run_brief_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_briefs" ADD CONSTRAINT "run_briefs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_briefs" ADD CONSTRAINT "run_briefs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_authorization_snapshots" ADD CONSTRAINT "tool_authorization_snapshots_run_brief_version_id_run_brief_versions_id_fk" FOREIGN KEY ("run_brief_version_id") REFERENCES "public"."run_brief_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_authorization_snapshots" ADD CONSTRAINT "tool_authorization_snapshots_mcp_connection_id_mcp_connections_id_fk" FOREIGN KEY ("mcp_connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_authorization_snapshots" ADD CONSTRAINT "tool_authorization_snapshots_mcp_tool_id_mcp_tools_id_fk" FOREIGN KEY ("mcp_tool_id") REFERENCES "public"."mcp_tools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_authorization_snapshots" ADD CONSTRAINT "tool_authorization_snapshots_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_personal_owner_uidx" ON "workspaces" USING btree ("personal_owner_user_id");--> statement-breakpoint
CREATE INDEX "workspaces_created_by_idx" ON "workspaces" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_created_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_owner_updated_idx" ON "conversations" USING btree ("owner_type","owner_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversations_created_by_idx" ON "conversations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_brief_versions_number_uidx" ON "run_brief_versions" USING btree ("run_brief_id","version_number");--> statement-breakpoint
CREATE INDEX "run_brief_versions_run_brief_state_idx" ON "run_brief_versions" USING btree ("run_brief_id","state");--> statement-breakpoint
CREATE INDEX "run_briefs_conversation_idx" ON "run_briefs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "run_briefs_owner_updated_idx" ON "run_briefs" USING btree ("owner_type","owner_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tool_auth_snapshots_run_brief_idx" ON "tool_authorization_snapshots" USING btree ("run_brief_version_id");--> statement-breakpoint
CREATE INDEX "tool_auth_snapshots_owner_state_idx" ON "tool_authorization_snapshots" USING btree ("owner_type","owner_id","state");