import { describe, expect, it } from "vitest";
import {
  classifyMcpExecutionFailure,
  shouldAttemptOAuthRefresh,
} from "./execution-failure";

describe("MCP execution failure classification", () => {
  it("recognizes an expired OAuth session returned as HTTP 403", () => {
    expect(
      classifyMcpExecutionFailure(
        new Error(
          "Version negotiation failed: the server denied access (HTTP 403)",
        ),
      ),
    ).toEqual({
      authRequired: true,
      errorCode: "MCP_AUTH_EXPIRED",
      userMessage:
        "Authorization expired. Refresh this MCP connection and try again.",
    });
  });

  it("keeps unrelated failures generic", () => {
    expect(classifyMcpExecutionFailure(new Error("socket closed"))).toEqual({
      authRequired: false,
      errorCode: "MCP_TOOL_CALL_FAILED",
      userMessage: "The MCP tool call failed.",
    });
  });
});

describe("OAuth execution recovery", () => {
  it("retries one authorization failure when a refresh token exists", () => {
    expect(
      shouldAttemptOAuthRefresh({
        authRequired: true,
        hasRefreshToken: true,
        refreshAttempted: false,
      }),
    ).toBe(true);
    expect(
      shouldAttemptOAuthRefresh({
        authRequired: true,
        hasRefreshToken: true,
        refreshAttempted: true,
      }),
    ).toBe(false);
  });
});
