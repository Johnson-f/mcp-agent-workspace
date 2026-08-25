import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import {
  decryptCredential,
  encryptCredential,
  type StoredMcpCredential,
} from "./credentials";
import {
  getEncryptedCredential,
  saveEncryptedCredential,
} from "./repository";

type OAuthCredential = Extract<StoredMcpCredential, { type: "oauth2" }>;

export class PersistentOAuthProvider implements OAuthClientProvider {
  authorizationUrl: string | null = null;

  private constructor(
    private readonly connectionId: string,
    private readonly appUrl: string,
    private credential: OAuthCredential,
  ) {}

  static async load(connectionId: string, appUrl: string) {
    const encrypted = await getEncryptedCredential(connectionId);
    if (!encrypted) {
      throw new Error("OAuth connection credentials are missing.");
    }
    const credential = await decryptCredential(encrypted);
    if (credential.type !== "oauth2") {
      throw new Error("The stored credential is not an OAuth credential.");
    }
    return new PersistentOAuthProvider(connectionId, appUrl, credential);
  }

  get redirectUrl() {
    return `${this.appUrl}/connections/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Agents",
      client_uri: this.appUrl,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid profile email offline_access",
    };
  }

  state() {
    return this.credential.state;
  }

  clientInformation(_context?: OAuthClientInformationContext) {
    return this.credential.clientInformation;
  }

  async saveClientInformation(
    clientInformation: StoredOAuthClientInformation,
    _context?: OAuthClientInformationContext,
  ) {
    this.credential.clientInformation = clientInformation;
    await this.persist();
  }

  tokens(_context?: OAuthClientInformationContext) {
    return this.credential.tokens;
  }

  async saveTokens(
    tokens: StoredOAuthTokens,
    _context?: OAuthClientInformationContext,
  ) {
    this.credential.tokens = tokens;
    await this.persist();
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.authorizationUrl = authorizationUrl.toString();
  }

  async saveCodeVerifier(codeVerifier: string) {
    this.credential.codeVerifier = codeVerifier;
    await this.persist();
  }

  codeVerifier() {
    if (!this.credential.codeVerifier) {
      throw new Error("The OAuth PKCE verifier is missing or expired.");
    }
    return this.credential.codeVerifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    this.credential.discoveryState = discoveryState;
    await this.persist();
  }

  discoveryState() {
    return this.credential.discoveryState;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    if (scope === "all" || scope === "client") {
      delete this.credential.clientInformation;
    }
    if (scope === "all" || scope === "tokens") {
      delete this.credential.tokens;
    }
    if (scope === "all" || scope === "verifier") {
      delete this.credential.codeVerifier;
    }
    if (scope === "all" || scope === "discovery") {
      delete this.credential.discoveryState;
    }
    await this.persist();
  }

  private async persist() {
    await saveEncryptedCredential(
      this.connectionId,
      await encryptCredential(this.credential),
    );
  }
}
