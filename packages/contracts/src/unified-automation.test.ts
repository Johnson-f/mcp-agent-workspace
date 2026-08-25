import { describe, expect, it } from "vitest";
import {
  automationRunWorkflowInput,
  canRunAutomationNow,
  conversationHistorySections,
} from "./unified-automation";

describe("unified Automation behavior", () => {
  it("allows Run now for a live Automation without an active run", () => {
    expect(canRunAutomationNow({ state: "live", hasActiveRun: false })).toBe(
      true,
    );
  });

  it("blocks Run now while an Automation Run is active", () => {
    expect(canRunAutomationNow({ state: "live", hasActiveRun: true })).toBe(
      false,
    );
  });

  it("records manual trigger metadata on workflow input", () => {
    expect(
      automationRunWorkflowInput({
        automationId: "automation-1",
        automationVersionId: "version-1",
        runId: "run-1",
        triggeredByUserId: "user-1",
      }),
    ).toMatchObject({
      kind: "automation",
      triggerSource: "manual",
      triggeredByUserId: "user-1",
    });
  });

  it("separates pinned and recent Conversations", () => {
    const sections = conversationHistorySections([
      {
        id: "pinned",
        pinnedAt: "2026-08-17T10:00:00Z",
        updatedAt: "2026-08-17T10:00:00Z",
      },
      {
        id: "recent",
        pinnedAt: null,
        updatedAt: "2026-08-17T11:00:00Z",
      },
      {
        id: "archived",
        pinnedAt: null,
        archivedAt: "2026-08-17T12:00:00Z",
        updatedAt: "2026-08-17T12:00:00Z",
      },
    ]);

    expect(sections.pinned.map((item) => item.id)).toEqual(["pinned"]);
    expect(sections.recent.map((item) => item.id)).toEqual(["recent"]);
  });
});
