import type { StoredMcpCredential } from "./credentials";

type OAuthCredential = Extract<StoredMcpCredential, { type: "oauth2" }>;

export const oauthReconnectStrategy = (credential: OAuthCredential) =>
  credential.tokens?.refresh_token ? "refresh" : "reauthorize";

export const resetOAuthCredentialForReauthorization = (
  credential: OAuthCredential,
  state: string,
): OAuthCredential => ({
  type: "oauth2",
  state,
  ...(credential.clientInformation
    ? { clientInformation: credential.clientInformation }
    : {}),
  ...(credential.discoveryState
    ? { discoveryState: credential.discoveryState }
    : {}),
});
