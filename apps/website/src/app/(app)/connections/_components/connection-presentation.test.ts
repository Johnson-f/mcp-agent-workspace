import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionToolStats,
  formatConnectionStatus,
  formatConnectionToolName,
} from "./connection-presentation";

test("formats connection and tool names for people", () => {
  assert.equal(formatConnectionStatus("connected"), "Connected");
  assert.equal(formatConnectionStatus("auth_required"), "Reconnect required");
  assert.equal(formatConnectionStatus("error"), "Connection error");
  assert.equal(
    formatConnectionToolName("get_watchlist_news"),
    "Get watchlist news",
  );
});

test("summarizes tool readiness and capability", () => {
  assert.deepEqual(
    connectionToolStats([
      {
        enabled: true,
        available: true,
        annotations: { readOnlyHint: true },
      },
      {
        enabled: false,
        available: true,
        annotations: { readOnlyHint: false },
      },
      {
        enabled: true,
        available: false,
        annotations: { readOnlyHint: true },
      },
    ]),
    {
      total: 3,
      available: 2,
      enabled: 2,
      readOnly: 2,
      writeCapable: 1,
    },
  );
});
