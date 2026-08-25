import type { McpConnection, McpTool } from "@agents/contracts";

export const formatConnectionStatus = (status: McpConnection["status"]) => {
  if (status === "connected") return "Connected";
  if (status === "auth_required") return "Reconnect required";
  if (status === "error") return "Connection error";
  if (status === "pending") return "Connecting";
  return "Disabled";
};

export const formatConnectionToolName = (name: string) => {
  const words = name.replaceAll("_", " ").trim().toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Tool";
};

type ToolSummaryInput = Pick<McpTool, "enabled" | "available" | "annotations">;

const isReadOnly = (tool: ToolSummaryInput) => {
  if (!tool.annotations || typeof tool.annotations !== "object") return false;
  return (tool.annotations as Record<string, unknown>).readOnlyHint === true;
};

export const connectionToolStats = (tools: readonly ToolSummaryInput[]) => ({
  total: tools.length,
  available: tools.filter((tool) => tool.available).length,
  enabled: tools.filter((tool) => tool.enabled).length,
  readOnly: tools.filter(isReadOnly).length,
  writeCapable: tools.filter((tool) => !isReadOnly(tool)).length,
});
