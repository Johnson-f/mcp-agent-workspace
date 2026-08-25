import assert from "node:assert/strict";
import test from "node:test";
import {
  requestSettingsModal,
  SETTINGS_MODAL_OPEN_EVENT,
} from "./settings-modal";

test("dispatches the settings modal request across layout boundaries", () => {
  const target = new EventTarget();
  let opened = 0;
  target.addEventListener(SETTINGS_MODAL_OPEN_EVENT, () => {
    opened += 1;
  });

  requestSettingsModal(target);

  assert.equal(opened, 1);
});
