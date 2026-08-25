CREATE TYPE "public"."artifact_purpose" AS ENUM('tool_arguments', 'tool_result', 'model_prompt', 'model_output', 'checkpoint_state', 'final_output', 'evidence', 'delivery_payload', 'other');--> statement-breakpoint
CREATE TYPE "public"."artifact_retention_state" AS ENUM('active', 'raw_deleted', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."artifact_sensitivity" AS ENUM('low', 'sensitive', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."artifact_storage_kind" AS ENUM('postgres_encrypted', 'object_encrypted');--> statement-breakpoint
CREATE TYPE "public"."owner_scope_type" AS ENUM('user', 'workspace');--> statement-breakpoint
CREATE TABLE "artifact_blobs" (
	"artifact_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_blobs_artifact_id_pk" PRIMARY KEY("artifact_id")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" "owner_scope_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid,
	"created_by_user_id" uuid,
	"purpose" "artifact_purpose" NOT NULL,
	"sensitivity" "artifact_sensitivity" NOT NULL,
	"storage_kind" "artifact_storage_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256_hash" text NOT NULL,
	"encryption_algorithm" text NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"encryption_key_id" text NOT NULL,
	"encryption_nonce" text NOT NULL,
	"encryption_auth_tag" text NOT NULL,
	"redacted_summary" jsonb NOT NULL,
	"retention_policy" jsonb NOT NULL,
	"raw_retain_until" timestamp with time zone NOT NULL,
	"summary_retain_until" timestamp with time zone NOT NULL,
	"retention_state" "artifact_retention_state" DEFAULT 'active' NOT NULL,
	"raw_deleted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_byte_length_check" CHECK ("artifacts"."byte_length" >= 0),
	CONSTRAINT "artifacts_encryption_key_version_check" CHECK ("artifacts"."encryption_key_version" > 0),
	CONSTRAINT "artifacts_retention_window_check" CHECK ("artifacts"."summary_retain_until" >= "artifacts"."raw_retain_until")
);
--> statement-breakpoint
ALTER TABLE "artifact_blobs" ADD CONSTRAINT "artifact_blobs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_storage_key_uidx" ON "artifacts" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "artifacts_owner_created_idx" ON "artifacts" USING btree ("owner_type","owner_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artifacts_run_created_idx" ON "artifacts" USING btree ("run_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artifacts_raw_retention_idx" ON "artifacts" USING btree ("retention_state","raw_retain_until");--> statement-breakpoint
CREATE INDEX "artifacts_summary_retention_idx" ON "artifacts" USING btree ("retention_state","summary_retain_until");