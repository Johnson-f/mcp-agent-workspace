import { Schema } from "effect";
import { describe, expect, test } from "vitest";
import {
	AgentRun,
	Conversation,
	ConversationCreateResult,
	ConversationMessage,
	RunBriefVersion,
} from "./product-flow";

describe("product flow schemas", () => {
	test("describe Conversation and Run Brief API views", () => {
		const conversation = Schema.decodeUnknownSync(Conversation)({
			id: "conversation_123",
			ownerType: "workspace",
			ownerId: "workspace_123",
			title: "Watchlist automation",
			state: "drafting",
			pinnedAt: null,
			automationId: null,
			createdAt: "2026-08-17T12:00:00.000Z",
			updatedAt: "2026-08-17T12:00:00.000Z",
		});
		const message = Schema.decodeUnknownSync(ConversationMessage)({
			id: "message_123",
			conversationId: "conversation_123",
			role: "user",
			content: "Check my watchlist every morning.",
			metadata: {},
			createdAt: "2026-08-17T12:00:00.000Z",
		});

		expect(
			Schema.decodeUnknownSync(ConversationCreateResult)({
				conversation,
				message,
			}),
		).toEqual({ conversation, message });
	});

	test("rejects invalid Run Brief and Agent Run states", () => {
		expect(() =>
			Schema.decodeUnknownSync(RunBriefVersion)({
				id: "version_123",
				runBriefId: "brief_123",
				conversationId: "conversation_123",
				versionNumber: 1,
				mode: "manual_agent_run",
				state: "running",
				schemaVersion: "run-brief-draft.v1",
				structuredBrief: {},
				evaluation: {},
				approvedAt: null,
				createdAt: "2026-08-17T12:00:00.000Z",
				updatedAt: "2026-08-17T12:00:00.000Z",
			}),
		).toThrow();

		expect(() =>
			Schema.decodeUnknownSync(AgentRun)({
				id: "run_123",
				state: "approved",
				title: "Run",
				conversationId: "conversation_123",
				runBriefVersionId: "version_123",
				temporalWorkflowId: null,
				temporalRunId: null,
				createdAt: "2026-08-17T12:00:00.000Z",
			}),
		).toThrow();
	});
});
