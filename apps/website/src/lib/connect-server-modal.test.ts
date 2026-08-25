import assert from "node:assert/strict";
import test from "node:test";
import {
  CONNECT_SERVER_MODAL_OPEN_EVENT,
  requestConnectServerModal,
} from "./connect-server-modal";

test("dispatches Add server requests across the app header boundary", () => {
  const target = new EventTarget();
  let opened = 0;
  target.addEventListener(CONNECT_SERVER_MODAL_OPEN_EVENT, () => {
    opened += 1;
  });

  requestConnectServerModal(target);

  assert.equal(opened, 1);
});
