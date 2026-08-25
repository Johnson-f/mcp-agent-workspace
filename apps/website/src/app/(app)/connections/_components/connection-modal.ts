export const connectServerModalIsOpen = (hash: string) =>
  hash === "#connect-server";

export interface DirectoryConnectionPrefill {
  name: string;
  endpointUrl: string;
  transport: "streamable_http" | "sse";
  authType: "auto" | "custom_headers";
  authHeaderNames: string[];
}

export const directoryConnectionPrefill = (
  search: string,
  hash: string,
): DirectoryConnectionPrefill | null => {
  if (!connectServerModalIsOpen(hash)) return null;
  const params = new URLSearchParams(search);
  const name = params.get("directoryName")?.trim();
  const endpointUrl = params.get("directoryEndpoint")?.trim();
  if (!name || !endpointUrl) return null;
  const authType =
    params.get("directoryAuth") === "custom_headers"
      ? "custom_headers"
      : "auto";
  return {
    name,
    endpointUrl,
    transport:
      params.get("directoryTransport") === "sse" ? "sse" : "streamable_http",
    authType,
    authHeaderNames:
      authType === "custom_headers"
        ? (params.get("directoryHeaders") ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
  };
};

export const connectionUrlWithoutModalHash = (
  pathname: string,
  search: string,
) => `${pathname}${search}`;
