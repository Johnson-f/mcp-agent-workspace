import {
  executeStreamingTextModel,
  type ModelReasoningSummaryEvent,
  executeTextModel,
} from "./bridge/model-provider";
import { normalizeRecurringScheduleRule } from "./schedule-rule";

export interface AutomationProposal {
	goal: string;
	successCriteria: string[];
	expectedOutput: string | null;
	schedule: {
		kind: "manual_only" | "recurring";
		timezone: string | null;
		rule: string | null;
	} | null;
	suggestedToolNames: string[];
}

export interface ConversationModelMessage {
	role: "user" | "assistant" | "system";
	content: string;
	automationProposal?: AutomationProposal;
}

export type ConversationMode = "chat" | "automation";

const stringArray = (value: unknown) =>
	Array.isArray(value)
		? value
				.filter((item): item is string => typeof item === "string")
				.map((item) => item.trim())
				.filter(Boolean)
				.slice(0, 20)
		: [];

export const normalizeAutomationProposal = (
	value: Record<string, unknown>,
): AutomationProposal | null => {
	const goal = typeof value.goal === "string" ? value.goal.trim() : "";
	if (!goal) {
		return null;
	}

	const scheduleValue =
		value.schedule && typeof value.schedule === "object"
			? (value.schedule as Record<string, unknown>)
			: null;
	const schedule = scheduleValue
		? {
				kind:
					scheduleValue.kind === "recurring"
						? ("recurring" as const)
						: ("manual_only" as const),
				timezone:
					typeof scheduleValue.timezone === "string" &&
					scheduleValue.timezone.trim()
						? scheduleValue.timezone.trim()
						: null,
				rule:
					typeof scheduleValue.rule === "string" && scheduleValue.rule.trim()
						? normalizeRecurringScheduleRule(scheduleValue.rule)
						: null,
			}
		: null;

	return {
		goal: goal.slice(0, 2_000),
		successCriteria: stringArray(value.successCriteria),
		expectedOutput:
			typeof value.expectedOutput === "string" && value.expectedOutput.trim()
				? value.expectedOutput.trim().slice(0, 2_000)
				: null,
		schedule,
		suggestedToolNames: stringArray(value.suggestedToolNames),
	};
};

export const normalizeConversationTitle = (value: string) => {
  const normalized = value
    .trim()
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 80);
};

const proposalTool = {
	name: "propose_automation",
	description:
		"Create or revise a reviewable Automation proposal only after discovery has gathered a concrete goal, success criteria, expected output, schedule preference, and relevant tool or data boundaries, or when the user explicitly asks to create the proposal now. This never approves or activates the Automation.",
	strict: false,
	parameters: {
		type: "object",
		additionalProperties: false,
		required: ["goal"],
		properties: {
			goal: { type: "string" },
			successCriteria: { type: "array", items: { type: "string" } },
			expectedOutput: { type: ["string", "null"] },
			schedule: {
				anyOf: [
					{ type: "null" },
					{
						type: "object",
						additionalProperties: false,
						required: ["kind"],
						properties: {
							kind: { type: "string", enum: ["manual_only", "recurring"] },
							timezone: { type: ["string", "null"] },
							rule: {
								type: ["string", "null"],
								description:
									"For recurring Automations, use a canonical five-field cron expression, such as 0 9 * * * for daily at 9:00 AM.",
							},
						},
					},
				],
			},
			suggestedToolNames: { type: "array", items: { type: "string" } },
		},
	},
};

const conversationInstructions = `You are Agents, a natural conversational AI assistant.
Respond normally to greetings, questions, brainstorming, and one-off requests.
When the user clearly wants work that should be reusable, repeatable, runnable on demand, or scheduled, call propose_automation.
The tool creates only a proposal. Never claim that an Automation is approved, live, scheduled, or allowed to use tools.
Do not call propose_automation for ordinary conversation or a one-off answer unless the user asks to save or automate it.
Keep replies concise and helpful.`;

const instructionsForMode = (mode: ConversationMode) =>
  mode === "automation"
    ? `${conversationInstructions}
The user selected Automation discovery mode. Help them shape an accurate reusable workflow through natural back-and-forth conversation.
Ask one focused question at a time. Use the complete conversation history and do not repeat questions already answered.
Before calling propose_automation, gather a concrete goal, observable success criteria, expected output, whether it runs on demand or on a schedule, and the relevant tool or data boundaries.
Do not call propose_automation for vague brainstorming, option exploration, or while consequential details remain unclear.
Call propose_automation when the required context is explicit, when the user confirms the summarized workflow, or when the user explicitly says to create the proposal now.
If a prior proposal appears in the history and the user refines it, call propose_automation with a complete revised proposal.
Never claim the proposal is active or approved.`
    : conversationInstructions;

const fallbackTextForMode = (mode: ConversationMode) =>
  mode === "automation"
    ? "What exact outcome should this Automation produce for you?"
    : "I'm here. Tell me what you'd like to work on, or describe something you want to automate.";

export const runConversationModel = async (input: {
	messages: ConversationModelMessage[];
	availableToolNames: string[];
	mode?: ConversationMode;
}) => {
	const mode = input.mode ?? "chat";
	const boundedMessages = input.messages.slice(-40).map((message) => ({
		role: message.role,
		content: message.content.slice(0, 10_000),
		...(message.automationProposal
			? { automationProposal: message.automationProposal }
			: {}),
	}));
	const prompt = [
		"Conversation history JSON:",
		JSON.stringify(boundedMessages),
		"Available MCP tool names (suggestions only; the user must approve them):",
		JSON.stringify(input.availableToolNames.slice(0, 100)),
		"Respond to the latest user message.",
	].join("\n\n");
	const first = await executeTextModel({
		provider: "openai",
		model: process.env.OPENAI_MODEL ?? "gpt-5.5",
		prompt,
		instructions: instructionsForMode(mode),
		tools: [proposalTool],
		fallbackText: fallbackTextForMode(mode),
	});
	const call = first.functionCalls.find(
		(candidate) => candidate.name === proposalTool.name,
	);
  const proposal = call ? normalizeAutomationProposal(call.arguments) : null;
  if (!proposal) {
    return {
      assistantMessage:
        first.text.trim() ||
        "I couldn't understand that response. Tell me a little more about what you'd like to do.",
      automationProposal: null,
    };
  }

	if (first.text.trim()) {
		return {
			assistantMessage: first.text.trim(),
			automationProposal: proposal,
		};
	}

	const summary = await executeTextModel({
		provider: "openai",
		model: process.env.OPENAI_MODEL ?? "gpt-5.5",
		prompt: `The user requested this Automation proposal:\n${JSON.stringify(proposal)}\nExplain briefly that you prepared a proposal for their review and that nothing is active until they approve it.`,
		instructions: conversationInstructions,
		fallbackText:
			"I prepared an Automation proposal for your review. Nothing will run or use tools until you confirm its details and approve it.",
	});
	return {
		assistantMessage: summary.text,
		automationProposal: proposal,
	};
};

export type ConversationModelStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "reasoning_summary"; event: ModelReasoningSummaryEvent }
  | { type: "automation_proposal"; proposal: AutomationProposal };

export const streamConversationModel = async (input: {
  messages: ConversationModelMessage[];
  availableToolNames: string[];
  mode?: ConversationMode;
  signal?: AbortSignal;
  onEvent: (event: ConversationModelStreamEvent) => void | Promise<void>;
}) => {
  const mode = input.mode ?? "chat";
  const boundedMessages = input.messages.slice(-40).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 10_000),
    ...(message.automationProposal
      ? { automationProposal: message.automationProposal }
      : {}),
  }));
  const prompt = [
    "Conversation history JSON:",
    JSON.stringify(boundedMessages),
    "Available MCP tool names (suggestions only; the user must approve them):",
    JSON.stringify(input.availableToolNames.slice(0, 100)),
    "Respond to the latest user message.",
  ].join("\n\n");
  const first = await executeStreamingTextModel(
    {
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-5.5",
      prompt,
      instructions: instructionsForMode(mode),
      tools: [proposalTool],
      fallbackText: fallbackTextForMode(mode),
    },
    {
      signal: input.signal,
      onTextDelta: (delta) => input.onEvent({ type: "text_delta", delta }),
      onReasoningSummaryEvent: (event) =>
        input.onEvent({ type: "reasoning_summary", event }),
    },
  );
  const call = first.functionCalls.find(
    (candidate) => candidate.name === proposalTool.name,
  );
  const proposal = call ? normalizeAutomationProposal(call.arguments) : null;
  if (!proposal) {
    return {
      assistantMessage:
        first.text.trim() ||
        "I couldn't understand that response. Tell me a little more about what you'd like to do.",
      automationProposal: null,
    };
  }
  await input.onEvent({ type: "automation_proposal", proposal });
  if (first.text.trim()) {
    return { assistantMessage: first.text.trim(), automationProposal: proposal };
  }

  const summary = await executeStreamingTextModel(
    {
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-5.5",
      prompt: `The user requested this Automation proposal:\n${JSON.stringify(proposal)}\nExplain briefly that you prepared a proposal for their review and that nothing is active until they approve it.`,
      instructions: conversationInstructions,
      fallbackText:
        "I prepared an Automation proposal for your review. Nothing will run or use tools until you confirm its details and approve it.",
    },
    {
      signal: input.signal,
      onTextDelta: (delta) => input.onEvent({ type: "text_delta", delta }),
      onReasoningSummaryEvent: (event) =>
        input.onEvent({ type: "reasoning_summary", event }),
    },
  );
  return { assistantMessage: summary.text, automationProposal: proposal };
};

export const generateConversationTitle = async (firstMessage: string) => {
  const fallback = normalizeConversationTitle(firstMessage) || "New conversation";
  const result = await executeTextModel({
    provider: "openai",
    model: process.env.OPENAI_MODEL ?? "gpt-5.5",
    instructions:
      "Generate only a concise sentence-case conversation title. Use 3 to 80 characters. Do not use quotes, markdown, labels, or trailing punctuation.",
    prompt: firstMessage.slice(0, 10_000),
    fallbackText: fallback,
  });
  return normalizeConversationTitle(result.text) || fallback;
};
