"use client";

import type { AutomationDetail } from "@agents/contracts";
import {
  AlertCircle,
  Bot,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { agentsRpc } from "@/lib/rpc";

const record = (value: unknown) =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export function AutomationDetailClient({
  automationId,
}: {
  automationId: string;
}) {
  const router = useRouter();
  const { isInitialized, session } = useAuthSession();
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await agentsRpc.getAutomation(automationId));
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Automation could not be loaded.",
      );
    }
  }, [automationId]);

  useEffect(() => {
    if (!isInitialized) return;
    if (!session) {
      if (!isDevAuthEnabled()) router.replace("/login");
      return;
    }
    void load();
  }, [isInitialized, load, router, session]);

  const runNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const run = await agentsRpc.runAutomationNow(automationId);
      router.push(`/runs/${run.id}`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Automation Run could not be started.",
      );
      await load();
    } finally {
      setRunning(false);
    }
  };

  if (!detail) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const schedule = record(detail.schedule);
  const runBudget = record(detail.runBudget);
  const output = record(detail.outputDestination);

  return (
    <main className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-black/[0.06] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f3f3f4] text-[#666870]">
              <Bot className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-[-0.025em] text-[#26272b]">
                  {detail.automation.title}
                </h1>
                <Badge className="rounded-md" variant="outline">
                  {detail.automation.state.replaceAll("_", " ")}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[#74767e]">
                {detail.automation.scheduleLabel}
              </p>
            </div>
          </div>
          <Button
            className="rounded-lg"
            disabled={!detail.canRunNow || running}
            onClick={() => void runNow()}
            type="button"
          >
            {running ? <LoaderCircle className="animate-spin" /> : <Play />}
            Run now
          </Button>
        </header>

        {error ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="size-4" />
            {error}
          </p>
        ) : null}
        {detail.runNowBlocker ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {detail.runNowBlocker}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <section className="rounded-xl border border-black/[0.07] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-[#70727a]" />
              Schedule
            </div>
            <p className="mt-3 text-sm text-[#4f5158]">
              {schedule.kind === "recurring"
                ? String(schedule.rule ?? "Recurring")
                : "No schedule"}
            </p>
            <p className="mt-1 text-xs text-[#8a8c93]">
              {schedule.kind === "recurring"
                ? String(schedule.timezone ?? "UTC")
                : "Use Run now whenever this work is needed."}
            </p>
          </section>
          <section className="rounded-xl border border-black/[0.07] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-[#70727a]" />
              Permissions
            </div>
            <p className="mt-3 text-sm text-[#4f5158]">
              {detail.toolAuthorizations.length} approved tools
            </p>
            <p className="mt-1 text-xs text-[#8a8c93]">
              Using the approved automation configuration.
            </p>
          </section>
          <section className="rounded-xl border border-black/[0.07] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-[#70727a]" />
              Run policy
            </div>
            <p className="mt-3 text-sm capitalize text-[#4f5158]">
              {String(runBudget.preset ?? "standard")} budget
            </p>
            <p className="mt-1 text-xs text-[#8a8c93]">
              Output: {String(output.kind ?? "in_app").replaceAll("_", " ")}
            </p>
          </section>
        </div>

        <section className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-[#26272b]">
                Run history
              </h2>
              <p className="mt-0.5 text-xs text-[#8a8c93]">
                Manual and scheduled triggers share this history.
              </p>
            </div>
            <Link
              className="flex items-center gap-1 text-xs text-[#666870] hover:text-[#26272b]"
              href={`/conversations/${detail.conversationId}`}
            >
              Conversation
              <ExternalLink className="size-3" />
            </Link>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-black/[0.07]">
            {detail.recentRuns.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[#8a8c93]">
                This Automation has not run yet.
              </p>
            ) : (
              detail.recentRuns.map((run, index) => (
                <Link
                  className={`flex items-center gap-3 px-4 py-3 text-sm hover:bg-[#fafafa] ${index > 0 ? "border-t border-black/[0.06]" : ""}`}
                  href={`/runs/${run.id}`}
                  key={run.id}
                >
                  <span className="size-1.5 rounded-full bg-[#5b63f6]" />
                  <span className="capitalize text-[#4f5158]">
                    {run.triggerSource}
                  </span>
                  <span className="capitalize text-[#777980]">
                    {run.state.replaceAll("_", " ")}
                  </span>
                  <time className="ml-auto text-xs text-[#96989e]">
                    {new Date(run.createdAt).toLocaleString()}
                  </time>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
