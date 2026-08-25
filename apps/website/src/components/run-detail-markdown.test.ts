import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runDetailSource = readFileSync(
  new URL("../app/(app)/runs/[runId]/run-detail-client.tsx", import.meta.url),
  "utf8",
);

test("renders final run output with the shared Markdown renderer", () => {
  assert.match(runDetailSource, /<MarkdownMessage\s+content=\{finalOutput\}/);
  assert.doesNotMatch(
    runDetailSource,
    /<pre[^>]*>[^<]*\{finalOutput\}[^<]*<\/pre>/,
  );
});

test("provides an accessible back control with an Automations fallback", () => {
  assert.match(runDetailSource, /aria-label="Back"/);
  assert.match(runDetailSource, /router\.back\(\)/);
  assert.match(runDetailSource, /router\.push\("\/automations"\)/);
});
