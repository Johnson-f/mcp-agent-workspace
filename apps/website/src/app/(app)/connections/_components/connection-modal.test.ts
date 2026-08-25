import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionUrlWithoutModalHash,
  connectServerModalIsOpen,
  directoryConnectionPrefill,
} from "./connection-modal";

test("opens only for the connect-server hash", () => {
  assert.equal(connectServerModalIsOpen("#connect-server"), true);
  assert.equal(connectServerModalIsOpen("#tools"), false);
  assert.equal(connectServerModalIsOpen(""), false);
});

test("removes the modal hash without changing path or search", () => {
  assert.equal(
    connectionUrlWithoutModalHash("/connections", "?source=settings"),
    "/connections?source=settings",
  );
});

test("restores automatic directory authentication from the handoff URL", () => {
  assert.deepEqual(
    directoryConnectionPrefill(
      "?directoryName=Gmail&directoryEndpoint=https%3A%2F%2Fexample.com%2Fmcp&directoryTransport=streamable_http&directoryAuth=auto",
      "#connect-server",
    ),
    {
      name: "Gmail",
      endpointUrl: "https://example.com/mcp",
      transport: "streamable_http",
      authType: "auto",
      authHeaderNames: [],
    },
  );
});

test("restores required custom headers published by the directory", () => {
  assert.deepEqual(
    directoryConnectionPrefill(
      "?directoryName=Private&directoryEndpoint=https%3A%2F%2Fexample.com%2Fmcp&directoryAuth=custom_headers&directoryHeaders=X-API-Key%2CX-Tenant",
      "#connect-server",
    ),
    {
      name: "Private",
      endpointUrl: "https://example.com/mcp",
      transport: "streamable_http",
      authType: "custom_headers",
      authHeaderNames: ["X-API-Key", "X-Tenant"],
    },
  );
});
