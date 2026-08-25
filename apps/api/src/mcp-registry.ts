import type { McpDirectoryEntry, McpDirectoryPage } from "@agents/contracts";
import { get } from "node:https";

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0.1/servers";
const REQUEST_TIMEOUT_MS = 8_000;
const PAGE_SIZE = 24;
const MAX_RESPONSE_BYTES = 2_000_000;

const record = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const optionalString = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

const trustedIconHosts = (server: Record<string, unknown>, endpointUrl: string) => {
	const urls = [endpointUrl, optionalString(server.websiteUrl)];
	const repository = record(server.repository);
	urls.push(optionalString(repository?.url));
	return new Set(
		urls.flatMap((value) => {
			if (!value) return [];
			try {
				return [new URL(value).hostname];
			} catch {
				return [];
			}
		}),
	);
};

const registryIcons = (server: Record<string, unknown>, endpointUrl: string) => {
	const trustedHosts = trustedIconHosts(server, endpointUrl);
	const supported = new Set([
		"image/png",
		"image/jpeg",
		"image/jpg",
		"image/svg+xml",
		"image/webp",
	]);
	return (Array.isArray(server.icons) ? server.icons : []).flatMap((value) => {
		const icon = record(value);
		const src = optionalString(icon?.src);
		const mimeType = optionalString(icon?.mimeType);
		if (!src || (mimeType && !supported.has(mimeType))) return [];
		try {
			const url = new URL(src);
			if (url.protocol !== "https:" || !trustedHosts.has(url.hostname)) return [];
		} catch {
			return [];
		}
		const theme: "light" | "dark" | null =
			icon?.theme === "light" || icon?.theme === "dark" ? icon.theme : null;
		return [
			{
				src,
				mimeType,
				sizes: Array.isArray(icon?.sizes)
					? icon.sizes.filter((size): size is string => typeof size === "string")
					: [],
				theme,
			},
		];
	});
};

const requiredHeaderNames = (remote: Record<string, unknown>) =>
	(Array.isArray(remote.headers) ? remote.headers : []).flatMap((value) => {
		const header = record(value);
		const name = optionalString(header?.name);
		return name && header?.isRequired === true ? [name] : [];
	});

export const normalizeRegistryServer = (
	value: unknown,
): McpDirectoryEntry | null => {
	const wrapper = record(value);
	const server = record(wrapper?.server);
	const name = optionalString(server?.name);
	const remotes = Array.isArray(server?.remotes) ? server.remotes : [];

	if (!server || !name) return null;

	for (const remoteValue of remotes) {
		const remote = record(remoteValue);
		if (!remote) continue;
		const type = optionalString(remote?.type);
		const endpointUrl = optionalString(remote?.url);
		if (!endpointUrl || (type !== "streamable-http" && type !== "sse")) {
			continue;
		}

		try {
			if (new URL(endpointUrl).protocol !== "https:") continue;
		} catch {
			continue;
		}

		const authHeaderNames = requiredHeaderNames(remote);
		return {
			authHeaderNames,
			authType:
				authHeaderNames.length > 0 ? "custom_headers" : "auto",
			name,
			title: optionalString(server?.title) ?? name.split("/").at(-1) ?? name,
			description: optionalString(server?.description),
			version: optionalString(server?.version),
			websiteUrl: optionalString(server?.websiteUrl),
			icons: registryIcons(server, endpointUrl),
			endpointUrl,
			transport: type === "sse" ? "sse" : "streamable_http",
		};
	}

	return null;
};

const readRegistryJson = (url: URL): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const request = get(
			url,
			{
				family: 4,
				headers: { accept: "application/json" },
				timeout: REQUEST_TIMEOUT_MS,
			},
			(response) => {
				if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
					response.resume();
					reject(new Error(`MCP Registry returned ${response.statusCode ?? "an invalid response"}.`));
					return;
				}

				let size = 0;
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_RESPONSE_BYTES) {
						request.destroy(new Error("MCP Registry response was too large."));
						return;
					}
					chunks.push(chunk);
				});
				response.on("end", () => {
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
					} catch {
						reject(new Error("MCP Registry returned invalid JSON."));
					}
				});
			},
		);
		request.once("timeout", () =>
			request.destroy(new Error("MCP Registry request timed out.")),
		);
		request.once("error", reject);
	});

export const listMcpDirectory = async (input: {
	search?: string;
	cursor?: string;
}): Promise<McpDirectoryPage> => {
	const url = new URL(REGISTRY_URL);
	url.searchParams.set("limit", String(PAGE_SIZE));
	url.searchParams.set("version", "latest");
	if (input.search?.trim()) url.searchParams.set("search", input.search.trim());
	if (input.cursor?.trim()) url.searchParams.set("cursor", input.cursor.trim());

	const payload = record(await readRegistryJson(url));
	const metadata = record(payload?.metadata);
	const entries = (Array.isArray(payload?.servers) ? payload.servers : [])
		.map(normalizeRegistryServer)
		.filter((entry): entry is McpDirectoryEntry => entry !== null);

	return {
		entries,
		nextCursor: optionalString(metadata?.nextCursor),
	};
};
