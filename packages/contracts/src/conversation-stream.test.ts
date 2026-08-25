import { describe, expect, it } from "vitest";
import {
  parseConversationClientMessage,
  resolveConversationModeForMessage,
  serializeConversationServerMessage,
} from "./conversation-stream";

describe("Conversation WebSocket protocol", () => {
  it("routes an explicit automation creation request out of Agent mode", () => {
    expect(
      resolveConversationModeForMessage(
        "agent",
        "i wanna create an automation that checks every stock in my Webull watchlist",
      ),
    ).toBe("automation");
    expect(
      resolveConversationModeForMessage(
        "agent",
        "Create an automation that sends a market brief every weekday",
      ),
    ).toBe("automation");
  });

  it("keeps informational automation questions and ordinary tool work in Agent mode", () => {
    expect(
      resolveConversationModeForMessage("agent", "How do automations work?"),
    ).toBe("agent");
    expect(
      resolveConversationModeForMessage("agent", "Fetch my Webull watchlist"),
    ).toBe("agent");
  });

  it("does not override an explicitly selected Chat or Automation mode", () => {
    expect(
      resolveConversationModeForMessage("chat", "Create an automation for me"),
    ).toBe("chat");
    expect(
      resolveConversationModeForMessage(
        "automation",
        "Create an automation for me",
      ),
    ).toBe("automation");
  });

  it("accepts a bounded user message", () => {
    expect(
      parseConversationClientMessage(
        JSON.stringify({
          type: "user_message",
          clientMessageId: "client-1",
          content: "Hello",
        }),
      ),
    ).toEqual({
      type: "user_message",
      clientMessageId: "client-1",
      content: "Hello",
      mode: "chat",
    });
  });

  it("carries an explicit automation mode", () => {
    expect(
      parseConversationClientMessage(
        JSON.stringify({
          type: "user_message",
          clientMessageId: "client-2",
          content: "Send me a market brief every weekday",
          mode: "automation",
        }),
      ),
    ).toEqual({
      type: "user_message",
      clientMessageId: "client-2",
      content: "Send me a market brief every weekday",
      mode: "automation",
    });
  });

  it("carries an explicit Agent mode", () => {
    expect(
      parseConversationClientMessage(
        JSON.stringify({
          type: "user_message",
          clientMessageId: "client-agent",
          content: "Fetch my watchlist news",
          mode: "agent",
        }),
      ),
    ).toEqual({
      type: "user_message",
      clientMessageId: "client-agent",
      content: "Fetch my watchlist news",
      mode: "agent",
    });
  });

  it("accepts immutable tool approval decisions", () => {
    expect(
      parseConversationClientMessage(
        JSON.stringify({
          type: "tool_call_approve",
          turnId: "turn-1",
          callId: "call-1",
        }),
      ),
    ).toEqual({
      type: "tool_call_approve",
      turnId: "turn-1",
      callId: "call-1",
    });
    expect(
      parseConversationClientMessage(
        JSON.stringify({
          type: "tool_call_deny",
          turnId: "turn-1",
          callId: "call-1",
        }),
      ),
    ).toEqual({
      type: "tool_call_deny",
      turnId: "turn-1",
      callId: "call-1",
    });
  });

  it("rejects unknown conversation modes", () => {
    expect(() =>
      parseConversationClientMessage(
        JSON.stringify({
          type: "user_message",
          clientMessageId: "client-3",
          content: "Hello",
          mode: "unsafe",
        }),
      ),
    ).toThrow("mode");
  });

  it("rejects blank and oversized messages", () => {
    expect(() =>
      parseConversationClientMessage(
        JSON.stringify({
          type: "user_message",
          clientMessageId: "client-1",
          content: " ",
        }),
      ),
    ).toThrow("content");
    expect(() =>
      parseConversationClientMessage(
        JSON.stringify({
          type: "user_message",
          clientMessageId: "client-1",
          content: "x".repeat(32_769),
        }),
      ),
    ).toThrow("32 KB");
  });

  it("serializes a title event", () => {
    expect(
      serializeConversationServerMessage({
        type: "conversation_title",
        title: "Morning watchlist brief",
      }),
    ).toBe(
      JSON.stringify({
        type: "conversation_title",
        title: "Morning watchlist brief",
      }),
    );
  });

  it("serializes display-safe conversation activity frames", () => {
    const activity = {
      id: "activity-1",
      turnId: "turn-1",
      sequence: 2,
      kind: "reasoning_summary" as const,
      status: "running" as const,
      title: "Reasoning",
      content: "Checking the available evidence.",
      startedAt: "2026-08-22T22:00:00.000Z",
      completedAt: null,
    };

    expect(
      serializeConversationServerMessage({
        type: "activity_started",
        turnId: "turn-1",
        activity,
      }),
    ).toBe(
      JSON.stringify({
        type: "activity_started",
        turnId: "turn-1",
        activity,
      }),
    );
  });
});
