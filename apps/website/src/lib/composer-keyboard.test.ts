import assert from "node:assert/strict";
import test from "node:test";
import { shouldSubmitComposerKey } from "./composer-keyboard";

test("Enter submits a composer message", () => {
  assert.equal(
    shouldSubmitComposerKey({
      key: "Enter",
      shiftKey: false,
      isComposing: false,
    }),
    true,
  );
});

test("Shift+Enter inserts a newline", () => {
  assert.equal(
    shouldSubmitComposerKey({
      key: "Enter",
      shiftKey: true,
      isComposing: false,
    }),
    false,
  );
});

test("Enter does not submit during text composition", () => {
  assert.equal(
    shouldSubmitComposerKey({
      key: "Enter",
      shiftKey: false,
      isComposing: true,
    }),
    false,
  );
});
