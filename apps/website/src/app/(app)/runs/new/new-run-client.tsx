"use client";

import type {
  McpConnection,
  McpTool,
  McpToolAnnotations,
  RunBriefDraft,
} from "@agents/contracts";
import { getMcpToolCapability } from "@agents/contracts";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Plus,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { agentsRpc, RpcRequestError } from "@/lib/rpc";

const terminalError = (error: unknown) =>
  error instanceof Error ? error.message : "The run could not be started.";

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const toolAnnotations = (tool: McpTool): McpToolAnnotations | null =>
  tool.annotations && typeof tool.annotations === "object"
    ? (tool.annotations as McpToolAnnotations)
    : null;

export function NewRunClient() {
  const router = useRouter();
  const { session, isInitialized } = useAuthSession();
  const [connections, setConnections] = useState<readonly McpConnection[]>([]);
  const [tools, setTools] = useState<readonly McpTool[]>([]);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [goal, setGoal] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [allowedOutcomeBoundary, setAllowedOutcomeBoundary] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTools = useCallback(async () => {
    try {
      const nextConnections = await agentsRpc.listConnections();
      const connected = nextConnections.filter(
        (connection) => connection.status === "connected",
      );
      const toolGroups = await Promise.all(
        connected.map((connection) => agentsRpc.listTools(connection.id)),
      );
      setConnections(nextConnections);
      setTools(
        toolGroups
          .flat()
          .filter((tool) => tool.enabled && tool.available)
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      setError(null);
    } catch (requestError) {
      if (
        requestError instanceof RpcRequestError &&
        requestError.tag === "Unauthorized"
      ) {
        if (isDevAuthEnabled()) {
          setError(terminalError(requestError));
          return;
        }
        router.replace("/login");
        return;
      }
      setError(terminalError(requestError));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }
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
    void loadTools();
  }, [isInitialized, loadTools, router, session]);

  const selectedTools = useMemo(
    () => tools.filter((tool) => selectedToolIds.has(tool.id)),
    [selectedToolIds, tools],
  );
  const writeCapableSelected = selectedTools.some(
    (tool) => getMcpToolCapability(toolAnnotations(tool)).writeCapable,
  );

  const toggleTool = (toolId: string) => {
    setSelectedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (selectedTools.length === 0) {
      setError("Select at least one approved MCP tool.");
      return;
    }
    if (lines(successCriteria).length === 0 || !expectedOutput.trim()) {
      setShowBrief(true);
      setError("Add success criteria and the expected output before starting.");
      return;
    }
    if (writeCapableSelected && !allowedOutcomeBoundary.trim()) {
      setShowBrief(true);
      setError(
        "Describe the allowed outcome boundary for write-capable tools.",
      );
      return;
    }

    setStarting(true);
    try {
      const conversation = await agentsRpc.createConversation({
        title: goal.trim() || "Manual Agent Run",
        initialMessage: goal.trim(),
      });
      const draft: RunBriefDraft = {
        schemaVersion: "run-brief-draft.v1",
        mode: "manual_agent_run",
        goal: goal.trim(),
        successCriteria: lines(successCriteria),
        expectedOutput: expectedOutput.trim(),
        evidenceStandard: {
          freshEvidenceRequired: true,
          timeWindow: "during this manual run",
          requiredSources: selectedTools.map((tool) => tool.name),
        },
        forbiddenActions: [
          "Do not call unapproved tools",
          "Do not expose secrets",
        ],
        requiredTools: selectedTools.map((tool) => {
          const annotations = toolAnnotations(tool);
          const capability = getMcpToolCapability(annotations);
          return {
            id: `tool_auth_${tool.id}`,
            mcpConnectionId: tool.connectionId,
            mcpToolId: tool.id,
            toolName: tool.name,
            displayName: tool.title,
            description: tool.description,
            required: true,
            reason: `Required to satisfy this run: ${goal.trim()}`,
            annotations,
            state: "approved",
            acknowledgedWriteCapability: capability.writeCapable,
            allowedOutcomeBoundary: capability.writeCapable
              ? allowedOutcomeBoundary.trim()
              : null,
          };
        }),
        optionalTools: [],
        outputDestination: {
          kind: "in_app",
          destinationRef: null,
          authorized: true,
        },
        runBudgetPreset: "small",
        unavailableRequiredToolBehavior: "retry_then_partial",
        unavailableOptionalToolBehavior: "continue_degraded",
        schedule: null,
        userApprovedFinalBrief: false,
      };
      const savedBrief = await agentsRpc.saveRunBriefDraft({
        conversationId: conversation.conversation.id,
        draft,
      });
      const approvedBrief = await agentsRpc.approveRunBrief(savedBrief.id);
      const run = await agentsRpc.startManualAgentRun(approvedBrief.id);
      router.push(`/runs/${run.id}`);
    } catch (requestError) {
      setError(terminalError(requestError));
    } finally {
      setStarting(false);
    }
  };

  if (!isInitialized || loading) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-5 px-4 py-12 sm:px-6">
        <Skeleton className="h-10 w-72 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-[22px]" />
      </div>
    );
  }

  return (
    <main className="flex min-h-full w-full flex-1 flex-col bg-white">
      <form
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:pb-32"
        onSubmit={submit}
      >
        <section className="w-full">
          <div className="mb-6 flex items-center justify-center gap-3 text-center">
            <Sparkles className="size-7 text-[#d97757]" strokeWidth={1.6} />
            <h1 className="text-2xl font-medium tracking-[-0.035em] text-[#2c2b29] sm:text-[2rem]">
              What should we get done?
            </h1>
          </div>

          {error ? (
            <div
              className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-[22px] border border-black/[0.1] bg-white shadow-[0_6px_24px_rgba(0,0,0,0.06)] transition-shadow focus-within:shadow-[0_8px_28px_rgba(0,0,0,0.09)]">
            <Label className="sr-only" htmlFor="goal">
              Goal
            </Label>
            <Textarea
              className="min-h-28 resize-none rounded-none border-0 bg-transparent px-5 py-4 text-[15px] leading-6 shadow-none focus-visible:ring-0"
              id="goal"
              minLength={12}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="How can the agent help?"
              required
              value={goal}
            />

            {showBrief ? (
              <div className="mx-3 grid gap-2 border-t border-black/[0.06] py-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f6f6f5] p-3">
                  <Label
                    className="text-xs text-[#76746f]"
                    htmlFor="successCriteria"
                  >
                    Success criteria
                  </Label>
                  <Textarea
                    className="mt-1 min-h-20 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:ring-0"
                    id="successCriteria"
                    onChange={(event) => setSuccessCriteria(event.target.value)}
                    placeholder={
                      "Use current tool data\nSeparate evidence from interpretation"
                    }
                    value={successCriteria}
                  />
                </div>
                <div className="rounded-xl bg-[#f6f6f5] p-3">
                  <Label
                    className="text-xs text-[#76746f]"
                    htmlFor="expectedOutput"
                  >
                    Expected output
                  </Label>
                  <Textarea
                    className="mt-1 min-h-20 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-5 shadow-none focus-visible:ring-0"
                    id="expectedOutput"
                    onChange={(event) => setExpectedOutput(event.target.value)}
                    placeholder="Evidence, summary, and interpretation"
                    value={expectedOutput}
                  />
                </div>
                {writeCapableSelected ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 sm:col-span-2">
                    <Label
                      className="text-xs text-amber-900"
                      htmlFor="allowedOutcomeBoundary"
                    >
                      Allowed outcome boundary
                    </Label>
                    <Input
                      className="mt-2 h-9 rounded-lg border-amber-200 bg-white"
                      id="allowedOutcomeBoundary"
                      onChange={(event) =>
                        setAllowedOutcomeBoundary(event.target.value)
                      }
                      placeholder="Example: draft only, never send or trade"
                      value={allowedOutcomeBoundary}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-1 px-3 pb-3 pt-1">
              <button
                aria-label={
                  showBrief ? "Hide run brief" : "Configure run brief"
                }
                className="flex size-8 items-center justify-center rounded-full text-[#66645f] transition hover:bg-[#f1f1ef]"
                onClick={() => setShowBrief((current) => !current)}
                type="button"
              >
                {showBrief ? (
                  <SlidersHorizontal className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
              </button>
              <button
                className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-[#66645f] transition hover:bg-[#f1f1ef]"
                onClick={() => setShowBrief((current) => !current)}
                type="button"
              >
                <SlidersHorizontal className="size-3.5" />
                Run brief
              </button>
              <span className="hidden text-xs text-[#92908b] sm:inline">
                {
                  connections.filter(
                    (connection) => connection.status === "connected",
                  ).length
                }{" "}
                connected
              </span>
              <Button
                className="ml-auto size-8 rounded-full bg-[#202123] p-0 text-white hover:bg-black"
                disabled={starting || tools.length === 0}
                type="submit"
              >
                {starting ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <SendHorizontal />
                )}
                <span className="sr-only">Start run</span>
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {tools.length === 0 ? (
              <p className="rounded-lg border border-dashed border-black/[0.1] px-3 py-2 text-xs text-[#77756f]">
                Connect a server and enable a tool to start.
              </p>
            ) : (
              tools.map((tool) => {
                const capability = getMcpToolCapability(toolAnnotations(tool));
                const selected = selectedToolIds.has(tool.id);
                return (
                  <button
                    className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition ${
                      selected
                        ? "border-[#2c2b29] bg-[#2c2b29] text-white"
                        : "border-black/[0.1] bg-white text-[#4f4d48] hover:bg-[#f7f7f5]"
                    }`}
                    key={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    type="button"
                  >
                    <Wrench className="size-3.5" />
                    <span className="truncate">{tool.name}</span>
                    <span
                      className={selected ? "text-white/60" : "text-[#9a9892]"}
                    >
                      {capability.readOnly ? "read" : "write"}
                    </span>
                    {selected ? <CheckCircle2 className="size-3.5" /> : null}
                  </button>
                );
              })
            )}
          </div>
        </section>
      </form>
    </main>
  );
}
