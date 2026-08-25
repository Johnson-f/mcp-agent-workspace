import { afterEach, describe, expect, test } from "vitest";
import { decryptCredential, encryptCredential } from "./credentials";
import { validateMcpEndpoint } from "./url-safety";

const originalEnvironment = {
  encryptionKey: process.env.MCP_CREDENTIALS_ENCRYPTION_KEY,
  insecureHttp: process.env.MCP_ALLOW_INSECURE_HTTP,
  privateNetworks: process.env.MCP_ALLOW_PRIVATE_NETWORKS,
};

afterEach(() => {
  process.env.MCP_CREDENTIALS_ENCRYPTION_KEY =
    originalEnvironment.encryptionKey;
  process.env.MCP_ALLOW_INSECURE_HTTP = originalEnvironment.insecureHttp;
  process.env.MCP_ALLOW_PRIVATE_NETWORKS = originalEnvironment.privateNetworks;
});

describe("MCP endpoint safety", () => {
  test("rejects private network endpoints by default", async () => {
    process.env.MCP_ALLOW_INSECURE_HTTP = "true";
    process.env.MCP_ALLOW_PRIVATE_NETWORKS = "false";

    await expect(
      validateMcpEndpoint("http://127.0.0.1:3000/mcp"),
    ).rejects.toThrow("local connector");
  });

  test("rejects URL query credentials", async () => {
    await expect(
      validateMcpEndpoint("https://example.com/mcp?token=secret"),
    ).rejects.toThrow("query parameters");
  });

  test("allows public IPv4 endpoints", async () => {
    const endpoint = await validateMcpEndpoint("https://104.18.24.159/mcp");
    expect(endpoint.toString()).toBe("https://104.18.24.159/mcp");
  });

  test("allows explicit local development endpoints", async () => {
    process.env.MCP_ALLOW_INSECURE_HTTP = "true";
    process.env.MCP_ALLOW_PRIVATE_NETWORKS = "true";

    const endpoint = await validateMcpEndpoint("http://127.0.0.1:3000/mcp");
    expect(endpoint.toString()).toBe("http://127.0.0.1:3000/mcp");
  });
});

describe("MCP credential encryption", () => {
  test("round-trips a bearer token with AES-256-GCM", async () => {
    process.env.MCP_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64url",
    );

    const encrypted = await encryptCredential({
      type: "bearer",
      token: "test-token",
    });

    expect(encrypted.ciphertext).not.toContain("test-token");
    expect(await decryptCredential(encrypted)).toEqual({
      type: "bearer",
      token: "test-token",
    });
  });
});
