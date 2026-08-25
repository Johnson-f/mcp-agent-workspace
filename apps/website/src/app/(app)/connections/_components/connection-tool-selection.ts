export type ConnectionToolFilter =
  | "all"
  | "enabled"
  | "disabled"
  | "read_only"
  | "write_capable";

export interface FilterableConnectionTool {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  available: boolean;
  annotations: unknown;
}

export const isWriteCapableConnectionTool = (
  tool: FilterableConnectionTool,
) => {
  const annotations =
    tool.annotations && typeof tool.annotations === "object"
      ? (tool.annotations as Record<string, unknown>)
      : null;
  return (
    annotations?.readOnlyHint !== true || annotations.destructiveHint === true
  );
};

export const filterConnectionTools = <Tool extends FilterableConnectionTool>(
  tools: readonly Tool[],
  input: { query: string; filter: ConnectionToolFilter },
) => {
  const query = input.query.trim().toLowerCase();
  return tools.filter((tool) => {
    const matchesQuery =
      !query ||
      tool.name.toLowerCase().includes(query) ||
      tool.description?.toLowerCase().includes(query);
    if (!matchesQuery) return false;
    switch (input.filter) {
      case "enabled":
        return tool.enabled;
      case "disabled":
        return !tool.enabled;
      case "read_only":
        return !isWriteCapableConnectionTool(tool);
      case "write_capable":
        return isWriteCapableConnectionTool(tool);
      default:
        return true;
    }
  });
};

export const selectAllVisibleToolIds = (
  selected: ReadonlySet<string>,
  visibleTools: readonly { id: string }[],
) => {
  const next = new Set(selected);
  const allVisibleSelected =
    visibleTools.length > 0 &&
    visibleTools.every((tool) => selected.has(tool.id));
  for (const tool of visibleTools) {
    if (allVisibleSelected) next.delete(tool.id);
    else next.add(tool.id);
  }
  return next;
};
