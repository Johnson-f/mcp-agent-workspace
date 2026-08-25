CREATE TYPE "public"."mcp_approval_mode" AS ENUM('always', 'risky', 'never');--> statement-breakpoint
CREATE TABLE "mcp_tools" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"description" text,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb,
	"annotations" jsonb,
	"schema_hash" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"approval_mode" "mcp_approval_mode" DEFAULT 'always' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_connection_id_mcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_tools_connection_name_uidx" ON "mcp_tools" USING btree ("connection_id","name");--> statement-breakpoint
CREATE INDEX "mcp_tools_connection_enabled_idx" ON "mcp_tools" USING btree ("connection_id","enabled");