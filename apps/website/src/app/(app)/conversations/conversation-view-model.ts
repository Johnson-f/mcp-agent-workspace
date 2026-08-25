import { evaluateRunBriefDraft, type RunBriefDraft } from "@agents/contracts";

interface SuggestibleAutomationTool {
  id: string;
  name: string;
  enabled: boolean;
  available: boolean;
}

export const resolveSuggestedAutomationTools = <
  Tool extends SuggestibleAutomationTool,
>(
  tools: readonly Tool[],
  suggestedNames: readonly string[],
) => {
  const selected: Tool[] = [];
  const unresolvedNames: string[] = [];

  for (const name of [...new Set(suggestedNames)]) {
    const matches = tools.filter(
      (tool) => tool.name === name && tool.enabled && tool.available,
    );
    if (matches.length === 1) {
      selected.push(matches[0]);
    } else {
      unresolvedNames.push(name);
    }
  }

  return { selected, unresolvedNames };
};

export type ConversationNextAction =
  | {
      kind: "ask_missing_field";
      field: string;
      prompt: string;
    }
  | {
      kind: "acknowledge_write_tool";
      toolAuthorizationId: string;
      toolName: string;
      prompt: string;
    }
  | { kind: "review_automation" };

export const conversationNextAction = (
  draft: RunBriefDraft,
): ConversationNextAction => {
  const evaluation = evaluateRunBriefDraft(draft);
  const missing = evaluation.missingFields[0];
  if (missing) {
    return {
      kind: "ask_missing_field",
      field: missing.path,
      prompt: missing.prompt,
    };
  }

  const acknowledgement = evaluation.writeToolAcknowledgementsRequired[0];
  if (acknowledgement) {
    return {
      kind: "acknowledge_write_tool",
      toolAuthorizationId: acknowledgement.toolAuthorizationId,
      toolName: acknowledgement.toolName,
      prompt: `What exact outcome may ${acknowledgement.toolName} create or change?`,
    };
  }

  return { kind: "review_automation" };
};

export const automationApprovalDestination = (automationId: string) =>
  `/automations/${automationId}`;

export const shouldApproveRunBriefBeforeAutomation = (state: string | null) =>
  state === "pending_approval";

export const conversationAutomationSurface = (input: {
  hasAutomationProposal: boolean;
  hasRunBrief: boolean;
}) => {
  if (input.hasRunBrief) return "configuration" as const;
  if (input.hasAutomationProposal) return "proposal" as const;
  return "hidden" as const;
};
