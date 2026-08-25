const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const uuidPatternGlobal =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const opaqueHexPattern = /\b[0-9a-f]{24,}\b/gi;
const internalIdKeyPattern = /(?:^id$|_ids?$|Ids?$)/;
const technicalIdLinePattern =
  /^\s*(?:[-*]\s*)?(?:\*\*)?(?:run|workflow|temporal(?: run)?|artifact|tool(?: call)?|authorization(?: snapshot)?|account|watchlist)\s+(?:id|uuid)(?:\*\*)?\s*:/i;
const labeledOpaqueIdPattern =
  /\s+(?:with\s+)?(?:watchlist|account|instrument|connection|artifact|workflow|run|tool(?:_call)?|authorization(?:_snapshot)?)(?:_|\s+)id\s*(?:[:=]\s*)?`?[a-z0-9-]{16,}`?\.?/gi;

type PresentableStep = {
  type: string;
  summary: string;
  publicMetadata: Record<string, unknown>;
};

export function formatToolName(toolName: string) {
  const words = toolName.replaceAll("_", " ").trim().toLowerCase();
  if (!words) return "Tool";
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} tool`;
}

export function formatStepSummary(step: PresentableStep) {
  const metadataToolName = step.publicMetadata.toolName;
  const summaryToolName = step.summary.match(
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  )?.[0];
  const toolName =
    typeof metadataToolName === "string" ? metadataToolName : summaryToolName;

  if (!toolName) return step.summary;

  const displayName = formatToolName(toolName);
  if (step.type === "tool_selected") return `${displayName} selected.`;
  if (step.type === "tool_call_started") return `Calling ${displayName}.`;
  if (step.type === "tool_call_completed") return `${displayName} completed.`;
  if (step.type === "tool_call_failed") return `${displayName} failed.`;
  return step.summary.replaceAll(toolName, displayName);
}

export function sanitizeTechnicalIds(value: unknown, key?: string): unknown {
  if (key && internalIdKeyPattern.test(key)) return undefined;

  if (typeof value === "string") {
    if (uuidPattern.test(value)) return undefined;
    return key === "toolName" ? formatToolName(value) : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeTechnicalIds(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeTechnicalIds(entryValue, entryKey),
        ])
        .filter(([, entryValue]) => entryValue !== undefined),
    );
  }

  return value;
}

export function sanitizeRunOutputMarkdown(markdown: string) {
  return markdown
    .split("\n")
    .filter((line) => !technicalIdLinePattern.test(line))
    .map((line) =>
      line
        .replace(labeledOpaqueIdPattern, ".")
        .replace(uuidPatternGlobal, "")
        .replace(opaqueHexPattern, "")
        .replace(/\s+\./g, ".")
        .replace(/\.{2,}/g, "."),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
