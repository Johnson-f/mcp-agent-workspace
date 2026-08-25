import type {
  InteractiveAgentApprovalPolicy,
  McpApprovalMode,
} from "@agents/contracts";
import type { AgentToolRisk } from "@agents/contracts";
import { toolCallNeedsApproval } from "./tool-call-policy";

const hardConfirmationPattern =
  /(delete|destroy|credential|secret|token|password|permission|role|payment|purchase|transfer|withdraw|publish|send[_ -]?(email|message)|account)/i;

export interface InteractiveAgentPolicyTool {
  name: string;
  description: string | null;
  approvalMode: McpApprovalMode;
  annotations: Record<string, unknown> | null;
}

export const classifyInteractiveAgentToolRisk = (
  tool: InteractiveAgentPolicyTool,
): AgentToolRisk => {
  if (!tool.annotations) return "unknown";
  if (
    tool.annotations.destructiveHint === true ||
    hardConfirmationPattern.test(`${tool.name} ${tool.description ?? ""}`)
  ) {
    return "destructive";
  }
  return tool.annotations.readOnlyHint === true ? "read" : "write";
};

export const decideInteractiveAgentToolCall = (input: {
  preference: InteractiveAgentApprovalPolicy;
  tool: InteractiveAgentPolicyTool;
}): {
  decision: "ask" | "allow";
  risk: AgentToolRisk;
  reason:
    | "hard_confirmation"
    | "tool_policy"
    | "user_preference"
    | "eligible";
} => {
  const risk = classifyInteractiveAgentToolRisk(input.tool);
  if (risk === "destructive" || risk === "unknown") {
    return { decision: "ask", risk, reason: "hard_confirmation" };
  }
  if (input.tool.approvalMode === "always") {
    return { decision: "ask", risk, reason: "tool_policy" };
  }
  if (input.preference === "always_ask") {
    return { decision: "ask", risk, reason: "user_preference" };
  }
  if (input.preference === "auto_approve_eligible") {
    return { decision: "allow", risk, reason: "eligible" };
  }
  return toolCallNeedsApproval(
    input.tool.approvalMode,
    input.tool.annotations,
  )
    ? { decision: "ask", risk, reason: "tool_policy" }
    : { decision: "allow", risk, reason: "tool_policy" };
};
