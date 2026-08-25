import type { McpApprovalMode } from "@agents/contracts";

export interface BulkToolPolicyUpdate {
  toolIds: readonly string[];
  enabled?: boolean;
  approvalMode?: McpApprovalMode;
}

export const validateBulkToolPolicyUpdate = (
  input: BulkToolPolicyUpdate,
  tools: readonly { id: string; available: boolean }[],
) => {
  const toolIds = [...new Set(input.toolIds)];
  if (toolIds.length === 0) return "Select at least one tool.";
  if (toolIds.length > 200) return "Select no more than 200 tools at once.";
  if (input.enabled === undefined && input.approvalMode === undefined) {
    return "Choose at least one policy change.";
  }
  const selected = new Map(tools.map((tool) => [tool.id, tool]));
  if (toolIds.some((toolId) => !selected.has(toolId))) {
    return "One or more selected tools do not belong to this connection.";
  }
  if (
    input.enabled === true &&
    toolIds.some((toolId) => selected.get(toolId)?.available !== true)
  ) {
    return "Unavailable tools cannot be enabled.";
  }
  return null;
};
