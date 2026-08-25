"use client";

import type { AgentRunDetail, RunHistoryStep } from "@agents/contracts";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileText,
  LoaderCircle,
  MessageSquareText,
  Play,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownMessage } from "@/components/markdown-message";
import {
  formatStepSummary,
  sanitizeRunOutputMarkdown,
  sanitizeTechnicalIds,
} from "@/components/run-detail-presentation";
import { Skeleton } from "@/components/ui/skeleton";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { agentsRpc, RpcRequestError } from "@/lib/rpc";

const terminalStates = new Set([
  "completed",
  "completed_partial",
  "failed",
  "cancelled",
  "expired",
  "skipped",
]);
const activeStates = new Set(["queued", "running", "waiting_for_user"]);

const statePresentation = (state: string) => {
  if (state === "unknown") {
    return {
      icon: AlertCircle,
      label: "Unavailable",
      className: "border-black/[0.08] bg-white text-[#77746d]",
    };
  }
  if (state === "completed") {
    return {
      icon: CheckCircle2,
      label: "Completed",
      className: "border-[#cfe1d3] bg-[#f2f8f3] text-[#55725b]",
    };
  }
  if (state === "failed" || state === "cancelled" || state === "expired") {
    return {
      icon: XCircle,
      label: state.charAt(0).toUpperCase() + state.slice(1),
      className: "border-[#ead2ce] bg-[#fff7f5] text-[#98584d]",
    };
  }
  if (state === "completed_partial" || state === "skipped") {
    return {
      icon: AlertCircle,
      label: state === "completed_partial" ? "Partially completed" : "Skipped",
      className: "border-[#eadcbf] bg-[#fffbf2] text-[#8a692d]",
    };
  }
  return {
    icon: LoaderCircle,
    label: state === "waiting_for_user" ? "Needs attention" : "Running",
    className: "border-[#d8d9ec] bg-[#f6f6fc] text-[#5e6290]",
  };
};

const metadataEntries = (metadata: Record<string, unknown>) => {
  const sanitized = sanitizeTechnicalIds(metadata) as Record<string, unknown>;
  return Object.entries(sanitized).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
};

const formatLabel = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const displayValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const stepIcon = (type: string) => {
  if (type === "message") return MessageSquareText;
  if (type === "brief_created" || type === "final_output") return Sparkles;
  if (type === "tool_selected") return CircleDot;
  if (type.startsWith("tool_call")) return Wrench;
  if (type === "run_failed") return XCircle;
  return Play;
};

function RunTimelineStep({
  step,
  isLast,
}: {
  step: RunHistoryStep;
  isLast: boolean;
}) {
  const StepIcon = stepIcon(step.type);
  const entries = metadataEntries(step.publicMetadata);

  return (
    <li className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
      {!isLast ? (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[0.84375rem] top-7 w-px bg-[#e2e1dc]"
        />
      ) : null}
      <span className="relative z-10 flex size-7 items-center justify-center rounded-full border border-black/[0.08] bg-white text-[#77746d] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <StepIcon className="size-3.5" />
      </span>
      <div className="min-w-0 pt-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#77746d]">
            {formatLabel(step.type)}
          </p>
          <time
            className="font-mono text-[10px] text-[#aaa7a0]"
            dateTime={step.occurredAt}
          >
            {formatTime(step.occurredAt)}
          </time>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-[#44423e]">
          {formatStepSummary(step)}
        </p>

        {entries.length > 0 || step.artifacts.length > 0 ? (
          <details className="group mt-2 rounded-lg border border-black/[0.065] bg-white">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium text-[#77746d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
              Evidence
              <span className="ml-auto font-normal text-[#aaa7a0]">
                {entries.length + step.artifacts.length}
              </span>
            </summary>
            <div className="space-y-2 border-t border-black/[0.055] p-2.5">
              {entries.map(([key, value]) => (
                <div key={key}>
                  <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-[#97948d]">
                    {formatLabel(key)}
                  </p>
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#f6f6f3] px-2.5 py-2 font-mono text-[10px] leading-4 text-[#55534e]">
                    {displayValue(value)}
                  </pre>
                </div>
              ))}
              {step.artifacts.map((artifact) => (
                <div
                  className="flex items-start gap-2 rounded-md bg-[#f6f6f3] p-2.5"
                  key={artifact.id}
                >
                  <FileText className="mt-0.5 size-3.5 shrink-0 text-[#8f8c85]" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#4a4843]">
                      {formatLabel(artifact.purpose)}
                    </p>
                    <p className="mt-1 break-words font-mono text-[10px] leading-4 text-[#77746d]">
                      {displayValue(
                        sanitizeTechnicalIds(artifact.redactedSummary),
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </li>
  );
}

export function RunDetailClient({ runId }: { runId: string }) {
  const router = useRouter();
  const { session, isInitialized } = useAuthSession();
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRun = useCallback(async () => {
    try {
      const next = await agentsRpc.getAgentRun(runId);
      setDetail(next);
      setError(null);
      return next;
    } catch (requestError) {
      if (
        requestError instanceof RpcRequestError &&
        requestError.tag === "Unauthorized"
      ) {
        if (isDevAuthEnabled()) {
          setError(requestError.message);
          return null;
        }
        router.replace("/login");
        return null;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The run could not be loaded.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [router, runId]);

  useEffect(() => {
    if (!isInitialized) return;
    if (!session) {
      if (isDevAuthEnabled()) {
        setError(
          "Local dev auth is enabled, but no local session was created.",
        );
        setLoading(false);
        return;
      }
      router.replace("/login");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const next = await loadRun();
      if (!cancelled && next && !terminalStates.has(next.run.state)) {
        timer = setTimeout(poll, 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isInitialized, loadRun, router, session]);

  const finalOutput = useMemo(
    () => sanitizeRunOutputMarkdown(detail?.finalOutputText?.trim() ?? ""),
    [detail],
  );

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/automations");
  }, [router]);

  if (!isInitialized || loading) {
    return (
      <div className="mx-auto grid w-full max-w-[82rem] gap-6 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:px-8 lg:py-10">
        <div className="space-y-4">
          <Skeleton className="h-8 w-72 rounded-lg" />
          <Skeleton className="h-[30rem] w-full rounded-2xl" />
        </div>
        <Skeleton className="h-[34rem] w-full rounded-2xl" />
      </div>
    );
  }

  const run = detail?.run;
  const presentation = statePresentation(run?.state ?? "unknown");
  const StatusIcon = presentation.icon;
  const steps = detail?.steps ?? [];

  return (
    <main className="min-h-full bg-[#fbfbfa] text-[#302f2c]">
      <div className="mx-auto grid w-full max-w-[82rem] items-start gap-y-7 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-x-8 lg:px-8 lg:py-10 xl:gap-x-12">
        <header className="border-b border-black/[0.07] pb-7 lg:sticky lg:top-0 lg:z-20 lg:col-start-1 lg:self-start lg:bg-[#fbfbfa]/95 lg:backdrop-blur-md">
          <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 bg-[#fbfbfa]/95 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
            <button
              aria-label="Back"
              className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[#77746d] transition hover:bg-black/[0.045] hover:text-[#302f2c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30"
              onClick={handleBack}
              type="button"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
            <span aria-hidden="true" className="h-4 w-px bg-black/[0.1]" />
            <span
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${presentation.className}`}
            >
              <StatusIcon
                className={`size-3.5 ${activeStates.has(run?.state ?? "") ? "animate-spin" : ""}`}
              />
              {presentation.label}
            </span>
            <span className="text-xs text-[#8c8982]">Run record</span>
          </div>
          <h1 className="mt-4 max-w-4xl text-balance text-2xl font-semibold tracking-[-0.035em] text-[#262522] sm:text-[2rem] sm:leading-[1.18]">
            {run?.title ?? "Run"}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#85827b]">
            <span>{run ? formatDate(run.createdAt) : "Date unavailable"}</span>
            <span>{steps.length} timeline steps</span>
            <span>
              {detail?.finalOutputArtifactIds.length ?? 0} final artifacts
            </span>
          </div>
        </header>

        {error ? (
          <div
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 lg:col-start-1"
            role="alert"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        <div className="order-3 min-w-0 space-y-6 lg:order-none lg:col-start-1">
          <section
            aria-labelledby="request-heading"
            className="rounded-2xl border border-black/[0.07] bg-[#f5f5f2] px-5 py-4 sm:px-6"
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8a8780]">
              <MessageSquareText className="size-3.5" />
              <h2 id="request-heading">Request</h2>
            </div>
            <p className="mt-2 text-[14px] leading-6 text-[#4a4843]">
              {run?.title ?? "Start the approved run."}
            </p>
          </section>

          <article
            aria-labelledby="output-heading"
            className="overflow-hidden rounded-2xl border border-black/[0.075] bg-white shadow-[0_10px_30px_rgba(29,28,25,0.045)]"
          >
            <div className="flex items-center gap-3 border-b border-black/[0.06] px-5 py-4 sm:px-7">
              <span className="flex size-8 items-center justify-center rounded-full bg-[#292926] text-white">
                <Bot className="size-4" />
              </span>
              <div>
                <h2
                  className="text-sm font-semibold text-[#302f2c]"
                  id="output-heading"
                >
                  Final output
                </h2>
                <p className="mt-0.5 text-[11px] text-[#96938c]">
                  The result produced by this run
                </p>
              </div>
            </div>
            <div className="px-5 py-6 sm:px-7 sm:py-7">
              {finalOutput ? (
                <MarkdownMessage
                  content={finalOutput}
                  className="text-[15px] leading-7 text-[#373632]"
                />
              ) : (
                <div className="flex min-h-40 flex-col items-center justify-center text-center">
                  <LoaderCircle className="size-5 animate-spin text-[#8c8982]" />
                  <p className="mt-3 text-sm font-medium text-[#55534e]">
                    Waiting for final output
                  </p>
                  <p className="mt-1 text-xs text-[#96938c]">
                    This report will update when the run finishes.
                  </p>
                </div>
              )}
            </div>
          </article>
        </div>

        <aside
          aria-labelledby="timeline-heading"
          className="order-2 rounded-2xl border border-black/[0.07] bg-[#f5f5f2] p-4 sm:p-5 lg:sticky lg:top-4 lg:order-none lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:max-h-[calc(100svh-5.5rem)] lg:overflow-y-auto lg:overscroll-contain"
        >
          <div className="flex items-start justify-between gap-3 border-b border-black/[0.065] pb-4">
            <div>
              <h2
                className="text-sm font-semibold text-[#302f2c]"
                id="timeline-heading"
              >
                Execution timeline
              </h2>
              <p className="mt-1 text-[11px] leading-4 text-[#8c8982]">
                Tools, evidence, and durable events
              </p>
            </div>
            <span className="rounded-full bg-white px-2 py-1 font-mono text-[10px] text-[#8c8982] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {steps.length}
            </span>
          </div>

          {steps.length > 0 ? (
            <ol className="mt-5">
              {steps.map((step, index) => (
                <RunTimelineStep
                  isLast={index === steps.length - 1}
                  key={step.id}
                  step={step}
                />
              ))}
            </ol>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <CircleDot className="size-5 text-[#aaa7a0]" />
              <p className="mt-2 text-xs text-[#77746d]">
                Timeline events will appear here.
              </p>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
