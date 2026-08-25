import { describe, expect, test } from "vitest";
import {
	OAuthError,
	OAuthErrorCode,
	UnauthorizedError,
} from "@modelcontextprotocol/client";
import {
	normalizeDatabaseError,
	oauthCompletionFailure,
	shouldRetryAutomaticAuthWithOAuth,
} from "./service";

describe("MCP database errors", () => {
	test("normalizes wrapped PostgreSQL unique violations", () => {
		const error = {
			cause: {
				code: "ERR_POSTGRES_SERVER_ERROR",
				errno: "23505",
				constraint: "mcp_connections_user_name_uidx",
			},
		};

		expect(normalizeDatabaseError(error)).toEqual({
			_tag: "Conflict",
			message: "You already have an MCP connection with this name.",
		});
	});

	test("does not expose SQL from other database errors", () => {
		const error = Object.assign(
			new Error('Failed query: insert into "mcp_connections" ...'),
			{
				cause: {
					code: "ERR_POSTGRES_SERVER_ERROR",
					errno: "23503",
				},
			},
		);
		error.name = "DrizzleQueryError";

		expect(normalizeDatabaseError(error)).toEqual({
			_tag: "ServiceUnavailable",
			message: "The database request could not be completed.",
		});
	});
});

describe("MCP OAuth completion errors", () => {
	test("turns an invalid grant into a safe retry instruction", () => {
		expect(
			oauthCompletionFailure(
				new OAuthError(OAuthErrorCode.InvalidGrant, "sensitive provider detail"),
			),
		).toEqual({
			_tag: "InvalidRequest",
			message:
				"This authorization attempt expired or was replaced by a newer attempt. Return to connections and try again.",
		});
	});

	test("does not expose other OAuth provider errors", () => {
		const result = oauthCompletionFailure(
			new OAuthError(OAuthErrorCode.ServerError, "sensitive provider detail"),
		);

		expect(result).toEqual({
			_tag: "InvalidRequest",
			message:
				"The authorization server rejected this request. Return to connections and try again.",
		});
		expect(result?.message).not.toContain("sensitive provider detail");
	});
});

describe("automatic MCP authentication", () => {
	test("retries an unauthorized MCP endpoint with OAuth discovery", () => {
		expect(
			shouldRetryAutomaticAuthWithOAuth(new UnauthorizedError()),
		).toBe(true);
	});

	test("does not reinterpret ordinary connection failures as OAuth", () => {
		expect(
			shouldRetryAutomaticAuthWithOAuth(new Error("connection timed out")),
		).toBe(false);
	});
});
