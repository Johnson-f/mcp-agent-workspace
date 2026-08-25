import { describe, expect, it } from "vitest";
import {
  oauthReconnectStrategy,
  resetOAuthCredentialForReauthorization,
} from "./oauth-reauthorization";

describe("OAuth reauthorization", () => {
  it("clears rejected tokens and the old verifier while retaining registration", () => {
    expect(
      resetOAuthCredentialForReauthorization(
        {
          type: "oauth2",
          state: "old-state",
          codeVerifier: "old-verifier",
          tokens: { access_token: "expired", token_type: "bearer" },
          clientInformation: {
            client_id: "client-1",
          },
          discoveryState: {
            authorizationServerUrl: "https://auth.example.com",
          },
        },
        "new-state",
      ),
    ).toEqual({
      type: "oauth2",
      state: "new-state",
      clientInformation: { client_id: "client-1" },
      discoveryState: {
        authorizationServerUrl: "https://auth.example.com",
      },
    });
  });
});

describe("OAuth reconnect strategy", () => {
  it("refreshes when a refresh token is available", () => {
    expect(
      oauthReconnectStrategy({
        type: "oauth2",
        state: "state",
        tokens: {
          access_token: "expired",
          refresh_token: "still-valid",
          token_type: "bearer",
        },
      }),
    ).toBe("refresh");
  });

  it("reauthorizes only when no refresh token exists", () => {
    expect(
      oauthReconnectStrategy({ type: "oauth2", state: "state" }),
    ).toBe("reauthorize");
  });
});
