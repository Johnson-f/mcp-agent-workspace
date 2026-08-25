import assert from "node:assert/strict";
import test from "node:test";
import {
  filterConnectionTools,
  selectAllVisibleToolIds,
} from "./connection-tool-selection";

const tools = [
  {
    id: "watchlists",
    name: "get_watchlists",
    description: "List Webull watchlists",
    enabled: false,
    available: true,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    id: "delete",
    name: "delete_watchlist",
    description: "Delete a watchlist",
    enabled: true,
    available: true,
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

test("filters tools by search, state, and capability", () => {
  assert.deepEqual(
    filterConnectionTools(tools, { query: "Webull", filter: "disabled" }).map(
      (tool) => tool.id,
    ),
    ["watchlists"],
  );
  assert.deepEqual(
    filterConnectionTools(tools, {
      query: "",
      filter: "write_capable",
    }).map((tool) => tool.id),
    ["delete"],
  );
});

test("select all visible toggles only the filtered tool ids", () => {
  assert.deepEqual(
    [...selectAllVisibleToolIds(new Set(["outside"]), [tools[0]])].sort(),
    ["outside", "watchlists"],
  );
  assert.deepEqual(
    [
      ...selectAllVisibleToolIds(new Set(["outside", "watchlists"]), [
        tools[0],
      ]),
    ],
    ["outside"],
  );
});
