ALTER TABLE "mcp_tools" ADD COLUMN "annotation_hash" text;--> statement-breakpoint
UPDATE "mcp_tools" SET "annotation_hash" = 'legacy_annotation_hash' WHERE "annotation_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "mcp_tools" ALTER COLUMN "annotation_hash" SET NOT NULL;
