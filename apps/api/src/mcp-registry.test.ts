import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRegistryServer } from "./mcp-registry";

test("normalizes the first supported remote without exposing registry internals", () => {
	assert.deepEqual(
		normalizeRegistryServer({
			server: {
				name: "io.example/research",
				title: "Research MCP",
				description: "Search trusted sources.",
				version: "1.2.3",
				websiteUrl: "https://example.com",
				remotes: [
					{ type: "stdio", url: "file:///tmp/server" },
					{ type: "streamable-http", url: "https://mcp.example.com/mcp" },
				],
			},
		}),
		{
			authHeaderNames: [],
			authType: "auto",
			name: "io.example/research",
			title: "Research MCP",
			description: "Search trusted sources.",
			version: "1.2.3",
			websiteUrl: "https://example.com",
			icons: [],
			endpointUrl: "https://mcp.example.com/mcp",
			transport: "streamable_http",
		},
	);
});

test("keeps trusted Registry icons and rejects unrelated icon hosts", () => {
	const entry = normalizeRegistryServer({
		server: {
			name: "io.example/research",
			title: "Research MCP",
			websiteUrl: "https://example.com/docs",
			icons: [
				{ src: "https://example.com/icon.png", mimeType: "image/png", sizes: ["96x96"] },
				{ src: "https://tracker.invalid/icon.svg", mimeType: "image/svg+xml" },
			],
			remotes: [{ type: "streamable-http", url: "https://mcp.example.com/mcp" }],
		},
	});

	assert.deepEqual(entry?.icons, [
		{
			src: "https://example.com/icon.png",
			mimeType: "image/png",
			sizes: ["96x96"],
			theme: null,
		},
	]);
});

test("uses published required headers instead of guessing OAuth", () => {
	const entry = normalizeRegistryServer({
		server: {
			name: "io.example/protected",
			remotes: [
				{
					type: "streamable-http",
					url: "https://mcp.example.com/mcp",
					headers: [
						{ name: "X-API-Key", isRequired: true, isSecret: true },
						{ name: "X-Optional", isRequired: false },
					],
				},
			],
		},
	});

	assert.equal(entry?.authType, "custom_headers");
	assert.deepEqual(entry?.authHeaderNames, ["X-API-Key"]);
});

test("rejects package-only, insecure, and malformed registry entries", () => {
	assert.equal(
		normalizeRegistryServer({ server: { name: "package-only", packages: [] } }),
		null,
	);
	assert.equal(
		normalizeRegistryServer({
			server: {
				name: "insecure",
				remotes: [{ type: "sse", url: "http://example.com/sse" }],
			},
		}),
		null,
	);
	assert.equal(normalizeRegistryServer(null), null);
});
