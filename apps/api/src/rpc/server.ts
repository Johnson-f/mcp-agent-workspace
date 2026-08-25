import {
	AgentsRpcs,
	AuthMiddleware,
	CurrentUser,
	evaluateRunBriefDraft,
	getMcpToolCapability,
	isRunBriefDraft,
	type ApiError,
	type CurrentUserValue,
	type RunBriefDraft,
} from "@agents/contracts";
import { HttpServer } from "@effect/platform";
import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Effect, Layer } from "effect";
import { AuthConfigurationError, authenticateRequest } from "../auth/stytch";
import { listMcpDirectory } from "../mcp-registry";
import {
	DatabaseConfigurationError,
	DisabledUserError,
	appendConversationMessage,
	appendConversationModelTurn,
	approveAutomationProposal,
	approveRunBriefVersion,
	createAutomationRunNow,
	createConversation,
	createManualAgentRun,
	getAgentRunDetailForUser,
	getApprovedRunBriefVersionForRunStart,
	getAutomationForUser,
	getConversationForUser,
	getInteractiveAgentPreferences,
	listAutomationsForUser,
	listConversationsForUser,
	listArchivedConversationsForUser,
	renameConversationForUser,
	setConversationArchivedForUser,
	deleteConversationForUser,
	saveRunBriefDraft,
	setConversationPinnedForUser,
	setAutomationTemporalScheduleId,
	upsertAuthenticatedUser,
	updateRunTemporalIdentity,
	updateInteractiveAgentPreferences,
} from "@agents/db";
import { mcpService, type ServiceError } from "@agents/mcp-gateway";
import {
	startRunWorkflow,
	syncAutomationSchedule,
	normalizeRecurringScheduleRule,
	type AutomationScheduleInput,
	runConversationModel,
	normalizeAutomationProposal,
	type RunBudget,
	type RunWorkflowInput,
} from "@agents/agent-runtime";

type RpcFailure = ApiError | ServiceError;

const serviceUnavailable = (): RpcFailure => ({
	_tag: "ServiceUnavailable",
	message: "The service is temporarily unavailable.",
});

const redactErrorMessage = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);

	return message
		.replace(/(code|token|secret|verifier)=([^&\s]+)/gi, "$1=<redacted>")
		.replace(/Bearer\s+[^\s]+/gi, "Bearer <redacted>")
		.slice(0, 1_000);
};

const fromPromise = <Value>(operation: string, promise: () => Promise<Value>) =>
	Effect.tryPromise({
		try: promise,
		catch: (error) => {
			console.error(`[rpc:${operation}] unexpected failure`, {
				name: error instanceof Error ? error.name : typeof error,
				message: redactErrorMessage(error),
			});
			return serviceUnavailable();
		},
	});

const runBudgetForPreset = (
	preset: RunBriefDraft["runBudgetPreset"],
): RunBudget => {
	switch (preset) {
		case "small":
			return {
				maxLlmSteps: 6,
				maxToolCalls: 8,
				maxRuntimeMs: 180_000,
				maxRetryAttempts: 2,
				maxOutputBytes: 12_000,
				maxSpendUsdCents: 100,
			};
		case "deep":
			return {
				maxLlmSteps: 24,
				maxToolCalls: 40,
				maxRuntimeMs: 1_800_000,
				maxRetryAttempts: 5,
				maxOutputBytes: 64_000,
				maxSpendUsdCents: 750,
			};
		case "standard":
		default:
			return {
				maxLlmSteps: 12,
				maxToolCalls: 20,
				maxRuntimeMs: 900_000,
				maxRetryAttempts: 3,
				maxOutputBytes: 24_000,
				maxSpendUsdCents: 250,
			};
	}
};

const selectedToolAuthorizations = (draft: RunBriefDraft) =>
	[...draft.requiredTools, ...draft.optionalTools].map((tool) => ({
		mcpConnectionId: tool.mcpConnectionId,
		mcpToolId: tool.mcpToolId,
		toolName: tool.toolName,
		required: tool.required,
		reason: tool.reason,
		state: tool.state,
		writeCapable: getMcpToolCapability(tool.annotations).writeCapable,
		acknowledgedWriteCapability: tool.acknowledgedWriteCapability,
		allowedOutcomeBoundary: tool.allowedOutcomeBoundary,
		annotations: tool.annotations,
	}));

const toRecord = (value: unknown) => value as Record<string, unknown>;

const AuthLive = Layer.succeed(
	AuthMiddleware,
	AuthMiddleware.of(({ headers }) =>
		Effect.tryPromise({
			try: async (): Promise<CurrentUserValue> => {
				const request = new Request("http://api.internal/rpc", {
					headers: {
						authorization: headers.authorization ?? "",
						cookie: headers.cookie ?? "",
						"x-agents-dev-user-id": headers["x-agents-dev-user-id"] ?? "",
					},
				});
				const identity = await authenticateRequest(request);

				if (!identity) {
					throw new DisabledUserError();
				}

				const user = await upsertAuthenticatedUser(identity);
				return {
					id: user.id,
					stytchUserId: user.stytchUserId,
					primaryEmail: user.primaryEmail,
					displayName: user.displayName,
					avatarUrl: user.avatarUrl,
				};
			},
			catch: (error) => {
				if (
					error instanceof AuthConfigurationError ||
					error instanceof DatabaseConfigurationError
				) {
					return {
						_tag: "ServiceUnavailable" as const,
						message: "Authentication is temporarily unavailable.",
					};
				}

				return {
					_tag: "Unauthorized" as const,
					message: "A valid Stytch session is required.",
				};
			},
		}),
	),
);

const HandlersLive = AgentsRpcs.toLayer(
	Effect.succeed({
		ViewerGet: () =>
			Effect.gen(function* () {
				return yield* CurrentUser;
			}),

		McpConnectionsList: () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* fromPromise("mcp.connections.list", () =>
					mcpService.listConnections(user.id),
				);
			}),

		McpDirectoryList: (input) =>
			fromPromise("mcp.directory.list", () => listMcpDirectory(input)),

		McpConnectionCreate: (input) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("mcp.connection.create", () =>
					mcpService.createConnection(user.id, input),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		McpConnectionRefresh: ({ connectionId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("mcp.connection.refresh", () =>
					mcpService.refreshConnection(user.id, connectionId),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		McpOAuthComplete: ({ state, code, iss }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("mcp.oauth.complete", () =>
					mcpService.completeOAuth(user.id, { state, code, iss }),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		McpConnectionDelete: ({ connectionId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const deleted = yield* fromPromise("mcp.connection.delete", () =>
					mcpService.deleteConnection(user.id, connectionId),
				);
				if (!deleted) {
					return yield* Effect.fail({
						_tag: "NotFound" as const,
						message: "MCP connection not found.",
					});
				}
			}),

		McpToolsList: ({ connectionId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const tools = yield* fromPromise("mcp.tools.list", () =>
					mcpService.listTools(user.id, connectionId),
				);
				if (!tools) {
					return yield* Effect.fail({
						_tag: "NotFound" as const,
						message: "MCP connection not found.",
					});
				}
				return tools;
			}),

		McpToolPolicyUpdate: ({ toolId, enabled, approvalMode }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const tool = yield* fromPromise("mcp.tool.update_policy", () =>
					mcpService.updateToolPolicy({
						userId: user.id,
						toolId,
						enabled,
						approvalMode,
					}),
				);
				if (!tool) {
					return yield* Effect.fail({
						_tag: "NotFound" as const,
						message: "MCP tool not found.",
					});
				}
				return tool;
			}),

		McpToolPoliciesBulkUpdate: ({
			connectionId,
			toolIds,
			enabled,
			approvalMode,
		}) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("mcp.tools.bulk_update", () =>
					mcpService.updateToolPolicies({
						userId: user.id,
						connectionId,
						toolIds: [...toolIds],
						...(enabled === undefined ? {} : { enabled }),
						...(approvalMode === undefined ? {} : { approvalMode }),
					}),
				);
				if ("_tag" in result) return yield* Effect.fail(result);
				return result;
			}),

		McpToolCallPrepare: ({
			toolId,
			arguments: argumentsValue,
			idempotencyKey,
		}) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("mcp.tool_call.prepare", () =>
					mcpService.prepareToolCall(user.id, {
						toolId,
						arguments: argumentsValue,
						idempotencyKey,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		McpToolCallApprove: ({ callId, arguments: argumentsValue }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("mcp.tool_call.approve", () =>
					mcpService.approveToolCall(user.id, {
						callId,
						arguments: argumentsValue,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		InteractiveAgentPreferencesGet: () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* fromPromise("agent.preferences.get", () =>
					getInteractiveAgentPreferences(user.id),
				);
			}),

		InteractiveAgentPreferencesUpdate: ({ approvalPolicy }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* fromPromise("agent.preferences.update", () =>
					updateInteractiveAgentPreferences({
						userId: user.id,
						approvalPolicy,
					}),
				);
			}),

		ConversationCreate: ({ title, initialMessage }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.create", () =>
					createConversation({
						userId: user.id,
						title,
						initialMessage,
					}),
				);
				return result;
			}),

		ConversationMessageAppend: ({ conversationId, content }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.message.append", () =>
					appendConversationMessage({
						userId: user.id,
						conversationId,
						content,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		ConversationsList: () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* fromPromise("conversations.list", () =>
					listConversationsForUser(user.id),
				);
			}),

		ConversationGet: ({ conversationId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.get", () =>
					getConversationForUser(user.id, conversationId),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		ConversationRename: ({ conversationId, title }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.rename", () =>
					renameConversationForUser({
						userId: user.id,
						conversationId,
						title,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		ConversationPinUpdate: ({ conversationId, pinned }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.pin_update", () =>
					setConversationPinnedForUser({
						userId: user.id,
						conversationId,
						pinned,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		ArchivedConversationsList: () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* fromPromise("conversations.archived_list", () =>
					listArchivedConversationsForUser(user.id),
				);
			}),

		ConversationArchiveUpdate: ({ conversationId, archived }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.archive_update", () =>
					setConversationArchivedForUser({ userId: user.id, conversationId, archived }),
				);
				if ("_tag" in result) return yield* Effect.fail(result);
				return result;
			}),

		ConversationDelete: ({ conversationId, confirmationTitle }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("conversation.delete", () =>
					deleteConversationForUser({ userId: user.id, conversationId, confirmationTitle }),
				);
				if (result && "_tag" in result) return yield* Effect.fail(result);
			}),

		ConversationInterviewAnswer: ({ conversationId, content, draft }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				if (!isRunBriefDraft(draft) || !content.trim()) {
					return yield* Effect.fail({
						_tag: "InvalidRequest" as const,
						message: "A valid deterministic interview answer is required.",
					});
				}
				const draftForSave: RunBriefDraft = {
					...draft,
					userApprovedFinalBrief: false,
				};
				const evaluation = evaluateRunBriefDraft(draftForSave);
				const acknowledgement = evaluation.writeToolAcknowledgementsRequired[0];
				const assistantMessage =
					evaluation.missingFields[0]?.prompt ??
					(acknowledgement
						? `What exact outcome may ${acknowledgement.toolName} create or change?`
						: "The Run Brief is complete. Review and approve this Automation when you are ready.");
				const result = yield* fromPromise("conversation.interview.answer", () =>
					saveRunBriefDraft({
						userId: user.id,
						conversationId,
						mode: draftForSave.mode,
						schemaVersion: draftForSave.schemaVersion,
						structuredBrief: toRecord(draftForSave),
						evaluation: toRecord(evaluation),
						runBriefState: evaluation.canCreateRunBriefVersion
							? "pending_approval"
							: "draft",
						conversationState: evaluation.conversationState,
						toolAuthorizations: selectedToolAuthorizations(draftForSave),
						userMessage: content,
						assistantMessage,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		ConversationModelTurn: ({ conversationId, content }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const detail = yield* fromPromise("conversation.model.load", () =>
					getConversationForUser(user.id, conversationId),
				);
				if ("_tag" in detail) {
					return yield* Effect.fail(detail);
				}
				const connections = yield* fromPromise(
					"conversation.model.connections",
					() => mcpService.listConnections(user.id),
				);
				const connected = connections.filter(
					(connection) => connection.status === "connected",
				);
				const toolGroups = yield* fromPromise("conversation.model.tools", () =>
					Promise.all(
						connected.map(
							async (connection) =>
								(await mcpService.listTools(user.id, connection.id)) ?? [],
						),
					),
				);
				const model = yield* fromPromise("conversation.model.respond", () =>
						runConversationModel({
							messages: [
								...detail.messages.map((message) => {
									const rawProposal = message.metadata.automationProposal;
									const proposal =
										rawProposal &&
										typeof rawProposal === "object" &&
										!Array.isArray(rawProposal)
											? normalizeAutomationProposal(
													rawProposal as Record<string, unknown>,
												)
											: null;
									return {
										role: message.role,
										content: message.content,
										...(proposal ? { automationProposal: proposal } : {}),
									};
								}),
							{ role: "user", content },
						],
						availableToolNames: toolGroups
							.flat()
							.filter((tool) => tool.enabled && tool.available)
							.map((tool) => tool.name),
					}),
				);
				const result = yield* fromPromise("conversation.model.persist", () =>
					appendConversationModelTurn({
						userId: user.id,
						conversationId,
						userContent: content,
						assistantContent: model.assistantMessage,
						assistantMetadata: model.automationProposal
							? { automationProposal: model.automationProposal }
							: {},
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		RunBriefDraftSave: ({ conversationId, draft }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				if (!isRunBriefDraft(draft)) {
					return yield* Effect.fail({
						_tag: "InvalidRequest" as const,
						message: "Run Brief draft is invalid.",
					});
				}

				const draftForSave: RunBriefDraft = {
					...draft,
					userApprovedFinalBrief: false,
				};
				const evaluation = evaluateRunBriefDraft(draftForSave);
				const result = yield* fromPromise("run_brief.draft.save", () =>
					saveRunBriefDraft({
						userId: user.id,
						conversationId,
						mode: draftForSave.mode,
						schemaVersion: draftForSave.schemaVersion,
						structuredBrief: toRecord(draftForSave),
						evaluation: toRecord(evaluation),
						runBriefState: evaluation.canCreateRunBriefVersion
							? "pending_approval"
							: "draft",
						conversationState: evaluation.conversationState,
						toolAuthorizations: selectedToolAuthorizations(draftForSave),
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				const acknowledgement = evaluation.writeToolAcknowledgementsRequired[0];
				const nextAssistantMessage =
					evaluation.missingFields[0]?.prompt ??
					(acknowledgement
						? `What exact outcome may ${acknowledgement.toolName} create or change?`
						: "The Run Brief is complete. Review and approve this Automation when you are ready.");
				yield* fromPromise("run_brief.interview_prompt.append", () =>
					appendConversationMessage({
						userId: user.id,
						conversationId,
						content: nextAssistantMessage,
						role: "assistant",
					}),
				);
				return result;
			}),

		RunBriefApprove: ({ runBriefVersionId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("run_brief.approve", () =>
					approveRunBriefVersion({
						userId: user.id,
						runBriefVersionId,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		ManualAgentRunStart: ({ runBriefVersionId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const approvedBrief = yield* fromPromise(
					"run_brief.fetch_for_run",
					() =>
						getApprovedRunBriefVersionForRunStart(user.id, runBriefVersionId),
				);
				if (!approvedBrief) {
					return yield* Effect.fail({
						_tag: "Conflict" as const,
						message: "Approve the Run Brief before starting an Agent Run.",
					});
				}

				const run = yield* fromPromise("manual_agent_run.create", () =>
					createManualAgentRun({
						userId: user.id,
						runBriefVersionId,
					}),
				);
				if ("_tag" in run) {
					return yield* Effect.fail(run);
				}

				const brief = approvedBrief.version
					.structuredBrief as unknown as RunBriefDraft;
				const workflowInput: RunWorkflowInput = {
					schemaVersion: "run-workflow-input.v1",
					runId: run.id,
					kind: "agent",
					ownerScope: {
						ownerType: approvedBrief.brief.ownerType,
						ownerId: approvedBrief.brief.ownerId,
					},
					conversationId: approvedBrief.brief.conversationId,
					runBriefVersionId: approvedBrief.version.id,
					automationId: null,
					automationVersionId: null,
					startedByUserId: user.id,
					triggerSource: null,
					runBudget: runBudgetForPreset(brief.runBudgetPreset),
					executionPolicy: {
						allowWaitingForUser: true,
						allowUnapprovedTools: false,
						requiredToolUnavailable:
							brief.unavailableRequiredToolBehavior ?? "retry_then_partial",
						optionalToolUnavailable: "continue_degraded",
					},
					modelExecutionProfile: {
						provider: "openai",
						model: process.env.OPENAI_MODEL ?? "gpt-5.5",
						settingsArtifactId: null,
						toolPolicyVersion: "tool-policy.v1",
					},
					initialCheckpointId: null,
				};

				const temporal = yield* fromPromise(
					"manual_agent_run.temporal.start",
					() => startRunWorkflow(workflowInput),
				);

				const updatedRun = yield* fromPromise(
					"manual_agent_run.temporal.persist",
					() =>
						updateRunTemporalIdentity({
							runId: run.id,
							temporalWorkflowId: temporal.workflowId,
							temporalRunId: temporal.runId,
						}),
				);

				return updatedRun ?? run;
			}),

		AgentRunGet: ({ runId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("agent_run.get", () =>
					getAgentRunDetailForUser(user.id, runId),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		AutomationsList: () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* fromPromise("automations.list", () =>
					listAutomationsForUser(user.id),
				);
			}),

		AutomationGet: ({ automationId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("automation.get", () =>
					getAutomationForUser(user.id, automationId),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				return result;
			}),

		AutomationApprove: ({ runBriefVersionId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const result = yield* fromPromise("automation.approve", () =>
					approveAutomationProposal({
						userId: user.id,
						runBriefVersionId,
					}),
				);
				if ("_tag" in result) {
					return yield* Effect.fail(result);
				}
				const schedule = toRecord(result.schedule);
				const scheduleKind =
					schedule.kind === "recurring" ? "recurring" : "manual_only";
				const normalizedRule =
					scheduleKind === "recurring"
						? normalizeRecurringScheduleRule(
								typeof schedule.rule === "string" ? schedule.rule : null,
							)
						: null;
				if (scheduleKind === "recurring" && !normalizedRule) {
					return yield* Effect.fail({
						_tag: "InvalidRequest" as const,
						message:
							"The recurring schedule could not be converted to a valid five-field cron rule.",
					});
				}
				const normalizedSchedule: Omit<
					AutomationScheduleInput,
					"automationId" | "automationVersionId"
				> = {
					kind: scheduleKind,
					timezone:
						typeof schedule.timezone === "string" ? schedule.timezone : "UTC",
					rule: normalizedRule,
					missedRunPolicy:
						schedule.missedRunPolicy === "backfill_if_enabled"
							? ("backfill_if_enabled" as const)
							: ("skip" as const),
					overlapPolicy:
						schedule.overlapPolicy === "queue_one" ||
						schedule.overlapPolicy === "cancel_old" ||
						schedule.overlapPolicy === "allow_overlap"
							? schedule.overlapPolicy
							: ("skip" as const),
				};
				const scheduleId = yield* fromPromise("automation.schedule.sync", () =>
					syncAutomationSchedule({
						automationId: result.automation.id,
						automationVersionId: result.currentVersionId,
						...normalizedSchedule,
					}),
				);
				yield* fromPromise("automation.schedule.persist", () =>
					setAutomationTemporalScheduleId({
						automationId: result.automation.id,
						automationVersionId: result.currentVersionId,
						temporalScheduleId: scheduleId,
						schedule: normalizedSchedule,
					}),
				);
				const reloaded = yield* fromPromise("automation.approve.reload", () =>
					getAutomationForUser(user.id, result.automation.id),
				);
				if ("_tag" in reloaded) {
					return yield* Effect.fail(reloaded);
				}
				return reloaded;
			}),

		AutomationRunNow: ({ automationId }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const created = yield* fromPromise("automation.run_now.create", () =>
					createAutomationRunNow({ userId: user.id, automationId }),
				);
				if ("_tag" in created) {
					return yield* Effect.fail(created);
				}

				const workflowInput: RunWorkflowInput = {
					schemaVersion: "run-workflow-input.v1",
					runId: created.run.id,
					kind: "automation",
					ownerScope: created.workflow.ownerScope,
					conversationId: created.workflow.conversationId,
					runBriefVersionId: created.workflow.runBriefVersionId,
					automationId: created.workflow.automationId,
					automationVersionId: created.workflow.automationVersionId,
					startedByUserId: user.id,
					triggerSource: "manual",
					runBudget: created.workflow.runBudget,
					executionPolicy: {
						allowWaitingForUser: false,
						allowUnapprovedTools: false,
						requiredToolUnavailable: created.workflow.requiredToolUnavailable,
						optionalToolUnavailable: "continue_degraded",
					},
					modelExecutionProfile: {
						provider: "openai",
						model: process.env.OPENAI_MODEL ?? "gpt-5.5",
						settingsArtifactId: null,
						toolPolicyVersion: "tool-policy.v1",
					},
					initialCheckpointId: null,
				};
				const temporal = yield* fromPromise("automation.run_now.temporal", () =>
					startRunWorkflow(workflowInput),
				);
				yield* fromPromise("automation.run_now.persist_temporal", () =>
					updateRunTemporalIdentity({
						runId: created.run.id,
						temporalWorkflowId: temporal.workflowId,
						temporalRunId: temporal.runId,
					}),
				);

				return {
					...created.run,
					temporalWorkflowId: temporal.workflowId,
					temporalRunId: temporal.runId,
				};
			}),
	}),
);

const RpcLive = Layer.mergeAll(
	HandlersLive,
	AuthLive,
	RpcSerialization.layerNdjson,
	HttpServer.layerContext,
);

export const rpcServer = RpcServer.toWebHandler(AgentsRpcs, {
	layer: RpcLive,
});
