import { describe, expect, test } from "vitest";
import {
	createEmptyRunBriefDraft,
	defaultAutomationSchedule,
	evaluateRunBriefDraft,
	getMcpToolCapability,
	isRunBriefDraft,
	type ProposedToolAuthorization,
	type RunBriefDraft,
} from "./conversation-run-brief";

const readTool = {
	id: "tool_auth_read",
	mcpConnectionId: "connection_123",
	mcpToolId: "tool_123",
	toolName: "read_watchlist",
	displayName: "Read watchlist",
	description: "Reads symbols from a watchlist.",
	required: true,
	reason: "The Agent needs the user's current symbols.",
	annotations: {
		readOnlyHint: true,
		destructiveHint: false,
	},
	state: "approved",
	acknowledgedWriteCapability: false,
	allowedOutcomeBoundary: null,
} satisfies ProposedToolAuthorization;

const writeTool = {
	...readTool,
	id: "tool_auth_write",
	mcpToolId: "tool_write_123",
	toolName: "send_email",
	displayName: "Send email",
	description: "Sends an email.",
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
	},
} satisfies ProposedToolAuthorization;

const completeManualDraft = (): RunBriefDraft => ({
	...createEmptyRunBriefDraft("manual_agent_run"),
	goal: "Summarize the latest news for every symbol in my watchlist.",
	successCriteria: [
		"Every current watchlist symbol is checked.",
		"The answer separates verified evidence from interpretation.",
	],
	expectedOutput: "A concise in-app summary grouped by symbol.",
	requiredTools: [readTool],
	outputDestination: {
		kind: "in_app",
		destinationRef: null,
		authorized: true,
	},
});

describe("MCP annotation capability defaults", () => {
	test("treats missing annotations using conservative MCP defaults", () => {
		expect(getMcpToolCapability(null)).toEqual({
			readOnly: false,
			destructive: true,
			idempotent: false,
			openWorld: true,
			writeCapable: true,
		});
	});

	test("treats explicit read-only non-destructive tools as not write-capable", () => {
		expect(
			getMcpToolCapability({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			}),
		).toEqual({
			readOnly: true,
			destructive: false,
			idempotent: true,
			openWorld: false,
			writeCapable: false,
		});
	});
});

describe("Conversation to Run Brief evaluation", () => {
	test("accepts valid Run Brief draft JSON and rejects malformed draft JSON", () => {
		expect(isRunBriefDraft(completeManualDraft())).toBe(true);
		expect(
			isRunBriefDraft({
				...completeManualDraft(),
				requiredTools: [
					{
						...readTool,
						state: "approved",
						acknowledgedWriteCapability: "yes",
					},
				],
			}),
		).toBe(false);
		expect(
			isRunBriefDraft({
				...completeManualDraft(),
				outputDestination: {
					kind: "email",
					destinationRef: "digest",
				},
			}),
		).toBe(false);
	});

	test("blocks Run Brief creation until required fields are explicit", () => {
		const evaluation = evaluateRunBriefDraft(
			createEmptyRunBriefDraft("manual_agent_run"),
		);

		expect(evaluation.conversationState).toBe("awaiting_user_input");
		expect(evaluation.runBriefVersionState).toBe("draft");
		expect(evaluation.canCreateRunBriefVersion).toBe(false);
		expect(evaluation.missingFields.map((field) => field.path)).toContain(
			"goal",
		);
		expect(evaluation.missingFields.map((field) => field.path)).toContain(
			"tools",
		);
	});

	test("creates a pending approval Run Brief when the draft is complete", () => {
		const evaluation = evaluateRunBriefDraft(completeManualDraft());

		expect(evaluation.conversationState).toBe("ready_for_run_brief");
		expect(evaluation.runBriefVersionState).toBe("pending_approval");
		expect(evaluation.canCreateRunBriefVersion).toBe(true);
		expect(evaluation.canApproveRunBriefVersion).toBe(false);
		expect(evaluation.missingFields).toEqual([]);
	});

	test("requires final user approval before a Run Brief is approved", () => {
		const evaluation = evaluateRunBriefDraft({
			...completeManualDraft(),
			userApprovedFinalBrief: true,
		});

		expect(evaluation.runBriefVersionState).toBe("approved");
		expect(evaluation.canApproveRunBriefVersion).toBe(true);
	});

	test("requires per-tool acknowledgement and outcome boundary for write tools", () => {
		const evaluation = evaluateRunBriefDraft({
			...completeManualDraft(),
			optionalTools: [writeTool],
		});

		expect(evaluation.canCreateRunBriefVersion).toBe(false);
		expect(evaluation.writeToolAcknowledgementsRequired).toEqual([
			{
				toolAuthorizationId: "tool_auth_write",
				toolName: "send_email",
				reason:
					"This MCP tool is not declared read-only by its annotations, so it needs explicit acknowledgement and an allowed outcome boundary.",
			},
		]);
	});

	test("accepts write tools only after acknowledgement and allowed outcome boundary", () => {
		const evaluation = evaluateRunBriefDraft({
			...completeManualDraft(),
			optionalTools: [
				{
					...writeTool,
					acknowledgedWriteCapability: true,
					allowedOutcomeBoundary:
						"May send one summary email to the approved destination.",
				},
			],
		});

		expect(evaluation.canCreateRunBriefVersion).toBe(true);
	});

	test("requires an explicit schedule decision and allows no schedule", () => {
		const draft = {
			...completeManualDraft(),
			mode: "automation",
			schedule: createEmptyRunBriefDraft("automation").schedule,
		} satisfies RunBriefDraft;

		const evaluation = evaluateRunBriefDraft(draft);

		expect(draft.schedule).toBeNull();
		expect(evaluation.missingFields.map((field) => field.path)).toContain(
			"schedule",
		);

		const onDemand = evaluateRunBriefDraft({
			...draft,
			schedule: defaultAutomationSchedule(),
		});
		expect(onDemand.missingFields.map((field) => field.path)).not.toContain(
			"schedule",
		);
	});

	test("blocks rejected, revoked, stale, or unapproved tools", () => {
		const evaluation = evaluateRunBriefDraft({
			...completeManualDraft(),
			requiredTools: [{ ...readTool, state: "stale" }],
		});

		expect(evaluation.canCreateRunBriefVersion).toBe(false);
		expect(evaluation.staleToolIds).toEqual(["tool_auth_read"]);
		expect(evaluation.missingFields.map((field) => field.path)).toContain(
			"tools.tool_auth_read.state",
		);
	});
});
