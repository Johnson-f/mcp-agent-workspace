import assert from "node:assert/strict";
import test from "node:test";
import { getAppPageMeta } from "./app-navigation";

test("maps app routes to useful workspace headers", () => {
  assert.deepEqual(getAppPageMeta("/conversations/new"), {
    section: "Automations",
    title: "New automation",
    description:
      "Chat naturally, then review and approve Automation proposals.",
    action: null,
  });

  assert.deepEqual(getAppPageMeta("/conversations/conversation_123"), {
    section: "Automations",
    title: "Conversation",
    description: "",
    action: null,
  });

  assert.deepEqual(getAppPageMeta("/automations"), {
    section: "Automations",
    title: "Automations",
    description: "Run approved work now or on an optional schedule.",
    action: { href: "/conversations/new", label: "New automation" },
  });

  assert.deepEqual(getAppPageMeta("/runs/run_123"), {
    section: "Runs",
    title: "Run details",
    description: "Follow durable execution, evidence, and final output.",
    action: { href: "/conversations/new", label: "New automation" },
  });

  assert.deepEqual(getAppPageMeta("/connections"), {
    section: "Configure",
    title: "Connections",
    description: "Connect MCP servers and control which tools agents may use.",
    action: { href: "/connections#connect-server", label: "Add server" },
  });

  assert.deepEqual(getAppPageMeta("/settings"), {
    section: "Configure",
    title: "Settings",
    description: "Control interactive Agent tool approvals.",
    action: null,
  });
});
