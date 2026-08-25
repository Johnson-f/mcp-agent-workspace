import assert from "node:assert/strict";
import test from "node:test";
import { copyMessageText } from "./message-copy";

test("copies the original message text including Markdown", async () => {
  const writes: string[] = [];
  const status = await copyMessageText("**Result**\n\n- AAPL", async (text) => {
    writes.push(text);
  });

  assert.equal(status, "copied");
  assert.deepEqual(writes, ["**Result**\n\n- AAPL"]);
});

test("reports clipboard failures without throwing", async () => {
  const status = await copyMessageText("message", async () => {
    throw new Error("clipboard blocked");
  });

  assert.equal(status, "failed");
});
