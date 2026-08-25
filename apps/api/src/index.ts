import Fastify from "fastify";
import websocket from "@fastify/websocket";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  getGreetingResult,
  startGreetingWorkflow,
} from "@agents/agent-runtime";
import {
  DatabaseConfigurationError,
  DisabledUserError,
  upsertAuthenticatedUser,
} from "@agents/db";
import {
  AuthConfigurationError,
  authenticateRequest,
} from "./auth/stytch";
import { rpcServer } from "./rpc/server";
import { registerConversationWebSocket } from "./conversation-websocket";

const toWebRequest = (request: FastifyRequest) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, String(value));
    }
  }

  const method = request.method.toUpperCase();
  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD" && request.body !== undefined) {
    if (typeof request.body === "string") {
      body = request.body;
    } else if (Buffer.isBuffer(request.body)) {
      body = request.body.buffer.slice(
        request.body.byteOffset,
        request.body.byteOffset + request.body.byteLength,
      ) as ArrayBuffer;
    } else {
      body = JSON.stringify(request.body);
    }
  }

  return new Request(`http://api.internal${request.url}`, {
    method,
    headers,
    body,
  });
};

const sendWebResponse = async (
  reply: FastifyReply,
  webResponse: Response,
) => {
  reply.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    reply.header(key, value);
  });

  return reply.send(Buffer.from(await webResponse.arrayBuffer()));
};

const app = Fastify({
  logger: true,
  bodyLimit: 1_048_576,
});

await app.register(websocket);
await registerConversationWebSocket(app);

app.addContentTypeParser(
  "application/ndjson",
  { parseAs: "buffer" },
  (_request, payload, done) => done(null, payload),
);

app.get("/", async () => ({ service: "api", status: "ok" }));

app.all("/rpc", async (request, reply) => {
  const webResponse = await rpcServer.handler(toWebRequest(request));
  return sendWebResponse(reply, webResponse);
});

app.get("/auth/me", async (request, reply) => {
  try {
    const identity = await authenticateRequest(toWebRequest(request));

    if (!identity) {
      return reply.status(401).send({
        error: "unauthenticated",
        message: "A valid Stytch session is required.",
      });
    }

    const user = await upsertAuthenticatedUser(identity);

    return {
      user,
      session: {
        id: identity.sessionId,
        expiresAt: identity.expiresAt,
      },
    };
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return reply.status(503).send({
        error: "authentication_not_configured",
        message: error.message,
      });
    }

    if (error instanceof DatabaseConfigurationError) {
      return reply.status(503).send({
        error: "database_not_configured",
        message: error.message,
      });
    }

    if (error instanceof DisabledUserError) {
      return reply.status(403).send({
        error: "user_disabled",
        message: error.message,
      });
    }

    throw error;
  }
});

app.post<{ Body: { name?: unknown } }>(
  "/workflows/greeting",
  async (request, reply) => {
    if (
      typeof request.body?.name !== "string" ||
      request.body.name.trim().length === 0
    ) {
      return reply.status(400).send({
        error: "invalid_request",
        message: "name is required.",
      });
    }

    return startGreetingWorkflow(request.body.name);
  },
);

app.get<{ Params: { workflowId: string } }>(
  "/workflows/:workflowId/result",
  async (request) => ({
    result: await getGreetingResult(request.params.workflowId),
  }),
);

const port = Number(process.env.PORT ?? 6020);
await app.listen({ port, host: "0.0.0.0" });
