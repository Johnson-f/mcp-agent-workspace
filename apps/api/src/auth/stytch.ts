import * as stytch from "stytch";

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  expiresAt: string | null;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

let client: stytch.Client | undefined;

const getStytchEnvironment = (projectId: string): string => {
  const configuredEnvironment = process.env.STYTCH_ENV;

  if (configuredEnvironment === "test") {
    return stytch.envs.test;
  }

  if (configuredEnvironment === "live") {
    return stytch.envs.live;
  }

  if (configuredEnvironment) {
    throw new AuthConfigurationError(
      "STYTCH_ENV must be either 'test' or 'live'.",
    );
  }

  return projectId.startsWith("project-live-")
    ? stytch.envs.live
    : stytch.envs.test;
};

const getStytchClient = (): stytch.Client => {
  if (client) {
    return client;
  }

  const projectId = process.env.STYTCH_PROJECT_ID;
  const secret = process.env.STYTCH_SECRET;

  if (!projectId || !secret) {
    throw new AuthConfigurationError(
      "STYTCH_PROJECT_ID and STYTCH_SECRET must be configured.",
    );
  }

  client = new stytch.Client({
    project_id: projectId,
    secret,
    env: getStytchEnvironment(projectId),
    timeout: 5_000,
  });

  return client;
};

const readCookie = (request: Request, name: string): string | null => {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = cookie.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }

    return decodeURIComponent(cookie.slice(separator + 1).trim());
  }

  return null;
};

const readSessionJwt = (request: Request): string | null => {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token || null;
  }

  return readCookie(request, "stytch_session_jwt");
};

const readDevAuthenticatedUser = (request: Request): AuthenticatedUser | null => {
  if (
    process.env.AUTH_DEV_BYPASS !== "true" ||
    process.env.NODE_ENV === "production"
  ) {
    return null;
  }

  const devUserId =
    request.headers.get("x-agents-dev-user-id")?.trim() ??
    readCookie(request, "agents_dev_user_id")?.trim();
  if (!devUserId) {
    return null;
  }

  return {
    userId: `dev:${devUserId}`,
    sessionId: `dev-session:${devUserId}`,
    expiresAt: null,
  };
};

export const authenticateRequest = async (
  request: Request,
): Promise<AuthenticatedUser | null> => {
  const devUser = readDevAuthenticatedUser(request);
  if (devUser) {
    return devUser;
  }

  const sessionJwt = readSessionJwt(request);

  if (!sessionJwt) {
    return null;
  }

  try {
    const { session } = await getStytchClient().sessions.authenticateJwt({
      session_jwt: sessionJwt,
    });

    return {
      userId: session.user_id,
      sessionId: session.session_id,
      expiresAt: session.expires_at ?? null,
    };
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      throw error;
    }

    return null;
  }
};
