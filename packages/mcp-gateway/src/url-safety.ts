import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { FetchLike } from "@modelcontextprotocol/client";

// Keep address families separate. Bun's BlockList can incorrectly match an
// IPv4 address after IPv6 subnets are added to the same list.
const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

const privateNetworksAllowed = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.MCP_ALLOW_PRIVATE_NETWORKS === "true";

const insecureHttpAllowed = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.MCP_ALLOW_INSECURE_HTTP === "true";

const isBlockedAddress = (address: string, family: number) =>
  family === 6
    ? blockedIpv6Addresses.check(address, "ipv6")
    : blockedIpv4Addresses.check(address, "ipv4");

export const validateMcpEndpoint = async (input: string | URL) => {
  let endpoint: URL;

  try {
    endpoint = input instanceof URL ? new URL(input) : new URL(input);
  } catch {
    throw new Error("Enter a valid MCP server URL.");
  }

  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("MCP server URLs must use HTTPS.");
  }

  if (endpoint.protocol === "http:" && !insecureHttpAllowed()) {
    throw new Error("MCP server URLs must use HTTPS.");
  }

  if (endpoint.username || endpoint.password) {
    throw new Error("Credentials are not allowed inside the MCP server URL.");
  }

  if (endpoint.search) {
    throw new Error(
      "Credentials and query parameters are not allowed inside the MCP server URL.",
    );
  }

  const hostname = endpoint.hostname.toLowerCase();
  if (
    !privateNetworksAllowed() &&
    (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
  ) {
    throw new Error("Private-network MCP servers require a local connector.");
  }

  if (!privateNetworksAllowed()) {
    const literalFamily = isIP(hostname);
    const addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await lookup(hostname, { all: true, verbatim: true });

    if (
      addresses.length === 0 ||
      addresses.some(({ address, family }) => isBlockedAddress(address, family))
    ) {
      throw new Error("Private-network MCP servers require a local connector.");
    }
  }

  return endpoint;
};

export const createMcpFetch = (
  endpoint: URL,
  customHeaders: Readonly<Record<string, string>> = {},
): FetchLike => {
  const endpointOrigin = endpoint.origin;

  return async (input, init) => {
    const requestUrl =
      input instanceof Request
        ? new URL(input.url)
        : new URL(input instanceof URL ? input : String(input));

    await validateMcpEndpoint(requestUrl);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (requestUrl.origin === endpointOrigin) {
      for (const [key, value] of Object.entries(customHeaders)) {
        headers.set(key, value);
      }
    }

    const response = await fetch(input, {
      ...init,
      headers,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(
        "MCP endpoint redirects are rejected; use the final HTTPS endpoint URL.",
      );
    }

    return response;
  };
};
