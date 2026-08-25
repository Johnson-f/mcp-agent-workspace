"use client";

import type {
  AutomationSummary,
  ProductAutomationState,
} from "@agents/contracts";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  Plus,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { agentsRpc } from "@/lib/rpc";
import {
  type AutomationSection,
  automationSection,
  formatAutomationSchedule,
  sortAutomationSummaries,
} from "./automation-view-model";

const statePresentation = (state: ProductAutomationState) => {
  if (state === "live") {
    return {
      label: "Active",
      className: "border-[#cfe1d3] bg-[#f2f8f3] text-[#55725b]",
    };
  }
  if (state === "needs_reconfiguration") {
    return {
      label: "Needs attention",
      className: "border-[#eadcbf] bg-[#fffbf2] text-[#8a692d]",
    };
  }
  if (state === "pending_approval") {
    return {
      label: "Pending approval",
      className: "border-[#d8d9ec] bg-[#f6f6fc] text-[#5e6290]",
    };
  }
  return {
    label:
      state === "draft" ? "Draft" : state === "paused" ? "Paused" : "Archived",
    className: "border-black/[0.08] bg-[#f3f3f4] text-[#666870]",
  };
};

const runPresentation = (state: AutomationSummary["latestRunState"]) => {
  if (state === "completed") {
    return {
      label: "Completed",
      icon: CheckCircle2,
      className: "text-[#66836b]",
    };
  }
  if (state === "failed" || state === "cancelled" || state === "expired") {
    return { label: "Failed", icon: XCircle, className: "text-[#a35d52]" };
  }
  if (
    state === "running" ||
    state === "queued" ||
    state === "waiting_for_user"
  ) {
    return {
      label: "In progress",
      icon: LoaderCircle,
      className: "text-[#666a9a]",
    };
  }
  if (state === "completed_partial" || state === "skipped") {
    return {
      label: "Partial",
      icon: TriangleAlert,
      className: "text-[#9a712f]",
    };
  }
  return {
    label: "Never run",
    icon: CircleDashed,
    className: "text-[#999791]",
  };
};

const sectionCopy: Record<
  AutomationSection,
  { title: string; description: string }
> = {
  needs_attention: {
    title: "Needs attention",
    description: "Review these before the next run.",
  },
  active: {
    title: "Active",
    description: "Approved and ready to run.",
  },
  inactive: {
    title: "Paused and drafts",
    description: "Not currently running on schedule.",
  },
};

const formatRunTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "No run history";

function AutomationCard({ automation }: { automation: AutomationSummary }) {
  const state = statePresentation(automation.state);
  const latestRun = runPresentation(automation.latestRunState);
  const LatestRunIcon = latestRun.icon;
  const schedule = formatAutomationSchedule(automation.scheduleLabel);

  return (
    <Link
      className="group flex min-h-56 flex-col overflow-hidden rounded-2xl border border-black/[0.075] bg-white transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-black/[0.14] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#5b63f6]/25"
      href={`/automations/${automation.id}`}
    >
      <div className="flex items-start gap-3 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.055] bg-[#f4f4f2] text-[#66645f]">
          <Bot className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="max-w-[38rem] text-[15px] font-semibold leading-5 text-[#302f2c]">
              {automation.title}
            </h3>
            <Badge
              className={`rounded-full ${state.className}`}
              variant="outline"
            >
              {state.label}
            </Badge>
          </div>
          {automation.needsAttentionReason ? (
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-[#8a692d]">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {automation.needsAttentionReason}
            </p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-[#85827b]">
              Approved work with a durable run history.
            </p>
          )}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-2 border-y border-black/[0.06] bg-[#f7f7f4]">
        <div className="min-w-0 px-5 py-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#96938c]">
            <CalendarClock className="size-3.5" />
            Schedule
          </p>
          <p className="mt-2 truncate text-[13px] font-medium text-[#44423e]">
            {schedule}
          </p>
          <p className="mt-0.5 text-[11px] text-[#96938c]">
            {schedule === "Run manually" ? "On demand" : "Approved schedule"}
          </p>
        </div>
        <div className="min-w-0 border-l border-black/[0.06] px-5 py-4">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#96938c]">
            <LatestRunIcon
              className={`size-3.5 ${latestRun.className} ${latestRun.label === "In progress" ? "animate-spin" : ""}`}
            />
            Latest run
          </p>
          <p className="mt-2 text-[13px] font-medium text-[#44423e]">
            {latestRun.label}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[#96938c]">
            {formatRunTime(automation.latestRunAt)}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 px-5 py-3 text-xs font-medium text-[#77746d] transition-colors group-hover:text-[#302f2c]">
        View automation
        <ArrowUpRight className="size-3.5" />
      </div>
    </Link>
  );
}

export function AutomationsClient() {
  const router = useRouter();
  const { isInitialized, session } = useAuthSession();
  const [automations, setAutomations] = useState<readonly AutomationSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAutomations(await agentsRpc.listAutomations());
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Automations could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    if (!session) {
      if (!isDevAuthEnabled()) router.replace("/login");
      return;
    }
    void load();
  }, [isInitialized, load, router, session]);

  const ordered = useMemo(
    () => sortAutomationSummaries([...automations]),
    [automations],
  );
  const groups = useMemo(
    () =>
      (["needs_attention", "active", "inactive"] as const)
        .map((key) => ({
          key,
          items: ordered.filter(
            (automation) => automationSection(automation.state) === key,
          ),
        }))
        .filter((group) => group.items.length > 0),
    [ordered],
  );
  const activeCount = ordered.filter(
    (automation) => automationSection(automation.state) === "active",
  ).length;

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-7 sm:px-6 lg:px-8">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <main className="min-h-full bg-[#fbfbfa]">
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
        <section className="flex flex-col gap-4 border-b border-black/[0.07] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#96938c]">
              Automation library
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#262522]">
              Scheduled work
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#77746d]">
              Manage approved work and see what ran last.
            </p>
          </div>
          <p className="text-xs text-[#85827b]">
            <span className="font-semibold text-[#302f2c]">
              {ordered.length}
            </span>{" "}
            {ordered.length === 1 ? "automation" : "automations"}
            <span className="mx-2 text-[#c2c0ba]">·</span>
            <span className="font-semibold text-[#55725b]">{activeCount}</span>{" "}
            active
          </p>
        </section>

        {error ? (
          <p className="mt-6 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="size-4" />
            {error}
          </p>
        ) : null}

        {ordered.length === 0 ? (
          <div className="mt-7 flex min-h-[28rem] flex-col items-center justify-center rounded-2xl border border-dashed border-black/[0.1] bg-white text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-[#f3f3f1] text-[#6d6f76]">
              <Bot className="size-4.5" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-[#26272b]">
              No automations yet
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-5 text-[#74767e]">
              Approve a conversation as repeatable work, then run it now or add
              a schedule.
            </p>
            <Button
              className="mt-5 rounded-lg"
              render={<Link href="/conversations/new" />}
              nativeButton={false}
            >
              <Plus />
              New automation
            </Button>
          </div>
        ) : (
          <div className="mt-7 space-y-9">
            {groups.map((group) => (
              <section aria-labelledby={`${group.key}-heading`} key={group.key}>
                <div className="mb-3 flex items-end justify-between gap-4">
                  <div>
                    <h2
                      className="text-sm font-semibold text-[#302f2c]"
                      id={`${group.key}-heading`}
                    >
                      {sectionCopy[group.key].title}
                    </h2>
                    <p className="mt-0.5 text-xs text-[#96938c]">
                      {sectionCopy[group.key].description}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#f0f0ed] px-2 py-1 font-mono text-[10px] text-[#85827b]">
                    {group.items.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,27rem),1fr))] gap-4">
                  {group.items.map((automation) => (
                    <AutomationCard
                      automation={automation}
                      key={automation.id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
