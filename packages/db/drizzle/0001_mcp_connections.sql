CREATE TYPE "public"."mcp_auth_type" AS ENUM('none', 'bearer', 'oauth2', 'custom_headers');--> statement-breakpoint
CREATE TYPE "public"."mcp_connection_status" AS ENUM('pending', 'auth_required', 'connected', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."mcp_transport" AS ENUM('streamable_http', 'sse', 'stdio');--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transport" "mcp_transport" NOT NULL,
	"endpoint_url" text,
	"command" text,
	"command_args" jsonb,
	"auth_type" "mcp_auth_type" DEFAULT 'none' NOT NULL,
	"status" "mcp_connection_status" DEFAULT 'pending' NOT NULL,
	"server_name" text,
	"server_version" text,
	"protocol_version" text,
	"capabilities" jsonb,
	"last_error_code" text,
	"last_error_message" text,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_connections_transport_config_check" CHECK (("mcp_connections"."transport" IN ('streamable_http', 'sse') AND "mcp_connections"."endpoint_url" IS NOT NULL AND "mcp_connections"."command" IS NULL) OR ("mcp_connections"."transport" = 'stdio' AND "mcp_connections"."command" IS NOT NULL AND "mcp_connections"."endpoint_url" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "mcp_credentials" (
	"connection_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_credentials_connection_id_pk" PRIMARY KEY("connection_id"),
	CONSTRAINT "mcp_credentials_key_version_check" CHECK ("mcp_credentials"."key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_credentials" ADD CONSTRAINT "mcp_credentials_connection_id_mcp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."mcp_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_user_name_uidx" ON "mcp_connections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "mcp_connections_user_status_idx" ON "mcp_connections" USING btree ("user_id","status");