export const classifyMcpExecutionFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const authRequired =
    /\bHTTP\s+(401|403)\b/i.test(message) ||
    /\b(unauthorized|access denied|denied access)\b/i.test(message);

  return authRequired
    ? {
        authRequired: true,
        errorCode: "MCP_AUTH_EXPIRED" as const,
        userMessage:
          "Authorization expired. Refresh this MCP connection and try again.",
      }
    : {
        authRequired: false,
        errorCode: "MCP_TOOL_CALL_FAILED" as const,
        userMessage: "The MCP tool call failed.",
      };
};

export const shouldAttemptOAuthRefresh = (input: {
  authRequired: boolean;
  hasRefreshToken: boolean;
  refreshAttempted: boolean;
}) =>
  input.authRequired && input.hasRefreshToken && !input.refreshAttempted;
