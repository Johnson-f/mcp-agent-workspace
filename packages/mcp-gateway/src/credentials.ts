import type {
  AuthProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";

export type StoredMcpCredential =
  | { type: "bearer"; token: string }
  | { type: "custom_headers"; headers: Record<string, string> }
  | {
      type: "oauth2";
      state: string;
      codeVerifier?: string;
      clientInformation?: StoredOAuthClientInformation;
      tokens?: StoredOAuthTokens;
      discoveryState?: OAuthDiscoveryState;
    };

export interface EncryptedCredential {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
}

export class CredentialEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialEncryptionConfigurationError";
  }
}

const encodeBase64 = (value: Uint8Array) =>
  Buffer.from(value).toString("base64url");

const decodeBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));

const getEncryptionKey = async () => {
  const encodedKey = process.env.MCP_CREDENTIALS_ENCRYPTION_KEY;

  if (!encodedKey) {
    throw new CredentialEncryptionConfigurationError(
      "MCP_CREDENTIALS_ENCRYPTION_KEY must be configured before storing credentials.",
    );
  }

  const rawKey = decodeBase64(encodedKey);
  if (rawKey.byteLength !== 32) {
    throw new CredentialEncryptionConfigurationError(
      "MCP_CREDENTIALS_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.",
    );
  }

  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

export const encryptCredential = async (
  credential: StoredMcpCredential,
): Promise<EncryptedCredential> => {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credential));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      await getEncryptionKey(),
      plaintext,
    ),
  );
  const tagStart = encrypted.byteLength - 16;

  return {
    ciphertext: encodeBase64(encrypted.slice(0, tagStart)),
    authTag: encodeBase64(encrypted.slice(tagStart)),
    nonce: encodeBase64(nonce),
    keyVersion: 1,
  };
};

export const decryptCredential = async (
  encrypted: EncryptedCredential,
): Promise<StoredMcpCredential> => {
  if (encrypted.keyVersion !== 1) {
    throw new Error(`Unsupported MCP credential key version: ${encrypted.keyVersion}`);
  }

  const ciphertext = decodeBase64(encrypted.ciphertext);
  const authTag = decodeBase64(encrypted.authTag);
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.byteLength);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64(encrypted.nonce),
      tagLength: 128,
    },
    await getEncryptionKey(),
    combined,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as StoredMcpCredential;
};

export const toMcpAuthentication = (credential?: StoredMcpCredential) => {
  if (!credential) {
    return {};
  }

  if (credential.type === "bearer") {
    const authProvider: AuthProvider = {
      token: async () => credential.token,
    };
    return { authProvider };
  }

  if (credential.type === "oauth2") {
    return {};
  }

  return { customHeaders: credential.headers };
};
