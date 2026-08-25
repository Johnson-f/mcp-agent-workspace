import { describe, expect, it } from "vitest";
import {
  boundedActivityContent,
  groupConversationActivityRows,
} from "./conversation-activities";

describe("conversation activities", () => {
  it("groups rows by turn and keeps sequence order", () => {
    const groups = groupConversationActivityRows([
      {
        id: "activity-2",
        turnId: "turn-1",
        assistantMessageId: "message-1",
        sequence: 2,
        kind: "reasoning_summary",
        status: "running",
        title: "Reasoning",
        content: "Second",
        startedAt: new Date("2026-08-22T22:00:01.000Z"),
        completedAt: null,
      },
      {
        id: "activity-1",
        turnId: "turn-1",
        assistantMessageId: "message-1",
        sequence: 1,
        kind: "status",
        status: "completed",
        title: "Started response",
        content: null,
        startedAt: new Date("2026-08-22T22:00:00.000Z"),
        completedAt: new Date("2026-08-22T22:00:00.100Z"),
      },
    ]);

    expect(groups).toEqual([
      {
        turnId: "turn-1",
        assistantMessageId: "message-1",
        status: "running",
        activities: [
          expect.objectContaining({ id: "activity-1", sequence: 1 }),
          expect.objectContaining({ id: "activity-2", sequence: 2 }),
        ],
      },
    ]);
  });

  it("caps persisted summary content at 16 KB", () => {
    expect(boundedActivityContent("x".repeat(20_000))).toHaveLength(16_384);
    expect(boundedActivityContent(null)).toBeNull();
  });
});
