"use client";

import { createContext, type ReactNode, useContext } from "react";

export interface AppAuthSession {
  readonly isInitialized: boolean;
  readonly session: unknown | null;
}

const AuthSessionContext = createContext<AppAuthSession>({
  isInitialized: false,
  session: null,
});

export const isDevAuthEnabled = () =>
  process.env.NEXT_PUBLIC_DEV_AUTH_ENABLED === "true";

export function AuthSessionProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AppAuthSession;
}) {
  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function DevAuthSessionProvider({ children }: { children: ReactNode }) {
  const devUserId = process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID ?? "local";

  return (
    <AuthSessionProvider
      value={{
        isInitialized: true,
        session: {
          session_id: `dev-session:${devUserId}`,
        },
      }}
    >
      {children}
    </AuthSessionProvider>
  );
}

export const useAuthSession = () => useContext(AuthSessionContext);
