import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConversationMode } from "./conversation-mode";

test("restores only supported composer modes", () => {
  assert.equal(normalizeConversationMode("automation"), "automation");
  assert.equal(normalizeConversationMode("agent"), "agent");
  assert.equal(normalizeConversationMode("chat"), "chat");
  assert.equal(normalizeConversationMode("unknown"), "chat");
  assert.equal(normalizeConversationMode(null), "chat");
});
