import assert from "node:assert/strict";
import test from "node:test";
import {
  initialConversationStreamState,
  reduceConversationStreamState,
} from "./conversation-stream-state";

test("assistant deltas accumulate into one live response", () => {
  const started = reduceConversationStreamState(
    initialConversationStreamState,
    {
      type: "turn_started",
      clientMessageId: "client-1",
      turnId: "turn-1",
    },
  );
  const first = reduceConversationStreamState(started, {
    type: "assistant_delta",
    turnId: "turn-1",
    delta: "Hello",
  });
  const second = reduceConversationStreamState(first, {
    type: "assistant_delta",
    turnId: "turn-1",
    delta: " there",
  });

  assert.equal(second.assistantText, "Hello there");
  assert.equal(second.status, "streaming");
});

test("a failed turn keeps partial text visible", () => {
  const state = reduceConversationStreamState(
    { ...initialConversationStreamState, assistantText: "Partial" },
    {
      type: "turn_failed",
      turnId: "turn-1",
      code: "model_failed",
      message: "Could not finish.",
      retryable: true,
    },
  );

  assert.equal(state.assistantText, "Partial");
  assert.equal(state.status, "failed");
});

test("an Agent tool approval pauses and then records completion", () => {
  const waiting = reduceConversationStreamState(
    {
      ...initialConversationStreamState,
      status: "streaming",
      turnId: "turn-1",
    },
    {
      type: "tool_approval_required",
      turnId: "turn-1",
      callId: "call-1",
      toolId: "tool-1",
      toolName: "get_news",
      connectionName: "Market data",
      reason: "Fetch current news",
      argumentsPreview: { symbols: ["[string:4]"] },
      risk: "read",
    },
  );
  assert.equal(waiting.pendingApproval?.callId, "call-1");

  const completed = reduceConversationStreamState(waiting, {
    type: "tool_call_completed",
    turnId: "turn-1",
    callId: "call-1",
    toolName: "get_news",
    resultPreview: { status: "Completed" },
    isError: false,
  });
  assert.equal(completed.pendingApproval, null);
  assert.deepEqual(completed.toolActivities, [
    {
      callId: "call-1",
      toolName: "get_news",
      status: "completed",
      resultPreview: { status: "Completed" },
      isError: false,
    },
  ]);
});

test("conversation activities stream, complete, and stay sequence ordered", () => {
  const started = reduceConversationStreamState(
    { ...initialConversationStreamState, turnId: "turn-1" },
    {
      type: "activity_started",
      turnId: "turn-1",
      activity: {
        id: "activity-2",
        turnId: "turn-1",
        sequence: 2,
        kind: "reasoning_summary",
        status: "running",
        title: "Reasoning",
        content: "Plan",
        startedAt: "2026-08-22T22:00:00.000Z",
        completedAt: null,
      },
    },
  );
  const withEarlier = reduceConversationStreamState(started, {
    type: "activity_started",
    turnId: "turn-1",
    activity: {
      id: "activity-1",
      turnId: "turn-1",
      sequence: 1,
      kind: "status",
      status: "completed",
      title: "Started response",
      content: null,
      startedAt: "2026-08-22T21:59:59.000Z",
      completedAt: "2026-08-22T21:59:59.100Z",
    },
  });
  const delta = reduceConversationStreamState(withEarlier, {
    type: "activity_delta",
    turnId: "turn-1",
    activityId: "activity-2",
    delta: " more",
  });
  const completed = reduceConversationStreamState(delta, {
    type: "activity_completed",
    turnId: "turn-1",
    activity: {
      ...delta.activities[1],
      status: "completed",
      content: "Plan more",
      completedAt: "2026-08-22T22:00:01.000Z",
    },
  });

  assert.deepEqual(
    completed.activities.map((activity) => activity.id),
    ["activity-1", "activity-2"],
  );
  assert.equal(completed.activities[1]?.content, "Plan more");
  assert.equal(completed.activities[1]?.status, "completed");
});

test("an activity snapshot replaces only the active turn activities", () => {
  const state = reduceConversationStreamState(
    {
      ...initialConversationStreamState,
      turnId: "turn-2",
      activities: [
        {
          id: "stale",
          turnId: "turn-2",
          sequence: 1,
          kind: "status",
          status: "running",
          title: "Old",
          content: null,
          startedAt: "2026-08-22T22:00:00.000Z",
          completedAt: null,
        },
      ],
    },
    {
      type: "activity_snapshot",
      turnId: "turn-2",
      activities: [
        {
          id: "fresh",
          turnId: "turn-2",
          sequence: 1,
          kind: "tool",
          status: "completed",
          title: "Fetched watchlist",
          content: null,
          startedAt: "2026-08-22T22:00:00.000Z",
          completedAt: "2026-08-22T22:00:01.000Z",
        },
      ],
    },
  );

  assert.deepEqual(
    state.activities.map((activity) => activity.id),
    ["fresh"],
  );
});
