import assert from "node:assert/strict";
import test from "node:test";
import * as viewModel from "./automation-view-model";
import {
  automationStatePriority,
  sortAutomationSummaries,
} from "./automation-view-model";

test("orders needs-attention Automations before healthy ones", () => {
  const result = sortAutomationSummaries([
    { id: "live", state: "live", updatedAt: "2026-08-17T12:00:00Z" },
    {
      id: "attention",
      state: "needs_reconfiguration",
      updatedAt: "2026-08-17T11:00:00Z",
    },
  ]);
  assert.deepEqual(
    result.map((item) => item.id),
    ["attention", "live"],
  );
});

test("assigns deterministic state priorities", () => {
  assert.ok(
    automationStatePriority("needs_reconfiguration") <
      automationStatePriority("live"),
  );
});

test("turns common schedules into human-readable copy", () => {
  const formatter = (viewModel as unknown as Record<string, unknown>)
    .formatAutomationSchedule;
  assert.equal(typeof formatter, "function");

  assert.equal(
    (formatter as (schedule: string) => string)("0 9 * * *"),
    "Daily at 9:00 AM",
  );
  assert.equal(
    (formatter as (schedule: string) => string)("No schedule"),
    "Run manually",
  );
  assert.equal(
    (formatter as (schedule: string) => string)("15 8 * * 1"),
    "Custom schedule",
  );
});

test("groups automation states by the action they need", () => {
  const sectionFor = (viewModel as unknown as Record<string, unknown>)
    .automationSection;
  assert.equal(typeof sectionFor, "function");

  const section = sectionFor as (state: string) => string;
  assert.equal(section("needs_reconfiguration"), "needs_attention");
  assert.equal(section("live"), "active");
  assert.equal(section("paused"), "inactive");
  assert.equal(section("draft"), "inactive");
});
