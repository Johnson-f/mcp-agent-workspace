"use client";

import {
  OTPMethods,
  Products,
  StytchLogin,
  type StytchLoginConfig,
} from "@stytch/nextjs";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";

const sessionDurationMinutes = 7 * 24 * 60;
const config: StytchLoginConfig = {
  products: [Products.otp],
  otpOptions: {
    methods: [OTPMethods.Email],
    expirationMinutes: 5,
  },
  sessionOptions: {
    sessionDurationMinutes,
  },
};

export default function LoginPage() {
  const router = useRouter();
  const { session, isInitialized } = useAuthSession();

  useEffect(() => {
    if (isInitialized && session) {
      router.replace("/conversations/new");
    }
  }, [isInitialized, router, session]);

  if (isDevAuthEnabled()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f6]">
        <p className="text-sm text-[#73757c]">Loading your local session...</p>
      </main>
    );
  }

  if (!isInitialized || session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f6]">
        <p className="text-sm text-[#73757c]">Loading your session…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f6] p-2">
      <section className="w-full max-w-md rounded-xl border border-black/[0.07] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-8">
        <div className="mb-7 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#85878e]">
            Agents
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-[#202125]">
            Sign in to continue
          </h1>
          <p className="mt-2 text-sm text-[#73757c]">
            Return to your controlled agent workspace.
          </p>
        </div>
        <StytchLogin config={config} />
      </section>
    </main>
  );
}
