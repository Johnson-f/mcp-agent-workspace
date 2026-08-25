"use client";

import {
  createStytchClient,
  StytchProvider,
  useStytchSession,
} from "@stytch/nextjs";
import { type ReactNode, useMemo } from "react";
import {
  AuthSessionProvider,
  DevAuthSessionProvider,
  isDevAuthEnabled,
} from "@/lib/auth-session";

interface AuthProviderProps {
  children: ReactNode;
}

function StytchSessionBridge({ children }: AuthProviderProps) {
  const { session, isInitialized } = useStytchSession();

  return (
    <AuthSessionProvider value={{ isInitialized, session }}>
      {children}
    </AuthSessionProvider>
  );
}

function StytchAuthProvider({ children }: AuthProviderProps) {
  const publicToken = process.env.NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN;
  const stytch = useMemo(
    () => (publicToken ? createStytchClient(publicToken) : null),
    [publicToken],
  );

  if (!stytch) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6">
        <div className="max-w-md rounded-2xl border bg-white p-8 shadow-sm">
          <h1 className="text-xl font-semibold">
            Authentication is not configured
          </h1>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            Add <code>NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN</code> to the website
            environment, then restart the development server.
          </p>
        </div>
      </main>
    );
  }

  return (
    <StytchProvider stytch={stytch}>
      <StytchSessionBridge>{children}</StytchSessionBridge>
    </StytchProvider>
  );
}

export function AuthProvider({ children }: AuthProviderProps) {
  if (isDevAuthEnabled()) {
    return <DevAuthSessionProvider>{children}</DevAuthSessionProvider>;
  }

  return <StytchAuthProvider>{children}</StytchAuthProvider>;
}
