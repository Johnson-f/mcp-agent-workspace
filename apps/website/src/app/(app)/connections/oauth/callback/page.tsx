"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { agentsRpc } from "@/lib/rpc";

function McpOAuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const state = searchParams.get("state");
    const code = searchParams.get("code");
    const iss = searchParams.get("iss") ?? undefined;
    const oauthError = searchParams.get("error");

    if (oauthError || !state || !code) {
      setError(
        oauthError
          ? "The MCP server denied authorization."
          : "The OAuth callback is missing required values.",
      );
      return;
    }

    void agentsRpc
      .completeOAuth({ state, code, iss })
      .then(() => {
        router.replace("/connections");
        router.refresh();
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "OAuth authorization could not be completed.",
        );
      });
  }, [router, searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
      <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
        {error ? (
          <>
            <h1 className="text-xl font-semibold">Authorization failed</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600">{error}</p>
            <button
              className="mt-6 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white"
              onClick={() => router.replace("/connections")}
              type="button"
            >
              Return to connections
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="mx-auto size-5 animate-spin text-zinc-500" />
            <h1 className="mt-4 text-xl font-semibold">
              Finishing authorization
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              Exchanging the authorization code and discovering tools.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function McpOAuthCallbackPage() {
  return (
    <Suspense>
      <McpOAuthCallbackContent />
    </Suspense>
  );
}
