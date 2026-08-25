"use client";

import {
  type ConversationDetail,
  createEmptyRunBriefDraft,
  getMcpToolCapability,
  isRunBriefDraft,
  type McpTool,
  type McpToolAnnotations,
  type RunBriefDraft,
  resolveConversationModeForMessage,
} from "@agents/contracts";
import {
  ArchiveRestore,
  ArrowUp,
  Check,
  CircleCheck,
  LoaderCircle,
  SendHorizontal,
  Settings2,
  Sparkles,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConversationActivityTimeline } from "@/components/conversation-activity-timeline";
import { ConversationModeSelect } from "@/components/conversation-mode-select";
import { MarkdownMessage } from "@/components/markdown-message";
import { MessageCopyAction } from "@/components/message-copy-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useConversationMode } from "@/hooks/use-conversation-mode";
import {
  pendingConversationMessageKey,
  pendingConversationModeKey,
  useConversationWebSocket,
} from "@/hooks/use-conversation-websocket";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { shouldSubmitComposerKey } from "@/lib/composer-keyboard";
import { normalizeConversationMode } from "@/lib/conversation-mode";
import { agentsRpc } from "@/lib/rpc";
import {
  automationApprovalDestination,
  conversationAutomationSurface,
  conversationNextAction,
  resolveSuggestedAutomationTools,
  shouldApproveRunBriefBeforeAutomation,
} from "../conversation-view-model";

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const annotationsFor = (tool: McpTool): McpToolAnnotations | null =>
  tool.annotations && typeof tool.annotations === "object"
    ? (tool.annotations as McpToolAnnotations)
    : null;

const draftFromDetail = (detail: ConversationDetail): RunBriefDraft => {
  const version = detail.currentRunBriefVersion as {
    structuredBrief?: unknown;
  } | null;
  return isRunBriefDraft(version?.structuredBrief)
    ? version.structuredBrief
    : createEmptyRunBriefDraft("automation");
};

const versionIdFromDetail = (detail: ConversationDetail) => {
  const version = detail.currentRunBriefVersion as { id?: unknown } | null;
  return typeof version?.id === "string" ? version.id : null;
};

const versionStateFromDetail = (detail: ConversationDetail) => {
  const version = detail.currentRunBriefVersion as { state?: unknown } | null;
  return typeof version?.state === "string" ? version.state : null;
};

interface ModelAutomationProposal {
  goal: string;
  successCriteria?: string[];
  expectedOutput?: string | null;
  schedule?: {
    kind: "manual_only" | "recurring";
    timezone: string | null;
    rule: string | null;
  } | null;
  suggestedToolNames?: string[];
}

const latestAutomationProposal = (
  detail: ConversationDetail,
): ModelAutomationProposal | null => {
  for (const message of [...detail.messages].reverse()) {
    const proposal = message.metadata.automationProposal;
    if (
      proposal &&
      typeof proposal === "object" &&
      "goal" in proposal &&
      typeof proposal.goal === "string"
    ) {
      return proposal as ModelAutomationProposal;
    }
  }
  return null;
};

const persistedAgentToolCalls = (metadata: Record<string, unknown>) =>
  Array.isArray(metadata.agentToolCalls)
    ? metadata.agentToolCalls.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const record = value as Record<string, unknown>;
        return typeof record.callId === "string" &&
          typeof record.toolName === "string" &&
          typeof record.status === "string"
          ? [
              {
                callId: record.callId,
                toolName: record.toolName,
                status: record.status,
                isError: record.isError === true,
              },
            ]
          : [];
      })
    : [];

export function ConversationClient({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const { isInitialized, session } = useAuthSession();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState<RunBriefDraft>(() =>
    createEmptyRunBriefDraft("automation"),
  );
  const [tools, setTools] = useState<readonly McpTool[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [answer, setAnswer] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [scheduleKind, setScheduleKind] = useState<"manual_only" | "recurring">(
    "manual_only",
  );
  const [scheduleTimezone, setScheduleTimezone] = useState("UTC");
  const [scheduleRule, setScheduleRule] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { mode, setMode } = useConversationMode();

  const load = useCallback(async () => {
    const nextDetail = await agentsRpc.getConversation(conversationId);
    const nextDraft = draftFromDetail(nextDetail);
    setDetail(nextDetail);
    setDraft(nextDraft);
    setSelectedToolIds(
      new Set(
        [...nextDraft.requiredTools, ...nextDraft.optionalTools].map(
          (tool) => tool.mcpToolId,
        ),
      ),
    );
    setScheduleKind(nextDraft.schedule?.kind ?? "manual_only");
    setScheduleTimezone(nextDraft.schedule?.timezone ?? "UTC");
    setScheduleRule(nextDraft.schedule?.rule ?? "");
  }, [conversationId]);

  const loadTools = useCallback(async () => {
    const nextConnections = await agentsRpc.listConnections();
    const connected = nextConnections.filter(
      (connection) => connection.status === "connected",
    );
    const groups = await Promise.all(
      connected.map((connection) => agentsRpc.listTools(connection.id)),
    );
    setTools(
      groups
        .flat()
        .filter((tool) => tool.enabled && tool.available)
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }, []);

  const updateConversationTitle = useCallback((title: string) => {
    setDetail((current) =>
      current
        ? {
            ...current,
            conversation: { ...current.conversation, title },
          }
        : current,
    );
  }, []);

  const stream = useConversationWebSocket({
    conversationId,
    onCompleted: load,
    onTitle: updateConversationTitle,
  });
  const pendingMessageSent = useRef(false);

  useEffect(() => {
    if (!stream.connected || pendingMessageSent.current) return;
    const key = pendingConversationMessageKey(conversationId);
    const modeKey = pendingConversationModeKey(conversationId);
    const pendingMessage = sessionStorage.getItem(key)?.trim();
    if (!pendingMessage) return;
    pendingMessageSent.current = true;
    const pendingMode = resolveConversationModeForMessage(
      normalizeConversationMode(sessionStorage.getItem(modeKey)),
      pendingMessage,
    );
    setMode(pendingMode);
    if (stream.sendMessage(pendingMessage, pendingMode)) {
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(modeKey);
    } else {
      pendingMessageSent.current = false;
    }
  }, [conversationId, setMode, stream.connected, stream.sendMessage]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
    if (!session) {
      if (!isDevAuthEnabled()) {
        router.replace("/login");
      }
      return;
    }
    Promise.all([load(), loadTools()]).catch((requestError) =>
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The Conversation could not be loaded.",
      ),
    );
  }, [isInitialized, load, loadTools, router, session]);

  const action = useMemo(() => conversationNextAction(draft), [draft]);

  const persistDraft = async (
    nextDraft: RunBriefDraft,
    userMessage: string,
  ) => {
    setSaving(true);
    setError(null);
    try {
      await agentsRpc.answerConversation({
        conversationId,
        content: userMessage,
        draft: nextDraft,
      });
      setAnswer("");
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The answer could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitTextAnswer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = answer.trim();
    if (!value || action.kind === "review_automation") {
      return;
    }

    let nextDraft = draft;
    if (action.kind === "acknowledge_write_tool") {
      nextDraft = {
        ...draft,
        requiredTools: draft.requiredTools.map((tool) =>
          tool.id === action.toolAuthorizationId
            ? {
                ...tool,
                acknowledgedWriteCapability: true,
                allowedOutcomeBoundary: value,
              }
            : tool,
        ),
      };
    } else {
      switch (action.field) {
        case "goal":
          nextDraft = { ...draft, goal: value };
          break;
        case "successCriteria":
          nextDraft = { ...draft, successCriteria: lines(value) };
          break;
        case "expectedOutput":
          nextDraft = { ...draft, expectedOutput: value };
          break;
        default:
          return;
      }
    }
    await persistDraft(nextDraft, value);
  };

  const confirmTools = async () => {
    const fallbackResolution = resolveSuggestedAutomationTools(
      tools,
      detail
        ? (latestAutomationProposal(detail)?.suggestedToolNames ?? [])
        : [],
    );
    const effectiveSelectedToolIds =
      selectedToolIds.size > 0
        ? selectedToolIds
        : new Set(fallbackResolution.selected.map((tool) => tool.id));
    const selected = tools.filter((tool) =>
      effectiveSelectedToolIds.has(tool.id),
    );
    if (selected.length === 0) {
      setError("Select at least one tool.");
      return;
    }
    const requiredTools = selected.map((tool) => {
      const annotations = annotationsFor(tool);
      const capability = getMcpToolCapability(annotations);
      return {
        id: `tool_auth_${tool.id}`,
        mcpConnectionId: tool.connectionId,
        mcpToolId: tool.id,
        toolName: tool.name,
        displayName: tool.title,
        description: tool.description,
        required: true,
        reason: `Required to satisfy this Automation: ${draft.goal ?? "approved goal"}`,
        annotations,
        state: "approved" as const,
        acknowledgedWriteCapability: !capability.writeCapable,
        allowedOutcomeBoundary: null,
      };
    });
    await persistDraft(
      { ...draft, requiredTools, optionalTools: [] },
      `Selected tools: ${selected.map((tool) => tool.name).join(", ")}`,
    );
    setShowToolEditor(false);
    setShowAllTools(false);
  };

  const confirmInAppOutput = () =>
    persistDraft(
      {
        ...draft,
        outputDestination: {
          kind: "in_app",
          destinationRef: null,
          authorized: true,
        },
      },
      "Keep every result in the Agents workspace.",
    );

  const saveSchedule = () => {
    if (scheduleKind === "recurring" && !scheduleRule.trim()) {
      setError("Enter a recurrence rule before saving the schedule.");
      return;
    }
    return persistDraft(
      {
        ...draft,
        schedule: {
          kind: scheduleKind,
          timezone: scheduleTimezone.trim() || "UTC",
          rule: scheduleKind === "recurring" ? scheduleRule.trim() : null,
          missedRunPolicy: "skip",
          overlapPolicy: "skip",
        },
      },
      scheduleKind === "recurring"
        ? `Schedule: ${scheduleRule.trim()} (${scheduleTimezone.trim() || "UTC"})`
        : "No schedule. I will run this Automation on demand.",
    );
  };

  const approve = async () => {
    if (!detail) {
      return;
    }
    const versionId = versionIdFromDetail(detail);
    if (!versionId) {
      setError("Save the completed Run Brief before approval.");
      return;
    }
    setApproving(true);
    try {
      const versionState = versionStateFromDetail(detail);
      if (shouldApproveRunBriefBeforeAutomation(versionState)) {
        await agentsRpc.approveRunBrief(versionId);
      } else if (versionState !== "approved") {
        throw new Error("This Run Brief is not ready for approval.");
      }
      const automation = await agentsRpc.approveAutomation(versionId);
      router.push(automationApprovalDestination(automation.automation.id));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The Automation could not be approved.",
      );
      await load();
    } finally {
      setApproving(false);
    }
  };

  const sendChatMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (detail?.conversation.archivedAt) return;
    const content = chatMessage.trim();
    if (!content) return;
    setError(null);
    const effectiveMode = resolveConversationModeForMessage(mode, content);
    setMode(effectiveMode);
    if (stream.sendMessage(content, effectiveMode)) {
      setChatMessage("");
      return;
    }
    setError("The live connection is not ready yet. Try again in a moment.");
  };

  if (!detail) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-72 w-full rounded-[22px]" />
      </div>
    );
  }

  const asksForTools =
    action.kind === "ask_missing_field" && action.field === "tools";
  const asksForOutput =
    action.kind === "ask_missing_field" && action.field === "outputDestination";
  const asksForSchedule =
    action.kind === "ask_missing_field" && action.field === "schedule";
  const acceptsText =
    action.kind === "acknowledge_write_tool" ||
    (action.kind === "ask_missing_field" &&
      ["goal", "successCriteria", "expectedOutput"].includes(action.field));
  const configurationPrompt =
    action.kind === "review_automation" ? "" : action.prompt;
  const modelProposal =
    (stream.state.automationProposal as ModelAutomationProposal | null) ??
    latestAutomationProposal(detail);
  const hasRunBrief = versionIdFromDetail(detail) !== null;
  const archived = detail.conversation.archivedAt !== null;
  const automationSurface = conversationAutomationSurface({
    hasAutomationProposal: modelProposal !== null,
    hasRunBrief,
  });
  const proposalToolResolution = resolveSuggestedAutomationTools(
    tools,
    modelProposal?.suggestedToolNames ?? [],
  );
  const proposalToolNames = new Set(modelProposal?.suggestedToolNames ?? []);
  const toolsForReview =
    showAllTools || proposalToolNames.size === 0
      ? tools
      : tools.filter((tool) => proposalToolNames.has(tool.name));
  const reviewSelectedToolIds =
    selectedToolIds.size > 0
      ? selectedToolIds
      : new Set(proposalToolResolution.selected.map((tool) => tool.id));

  const acceptModelProposal = async () => {
    if (!modelProposal) return;
    const proposalSchedule = modelProposal.schedule;
    const acceptedSchedule =
      proposalSchedule?.kind === "manual_only"
        ? {
            kind: "manual_only" as const,
            timezone: proposalSchedule.timezone ?? "UTC",
            rule: null,
            missedRunPolicy: "skip" as const,
            overlapPolicy: "skip" as const,
          }
        : proposalSchedule?.kind === "recurring" &&
            proposalSchedule.timezone &&
            proposalSchedule.rule
          ? {
              kind: "recurring" as const,
              timezone: proposalSchedule.timezone,
              rule: proposalSchedule.rule,
              missedRunPolicy: "skip" as const,
              overlapPolicy: "skip" as const,
            }
          : null;
    const allSuggestedToolsResolved =
      proposalToolResolution.selected.length > 0 &&
      proposalToolResolution.unresolvedNames.length === 0;
    const requiredTools = allSuggestedToolsResolved
      ? proposalToolResolution.selected.map((tool) => {
          const annotations = annotationsFor(tool);
          const capability = getMcpToolCapability(annotations);
          return {
            id: `tool_auth_${tool.id}`,
            mcpConnectionId: tool.connectionId,
            mcpToolId: tool.id,
            toolName: tool.name,
            displayName: tool.title,
            description: tool.description,
            required: true,
            reason: `Selected by the AI for this Automation: ${modelProposal.goal}`,
            annotations,
            state: "approved" as const,
            acknowledgedWriteCapability: !capability.writeCapable,
            allowedOutcomeBoundary: null,
          };
        })
      : [];
    setSelectedToolIds(
      new Set(proposalToolResolution.selected.map((tool) => tool.id)),
    );
    await persistDraft(
      {
        ...createEmptyRunBriefDraft("automation"),
        goal: modelProposal.goal,
        successCriteria: modelProposal.successCriteria ?? [],
        expectedOutput: modelProposal.expectedOutput ?? null,
        schedule: acceptedSchedule,
        requiredTools,
      },
      requiredTools.length > 0
        ? `Use this Automation proposal with AI-selected tools: ${requiredTools.map((tool) => tool.toolName).join(", ")}.`
        : "Use this Automation proposal as the draft.",
    );
  };

  const activityGroupForMessage = (
    message: ConversationDetail["messages"][number],
  ) => {
    const turnId =
      typeof message.metadata.turnId === "string"
        ? message.metadata.turnId
        : null;
    return detail.activities.find(
      (group) =>
        group.assistantMessageId === message.id ||
        (turnId !== null && group.turnId === turnId),
    );
  };

  return (
    <main className="min-h-full bg-white">
      <div className="mx-auto flex min-h-[calc(100svh-3.75rem)] w-full max-w-[48rem] flex-col px-4 sm:px-8">
        <div className="flex-1 space-y-8 pb-12 pt-10 sm:pt-14">
          {archived ? (
            <section className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <ArchiveRestore className="size-4 shrink-0" />
              <span className="flex-1">
                Archived conversation · Restore it to continue messaging or
                configuration.
              </span>
              <Button
                className="h-8 rounded-lg"
                onClick={async () => {
                  await agentsRpc.setConversationArchived(
                    conversationId,
                    false,
                  );
                  await load();
                }}
                type="button"
                variant="outline"
              >
                Restore
              </Button>
            </section>
          ) : null}
          {detail.messages.map((message) => {
            const activityGroup = activityGroupForMessage(message);
            return (
              <div
                className={
                  message.role === "assistant"
                    ? "group/message text-[15px] leading-7 text-[#302f2c]"
                    : "group/message flex flex-col items-end"
                }
                key={message.id}
              >
                <div
                  className={
                    message.role === "assistant"
                      ? "min-w-0"
                      : "max-w-[85%] whitespace-pre-wrap rounded-[18px] bg-[#f3f3f0] px-4 py-2.5 text-[15px] leading-6 text-[#302f2c]"
                  }
                >
                  {message.role === "assistant" && activityGroup ? (
                    <ConversationActivityTimeline
                      activities={activityGroup.activities}
                    />
                  ) : null}
                  {message.role === "assistant"
                    ? !activityGroup
                      ? persistedAgentToolCalls(message.metadata).map(
                          (call) => (
                            <div
                              className="mb-3 flex items-center gap-2 rounded-xl border border-black/[0.07] bg-[#fafaf8] px-3 py-2 text-xs text-[#65635e]"
                              key={call.callId}
                            >
                              {call.status === "completed" && !call.isError ? (
                                <CircleCheck className="size-3.5 text-[#66836b]" />
                              ) : (
                                <X className="size-3.5 text-[#a35d52]" />
                              )}
                              <span className="font-medium text-[#403f3b]">
                                {call.toolName}
                              </span>
                              <span className="capitalize">{call.status}</span>
                            </div>
                          ),
                        )
                      : null
                    : null}
                  {message.role === "assistant" ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
                <MessageCopyAction
                  align={message.role === "assistant" ? "left" : "right"}
                  content={message.content}
                />
              </div>
            );
          })}
          {stream.state.optimisticUserText ? (
            <div className="group/message flex flex-col items-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-[18px] bg-[#f3f3f0] px-4 py-2.5 text-[15px] leading-6 text-[#302f2c]">
                {stream.state.optimisticUserText}
              </div>
              <MessageCopyAction
                align="right"
                content={stream.state.optimisticUserText}
              />
            </div>
          ) : null}
          <ConversationActivityTimeline
            active={stream.active}
            activities={stream.state.activities}
          />
          {stream.state.pendingApproval ? (
            <section className="rounded-[18px] border border-[#d6b989] bg-[#fffdf8] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f6ead5] text-[#9a6a28]">
                  <TriangleAlert className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-[#302f2c]">
                    Allow {stream.state.pendingApproval.toolName}?
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[#6e6b64]">
                    {stream.state.pendingApproval.reason}
                  </p>
                  <p className="mt-1 text-[11px] text-[#8a8882]">
                    {stream.state.pendingApproval.connectionName} ·{" "}
                    {stream.state.pendingApproval.risk} risk
                  </p>
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-black/[0.035] p-3 text-[11px] leading-5 text-[#55534e]">
                    {JSON.stringify(
                      stream.state.pendingApproval.argumentsPreview,
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() =>
                    stream.sendToolDecision(
                      "deny",
                      stream.state.pendingApproval?.turnId ?? "",
                      stream.state.pendingApproval?.callId ?? "",
                    )
                  }
                  type="button"
                  variant="outline"
                >
                  Deny
                </Button>
                <Button
                  className="h-8 rounded-lg bg-[#262624] px-3 text-xs text-white hover:bg-black"
                  onClick={() =>
                    stream.sendToolDecision(
                      "approve",
                      stream.state.pendingApproval?.turnId ?? "",
                      stream.state.pendingApproval?.callId ?? "",
                    )
                  }
                  type="button"
                >
                  Allow once
                </Button>
              </div>
            </section>
          ) : null}
          {stream.active || stream.state.assistantText ? (
            <div
              aria-live="polite"
              className="group/message text-[15px] leading-7 text-[#302f2c]"
            >
              <div className="min-w-0">
                {stream.state.assistantText ? (
                  <MarkdownMessage content={stream.state.assistantText} />
                ) : (
                  <LoaderCircle className="mt-1 size-4 animate-spin text-[#8c8a85]" />
                )}
              </div>
              {stream.state.assistantText ? (
                <MessageCopyAction
                  align="left"
                  content={stream.state.assistantText}
                />
              ) : null}
            </div>
          ) : null}
          {stream.state.status === "failed" ? (
            <p className="text-xs text-red-600">{stream.state.error}</p>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {automationSurface === "proposal" && modelProposal ? (
            <section className="rounded-[18px] border border-black/[0.09] bg-[#fafaf8] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.025)]">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-[#f4e7df] text-[#c96745]">
                  <Sparkles className="size-3.5" />
                </span>
                <h2 className="text-sm font-semibold text-[#302f2c]">
                  Automation draft
                </h2>
              </div>
              <p className="mt-4 text-[15px] leading-6 text-[#44423e]">
                {modelProposal.goal}
              </p>
              {modelProposal.schedule ? (
                <p className="mt-2 text-xs leading-5 text-[#77756f]">
                  {modelProposal.schedule.kind === "recurring"
                    ? `Suggested schedule: ${modelProposal.schedule.rule ?? "needs a rule"} · ${modelProposal.schedule.timezone ?? "needs a timezone"}`
                    : "Run on demand"}
                </p>
              ) : null}
              {modelProposal.suggestedToolNames?.length ? (
                <p className="mt-1 text-xs leading-5 text-[#77756f]">
                  May need: {modelProposal.suggestedToolNames.join(", ")}
                </p>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-4 border-t border-black/[0.06] pt-4">
                <p className="text-xs text-[#8a8882]">
                  Keep chatting to refine this draft, or configure it when the
                  details are right.
                </p>
                <Button
                  className="h-8 shrink-0 rounded-lg bg-[#262624] px-3 text-xs text-white hover:bg-black"
                  disabled={saving || stream.active}
                  onClick={() => void acceptModelProposal()}
                  type="button"
                >
                  Configure automation
                </Button>
              </div>
            </section>
          ) : null}

          {automationSurface === "configuration" ? (
            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-black/[0.07]" />
              <span className="text-xs font-medium text-[#77756f]">
                Configure automation
              </span>
              <div className="h-px flex-1 bg-black/[0.07]" />
            </div>
          ) : null}

          {automationSurface === "configuration" &&
          (asksForTools || showToolEditor) ? (
            <div className="rounded-[18px] border border-black/[0.09] bg-[#fafaf8] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[#34332f]">
                    AI-selected tools
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#77756f]">
                    Review the smallest tool set inferred from this
                    conversation.
                  </p>
                </div>
                {proposalToolNames.size > 0 ? (
                  <Button
                    className="h-8 shrink-0 rounded-lg text-xs"
                    onClick={() => setShowAllTools((current) => !current)}
                    type="button"
                    variant="outline"
                  >
                    {showAllTools ? "Show selected" : "Edit tools"}
                  </Button>
                ) : null}
              </div>
              {proposalToolResolution.unresolvedNames.length > 0 ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  These suggested tools are unavailable or ambiguous:{" "}
                  {proposalToolResolution.unresolvedNames.join(", ")}.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {toolsForReview.map((tool) => {
                  const selected = reviewSelectedToolIds.has(tool.id);
                  return (
                    <button
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                        selected
                          ? "border-[#2c2b29] bg-[#2c2b29] text-white"
                          : "border-black/[0.1] bg-white text-[#4f4d48]"
                      }`}
                      key={tool.id}
                      onClick={() =>
                        setSelectedToolIds((current) => {
                          const next = new Set(
                            current.size > 0 ? current : reviewSelectedToolIds,
                          );
                          if (next.has(tool.id)) next.delete(tool.id);
                          else next.add(tool.id);
                          return next;
                        })
                      }
                      type="button"
                    >
                      <Wrench className="size-3.5" />
                      {tool.name}
                      {selected ? <Check className="size-3.5" /> : null}
                    </button>
                  );
                })}
              </div>
              <Button
                className="mt-4 rounded-lg"
                disabled={saving || reviewSelectedToolIds.size === 0}
                onClick={() => void confirmTools()}
                type="button"
              >
                Confirm selected tools
              </Button>
            </div>
          ) : null}

          {automationSurface === "configuration" && asksForOutput ? (
            <div className="rounded-[18px] border border-black/[0.09] bg-[#fafaf8] p-5">
              <p className="text-sm text-[#4f4d48]">
                Keep results in the workspace. External delivery can be added as
                a new approved version later.
              </p>
              <Button
                className="mt-4 rounded-lg"
                disabled={saving}
                onClick={() => void confirmInAppOutput()}
                type="button"
              >
                Keep results in app
              </Button>
            </div>
          ) : null}

          {automationSurface === "configuration" &&
          action.kind === "review_automation" &&
          !showToolEditor ? (
            <div className="rounded-[18px] border border-black/[0.09] bg-[#fafaf8] p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[#d97757]" />
                <h2 className="font-semibold text-[#2c2b29]">
                  Ready for approval
                </h2>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[#8c8a85]">Goal</dt>
                  <dd className="mt-1 text-[#403f3b]">{draft.goal}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#8c8a85]">Tools</dt>
                  <dd className="mt-1 text-[#403f3b]">
                    {draft.requiredTools
                      .map((tool) => tool.toolName)
                      .join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#8c8a85]">Schedule</dt>
                  <dd className="mt-1 text-[#403f3b]">
                    {draft.schedule?.kind === "recurring"
                      ? `${draft.schedule.rule} · ${draft.schedule.timezone}`
                      : "No schedule"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#8c8a85]">Budget</dt>
                  <dd className="mt-1 capitalize text-[#403f3b]">
                    {draft.runBudgetPreset}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  className="rounded-lg"
                  disabled={approving}
                  onClick={() => void approve()}
                  type="button"
                >
                  {approving ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Approve automation
                </Button>
                <Button
                  className="rounded-lg"
                  onClick={() => setShowSchedule((current) => !current)}
                  type="button"
                  variant="outline"
                >
                  <Settings2 />
                  {showSchedule ? "Hide schedule" : "Change schedule"}
                </Button>
                <Button
                  className="rounded-lg"
                  onClick={() => {
                    setShowToolEditor(true);
                    setShowAllTools(false);
                  }}
                  type="button"
                  variant="outline"
                >
                  <Wrench />
                  Review tools
                </Button>
              </div>
            </div>
          ) : null}

          {automationSurface === "configuration" &&
          (showSchedule || asksForSchedule) ? (
            <div className="grid gap-3 rounded-[18px] border border-black/[0.09] bg-[#fafaf8] p-5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="schedule-kind">Schedule</Label>
                <Select
                  onValueChange={(value) =>
                    setScheduleKind(value as "manual_only" | "recurring")
                  }
                  value={scheduleKind}
                >
                  <SelectTrigger className="w-full" id="schedule-kind">
                    <SelectValue>
                      {scheduleKind === "manual_only"
                        ? "No schedule"
                        : "Recurring"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual_only">No schedule</SelectItem>
                    <SelectItem value="recurring">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scheduleKind === "recurring" ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="schedule-timezone">Timezone</Label>
                    <Input
                      id="schedule-timezone"
                      onChange={(event) =>
                        setScheduleTimezone(event.target.value)
                      }
                      value={scheduleTimezone}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor="schedule-rule">Cron rule</Label>
                    <Input
                      id="schedule-rule"
                      onChange={(event) => setScheduleRule(event.target.value)}
                      placeholder="0 8 * * 1-5"
                      value={scheduleRule}
                    />
                  </div>
                </>
              ) : null}
              <Button
                className="rounded-lg sm:col-span-2 sm:justify-self-start"
                disabled={saving}
                onClick={() => void saveSchedule()}
                type="button"
              >
                Save schedule
              </Button>
            </div>
          ) : null}

          {automationSurface === "configuration" && acceptsText ? (
            <form
              className="overflow-hidden rounded-[18px] border border-black/[0.09] bg-[#fafaf8]"
              onSubmit={submitTextAnswer}
            >
              <p className="px-4 pt-3 text-xs font-medium text-[#6f6d67]">
                Automation setup · {configurationPrompt}
              </p>
              <Label className="sr-only" htmlFor="interview-answer">
                Answer
              </Label>
              <Textarea
                className="min-h-24 resize-none rounded-none border-0 bg-transparent px-5 py-4 text-[15px] shadow-none focus-visible:ring-0"
                id="interview-answer"
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={configurationPrompt}
                value={answer}
              />
              <div className="flex items-center px-3 pb-3">
                <Badge
                  className="rounded-md bg-[#f1f1ef] text-[#716f69]"
                  variant="secondary"
                >
                  Explicit configuration
                </Badge>
                <Button
                  className="ml-auto size-8 rounded-full p-0"
                  disabled={saving || !answer.trim()}
                  type="submit"
                >
                  {saving ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <SendHorizontal />
                  )}
                  <span className="sr-only">Save answer</span>
                </Button>
              </div>
            </form>
          ) : null}
        </div>

        <div className="sticky bottom-0 z-20 bg-gradient-to-t from-white via-white via-80% to-transparent pb-4 pt-7">
          <form
            className="overflow-hidden rounded-[20px] border border-black/[0.1] bg-white shadow-[0_6px_24px_rgba(0,0,0,0.08)] transition-[border-color,box-shadow] focus-within:border-black/[0.16] focus-within:shadow-[0_8px_28px_rgba(0,0,0,0.1)]"
            onSubmit={sendChatMessage}
          >
            <Label className="sr-only" htmlFor="chat-message">
              Message the AI
            </Label>
            <Textarea
              className="min-h-[58px] max-h-48 resize-none rounded-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 shadow-none focus-visible:ring-0"
              id="chat-message"
              disabled={archived}
              onChange={(event) => setChatMessage(event.target.value)}
              onKeyDown={(event) => {
                if (
                  shouldSubmitComposerKey({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing,
                  })
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Write a message..."
              value={chatMessage}
            />
            <div className="flex h-11 items-center px-3 pb-2">
              <ConversationModeSelect
                disabled={stream.active || archived}
                onValueChange={setMode}
                value={mode}
              />
              <Button
                className="ml-auto size-8 rounded-full bg-[#262624] p-0 text-white hover:bg-black disabled:bg-[#dededb] disabled:text-[#999791]"
                disabled={
                  archived ||
                  stream.active ||
                  !stream.connected ||
                  !chatMessage.trim()
                }
                type="submit"
              >
                {stream.active ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" strokeWidth={2.2} />
                )}
                <span className="sr-only">Send message</span>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
