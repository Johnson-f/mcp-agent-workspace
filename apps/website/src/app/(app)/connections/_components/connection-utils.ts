import type {
  McpConnection,
  McpConnectionAuthType,
  McpTool,
} from "@agents/contracts";

export type ConnectionAuthType = McpConnectionAuthType;

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export const statusStyles: Record<McpConnection["status"], string> = {
  connected:
    "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  pending:
    "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  auth_required:
    "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  error:
    "border-red-200/80 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  disabled: "border-border bg-muted text-muted-foreground",
};

export const authTypeLabel = (authType: ConnectionAuthType) => {
  switch (authType) {
    case "auto":
      return "Automatic";
    case "bearer":
      return "Bearer token";
    case "oauth2":
      return "OAuth";
    case "custom_headers":
      return "Custom headers";
    default:
      return "No authentication";
  }
};

const sampleForSchema = (schema: unknown): unknown => {
  if (!schema || typeof schema !== "object") {
    return null;
  }
  const definition = schema as Record<string, unknown>;
  if ("default" in definition) {
    return definition.default;
  }
  if (Array.isArray(definition.examples) && definition.examples.length > 0) {
    return definition.examples[0];
  }
  switch (definition.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return null;
  }
};

export const initialArguments = (inputSchema: unknown) => {
  if (!inputSchema || typeof inputSchema !== "object") {
    return "{}";
  }
  const schema = inputSchema as Record<string, unknown>;
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  return JSON.stringify(
    Object.fromEntries(
      required.map((key) => [key, sampleForSchema(properties[key])]),
    ),
    null,
    2,
  );
};

export const parseArguments = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};

export const parseCustomHeaders = (value: string) => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Custom headers must be a JSON object.");
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, header]) => {
      if (typeof header !== "string") {
        throw new Error("Custom header values must be strings.");
      }
      return [key, header];
    }),
  );
};

export interface ToolActionHandlers {
  toggleToolConsole: (tool: McpTool) => void;
  runTool: (tool: McpTool) => void;
  approveToolCall: () => void;
  dismissApproval: () => void;
  updatePolicy: (
    connectionId: string,
    tool: McpTool,
    update: Partial<Pick<McpTool, "enabled" | "approvalMode">>,
  ) => void;
  updatePolicies: (
    connectionId: string,
    toolIds: string[],
    update: Partial<Pick<McpTool, "enabled" | "approvalMode">>,
  ) => Promise<void>;
}
