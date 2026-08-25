import { Cable, LockKeyhole, MessageSquarePlus, Waypoints } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-svh bg-[#f5f5f6] p-1.5 sm:p-2">
      <div className="mx-auto flex min-h-[calc(100svh-0.75rem)] max-w-[96rem] overflow-hidden rounded-xl border border-black/[0.07] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:min-h-[calc(100svh-1rem)]">
        <aside className="hidden w-[13.5rem] shrink-0 border-r border-black/[0.05] bg-[#f5f5f6] p-3 md:flex md:flex-col">
          <div className="flex h-9 items-center gap-2 px-2 text-sm font-semibold text-[#26272b]">
            <span className="flex size-6 items-center justify-center rounded-md border border-black/[0.07] bg-white">
              <Waypoints className="size-3.5" />
            </span>
            Agents
          </div>
          <p className="mb-1.5 mt-6 px-2 text-[11px] text-[#85878e]">
            Workspace
          </p>
          <div className="space-y-0.5 text-[13px]">
            <div className="flex h-8 items-center gap-2.5 rounded-lg bg-[#e8e8eb] px-2 font-medium text-[#202125]">
              <MessageSquarePlus className="size-3.5" />
              New run
            </div>
            <div className="flex h-8 items-center gap-2.5 rounded-lg px-2 text-[#70727a]">
              <Cable className="size-3.5" />
              Connections
            </div>
          </div>
          <div className="mt-auto flex items-center gap-2 border-t border-black/[0.05] px-2 pt-3 text-[11px] text-[#85878e]">
            <LockKeyhole className="size-3.5" />
            Controlled by default
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 items-center border-b border-black/[0.06] px-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#25262a]">
              <Waypoints className="size-3.5 text-[#666870]" />
              Secure agent workspace
            </div>
            <Link
              className="ml-auto inline-flex h-7 items-center rounded-lg border border-black/[0.08] px-2.5 text-xs font-medium text-[#303136] transition hover:bg-[#f5f5f6]"
              href="/login"
            >
              Sign in
            </Link>
          </header>

          <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
            <div className="max-w-xl">
              <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-[#f2f2f3] text-[#65676e]">
                <Waypoints className="size-4.5" />
              </span>
              <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-[#85878e]">
                Agents
              </p>
              <h1 className="mt-2 text-balance text-3xl font-semibold tracking-[-0.035em] text-[#202125] sm:text-4xl">
                Connect tools. Run work. Keep control.
              </h1>
              <p className="mx-auto mt-4 max-w-lg text-pretty text-sm leading-6 text-[#73757c] sm:text-base">
                Approve exactly what an agent may use, run it durably, and keep
                a clear record of every meaningful step.
              </p>
              <Link
                className="mt-7 inline-flex h-9 items-center rounded-lg bg-[#202125] px-4 text-sm font-medium text-white transition hover:bg-black focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#5b63f6]/30"
                href="/login"
              >
                Open workspace
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
