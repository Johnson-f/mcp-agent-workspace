import assert from "node:assert/strict";
import test from "node:test";
import {
  activityDisclosureIndicator,
  activityTimelineExpanded,
  normalizeActivityDisplayMode,
} from "./conversation-activity-display";

test("uses literal right and left indicators for collapsed and expanded steps", () => {
  assert.equal(activityDisclosureIndicator(false), ">");
  assert.equal(activityDisclosureIndicator(true), "<");
});

test("Auto opens live activity and collapses completed activity", () => {
  assert.equal(
    activityTimelineExpanded({ mode: "auto", active: true, remembered: false }),
    true,
  );
  assert.equal(
    activityTimelineExpanded({ mode: "auto", active: false, remembered: true }),
    false,
  );
});

test("Always expanded stays open and Remember last restores the choice", () => {
  assert.equal(
    activityTimelineExpanded({
      mode: "always_expanded",
      active: false,
      remembered: false,
    }),
    true,
  );
  assert.equal(
    activityTimelineExpanded({
      mode: "remember_last",
      active: false,
      remembered: true,
    }),
    true,
  );
  assert.equal(
    activityTimelineExpanded({
      mode: "remember_last",
      active: false,
      remembered: false,
    }),
    false,
  );
});

test("invalid display preferences fall back to Auto", () => {
  assert.equal(normalizeActivityDisplayMode("expanded"), "auto");
  assert.equal(normalizeActivityDisplayMode(null), "auto");
});
