"use client";

import type {
  McpConnection,
  McpTool,
  McpToolCallResult,
} from "@agents/contracts";
import {
  Check,
  ChevronDown,
  Clock3,
  Globe2,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  connectionToolStats,
  formatConnectionStatus,
  formatConnectionToolName,
} from "./connection-presentation";
import {
  type ConnectionToolFilter,
  filterConnectionTools,
  isWriteCapableConnectionTool,
  selectAllVisibleToolIds,
} from "./connection-tool-selection";
import {
  authTypeLabel,
  statusStyles,
  type ToolActionHandlers,
} from "./connection-utils";

interface ConnectionCardProps {
  connection: McpConnection;
  tools: readonly McpTool[] | undefined;
  busyId: string | null;
  testingToolId: string | null;
  argumentDrafts: Record<string, string>;
  callResults: Record<string, McpToolCallResult>;
  pendingApproval: {
    callId: string;
    toolId: string;
    arguments: Record<string, unknown>;
  } | null;
  onRefresh: (connectionId: string) => void;
  onShowTools: (connectionId: string) => void;
  onDeleteRequest: (connection: McpConnection) => void;
  onArgumentDraftChange: (toolId: string, value: string) => void;
  toolActions: ToolActionHandlers;
}

export function ConnectionCard({
  connection,
  tools,
  busyId,
  testingToolId,
  argumentDrafts,
  callResults,
  pendingApproval,
  onRefresh,
  onShowTools,
  onDeleteRequest,
  onArgumentDraftChange,
  toolActions,
}: ConnectionCardProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ConnectionToolFilter>("all");
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmEnableAll, setConfirmEnableAll] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const visibleTools = useMemo(
    () => filterConnectionTools(tools ?? [], { query, filter }),
    [filter, query, tools],
  );
  const selectedTools = useMemo(
    () => (tools ?? []).filter((tool) => selectedToolIds.has(tool.id)),
    [selectedToolIds, tools],
  );
  const availableTools = useMemo(
    () => (tools ?? []).filter((tool) => tool.available),
    [tools],
  );
  const disabledReadOnlyTools = useMemo(
    () =>
      availableTools.filter(
        (tool) => !tool.enabled && !isWriteCapableConnectionTool(tool),
      ),
    [availableTools],
  );
  const disabledAvailableTools = useMemo(
    () => availableTools.filter((tool) => !tool.enabled),
    [availableTools],
  );
  const writeToolsToEnable = disabledAvailableTools.filter(
    isWriteCapableConnectionTool,
  );
  const allVisibleSelected =
    visibleTools.length > 0 &&
    visibleTools.every((tool) => selectedToolIds.has(tool.id));
  const someVisibleSelected = visibleTools.some((tool) =>
    selectedToolIds.has(tool.id),
  );
  const bulkBusy = busyId === connection.id;
  const toolStats = connectionToolStats(tools ?? []);
  const lastConnected = connection.lastConnectedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(connection.lastConnectedAt))
    : "Not connected yet";

  useEffect(() => {
    const validIds = new Set((tools ?? []).map((tool) => tool.id));
    setSelectedToolIds(
      (current) =>
        new Set([...current].filter((toolId) => validIds.has(toolId))),
    );
  }, [tools]);

  const applyBulkUpdate = async (
    toolIds: string[],
    update: Partial<Pick<McpTool, "enabled" | "approvalMode">>,
  ) => {
    if (toolIds.length === 0) return;
    try {
      await toolActions.updatePolicies(connection.id, toolIds, update);
      setSelectedToolIds((current) => {
        const next = new Set(current);
        for (const toolId of toolIds) next.delete(toolId);
        return next;
      });
    } catch {
      // The owning page renders the RPC error.
    }
  };

  return (
    <section
      className={cn(
        "overflow-visible rounded-2xl border border-black/[0.075] bg-white transition-colors hover:border-black/[0.13]",
        tools && "lg:col-span-2",
      )}
      key={connection.id}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-5">
        <div className="flex min-w-0 gap-3.5">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.055] bg-[#f4f4f2] text-[#66645f]">
            <Server className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight text-[#202123]">
                {connection.name}
              </h3>
              <Badge
                className={statusStyles[connection.status]}
                variant="outline"
              >
                {connection.status === "connected" ? (
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                ) : null}
                {formatConnectionStatus(connection.status)}
              </Badge>
            </div>
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[#77746d]">
              <Globe2 className="size-3.5 shrink-0 text-[#999791]" />
              <span className="truncate font-mono text-[11px]">
                {connection.endpointUrl}
              </span>
            </p>
            {connection.lastErrorMessage ? (
              <p className="mt-3 text-xs leading-5 text-destructive">
                {connection.lastErrorMessage}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="h-8 rounded-lg px-2.5 text-xs"
            disabled={busyId === connection.id}
            onClick={() => onRefresh(connection.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw
              className={busyId === connection.id ? "animate-spin" : ""}
            />
            Refresh
          </Button>
          <div className="relative">
            <Button
              aria-label={`More actions for ${connection.name}`}
              onClick={() => setActionsOpen((current) => !current)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreHorizontal />
            </Button>
            {actionsOpen ? (
              <div className="absolute right-0 top-9 z-20 w-44 rounded-xl border border-black/[0.08] bg-white p-1.5 text-xs">
                <button
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-red-700 hover:bg-red-50"
                  disabled={busyId === connection.id}
                  onClick={() => {
                    setActionsOpen(false);
                    onDeleteRequest(connection);
                  }}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                  Remove connection
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 border-y border-black/[0.06] bg-[#f7f7f4]">
        <div className="min-w-0 px-4 py-3.5 sm:px-5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#96938c]">
            <KeyRound className="size-3.5" /> Authentication
          </p>
          <p className="mt-1.5 truncate text-xs font-medium text-[#44423e]">
            {authTypeLabel(connection.authType)}
          </p>
        </div>
        <div className="min-w-0 border-l border-black/[0.06] px-4 py-3.5 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#96938c]">
            Server
          </p>
          <p className="mt-1.5 truncate text-xs font-medium text-[#44423e]">
            {connection.serverName ?? "Awaiting discovery"}
            {connection.serverVersion ? ` ${connection.serverVersion}` : ""}
          </p>
        </div>
        <div className="min-w-0 border-l border-black/[0.06] px-4 py-3.5 sm:px-5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#96938c]">
            <Clock3 className="size-3.5" /> Last checked
          </p>
          <p className="mt-1.5 truncate text-xs font-medium text-[#44423e]">
            {lastConnected}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-2 text-xs text-[#6b6b6b]">
          <Wrench className="size-3.5" />
          {tools
            ? `${toolStats.enabled} of ${toolStats.total} tools enabled`
            : "Tools ready for review"}
          {connection.protocolVersion ? (
            <span className="text-[#aaa7a0]">
              · protocol {connection.protocolVersion}
            </span>
          ) : null}
        </div>
        <Button
          className="rounded-lg"
          disabled={busyId === connection.id}
          onClick={() => onShowTools(connection.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {tools ? "Hide tools" : "Review tools"}
          <ChevronDown
            className={`transition-transform ${tools ? "rotate-180" : ""}`}
          />
        </Button>
      </div>

      {tools ? (
        <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-black/[0.07] bg-[#fafafa] sm:mx-5 sm:mb-5">
          {tools.length > 0 ? (
            <div className="sticky top-0 z-10 space-y-3 border-b border-black/[0.07] bg-white/95 p-3 backdrop-blur-sm sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#8a8a8a]" />
                  <Input
                    aria-label={`Search ${connection.name} tools`}
                    className="h-8 rounded-lg border-black/[0.08] bg-[#f8f8f7] pl-9 text-xs"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search tools"
                    value={query}
                  />
                </div>
                <Select
                  onValueChange={(value) =>
                    setFilter(value as ConnectionToolFilter)
                  }
                  value={filter}
                >
                  <SelectTrigger
                    aria-label={`Filter ${connection.name} tools`}
                    className="h-8 rounded-lg border border-black/[0.08] bg-white text-xs"
                  >
                    <SelectValue>
                      {filter === "read_only"
                        ? "Read-only"
                        : filter === "write_capable"
                          ? "Write-capable"
                          : filter[0]?.toUpperCase() + filter.slice(1)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">All tools</SelectItem>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="read_only">Read-only</SelectItem>
                    <SelectItem value="write_capable">Write-capable</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-xs text-[#55545a]">
                  <input
                    aria-label={`Select all visible ${connection.name} tools`}
                    checked={allVisibleSelected}
                    className="size-4 accent-[#202123]"
                    onChange={() =>
                      setSelectedToolIds((current) =>
                        selectAllVisibleToolIds(current, visibleTools),
                      )
                    }
                    ref={(element) => {
                      if (element) {
                        element.indeterminate =
                          someVisibleSelected && !allVisibleSelected;
                      }
                    }}
                    type="checkbox"
                  />
                  Select visible
                </label>
                <span className="text-[11px] text-[#8a8a8a]">
                  {visibleTools.length} shown · {toolStats.enabled} enabled ·{" "}
                  {toolStats.writeCapable} write-capable
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    className="h-7 rounded-lg px-2.5 text-xs"
                    disabled={bulkBusy || disabledReadOnlyTools.length === 0}
                    onClick={() =>
                      void applyBulkUpdate(
                        disabledReadOnlyTools.map((tool) => tool.id),
                        { enabled: true },
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Enable read-only
                  </Button>
                  <Button
                    className="h-7 rounded-lg px-2.5 text-xs"
                    disabled={bulkBusy || disabledAvailableTools.length === 0}
                    onClick={() => {
                      if (writeToolsToEnable.length > 0) {
                        setConfirmEnableAll(true);
                      } else {
                        void applyBulkUpdate(
                          disabledAvailableTools.map((tool) => tool.id),
                          { enabled: true },
                        );
                      }
                    }}
                    size="sm"
                    type="button"
                  >
                    Enable all available
                  </Button>
                </div>
              </div>

              {selectedTools.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#202123] px-3 py-2 text-white">
                  <span className="mr-1 text-xs font-medium">
                    {selectedTools.length} selected
                  </span>
                  <Button
                    className="h-7 rounded-lg border-white/15 bg-white/10 px-2.5 text-xs text-white hover:bg-white/15"
                    disabled={
                      bulkBusy || selectedTools.some((tool) => !tool.available)
                    }
                    onClick={() =>
                      void applyBulkUpdate(
                        selectedTools.map((tool) => tool.id),
                        { enabled: true },
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Enable
                  </Button>
                  <Button
                    className="h-7 rounded-lg border-white/15 bg-white/10 px-2.5 text-xs text-white hover:bg-white/15"
                    disabled={bulkBusy}
                    onClick={() =>
                      void applyBulkUpdate(
                        selectedTools.map((tool) => tool.id),
                        { enabled: false },
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Disable
                  </Button>
                  <Select
                    disabled={bulkBusy}
                    onValueChange={(value) =>
                      void applyBulkUpdate(
                        selectedTools.map((tool) => tool.id),
                        {
                          approvalMode: value as "always" | "risky" | "never",
                        },
                      )
                    }
                  >
                    <SelectTrigger className="h-7 rounded-lg border-white/15 bg-white/10 text-xs text-white">
                      <SelectValue>Set approval</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="always">Always ask</SelectItem>
                      <SelectItem value="risky">Ask for risky calls</SelectItem>
                      <SelectItem value="never">Never ask</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    className="ml-auto rounded-md px-2 py-1 text-[11px] text-white/65 hover:bg-white/10 hover:text-white"
                    onClick={() => setSelectedToolIds(new Set())}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tools.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">
              This server did not advertise any tools.
            </p>
          ) : visibleTools.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No tools match this search and filter.
            </p>
          ) : null}
          {visibleTools.map((tool, index) => (
            <ToolRow
              argumentDraft={argumentDrafts[tool.id] ?? "{}"}
              busyId={busyId}
              callResult={callResults[tool.id]}
              connectionId={connection.id}
              key={tool.id}
              onArgumentDraftChange={onArgumentDraftChange}
              pendingApproval={pendingApproval}
              selected={selectedToolIds.has(tool.id)}
              onSelectedChange={(selected) =>
                setSelectedToolIds((current) => {
                  const next = new Set(current);
                  if (selected) next.add(tool.id);
                  else next.delete(tool.id);
                  return next;
                })
              }
              showSeparator={index > 0}
              testing={testingToolId === tool.id}
              tool={tool}
              toolActions={toolActions}
            />
          ))}
        </div>
      ) : null}

      <AlertDialog onOpenChange={setConfirmEnableAll} open={confirmEnableAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-amber-100 text-amber-800">
              <ShieldAlert />
            </AlertDialogMedia>
            <AlertDialogTitle>Enable write-capable tools?</AlertDialogTitle>
            <AlertDialogDescription>
              This enables {disabledAvailableTools.length} available tools,
              including {writeToolsToEnable.length} that may create, change, or
              delete data. Their approval policies still apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current tools</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={() => {
                setConfirmEnableAll(false);
                void applyBulkUpdate(
                  disabledAvailableTools.map((tool) => tool.id),
                  { enabled: true },
                );
              }}
            >
              Enable all available
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface ToolRowProps {
  connectionId: string;
  tool: McpTool;
  busyId: string | null;
  testing: boolean;
  argumentDraft: string;
  callResult: McpToolCallResult | undefined;
  pendingApproval: {
    callId: string;
    toolId: string;
    arguments: Record<string, unknown>;
  } | null;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  showSeparator: boolean;
  onArgumentDraftChange: (toolId: string, value: string) => void;
  toolActions: ToolActionHandlers;
}

function ToolRow({
  connectionId,
  tool,
  busyId,
  testing,
  argumentDraft,
  callResult,
  pendingApproval,
  selected,
  onSelectedChange,
  showSeparator,
  onArgumentDraftChange,
  toolActions,
}: ToolRowProps) {
  const busy = busyId === tool.id || busyId === connectionId;
  return (
    <div>
      {showSeparator ? <Separator /> : null}
      <div
        className={`flex gap-3 p-4 transition-colors sm:p-5 ${selected ? "bg-[#f1f1ef]" : ""}`}
      >
        <button
          aria-label={`${selected ? "Deselect" : "Select"} ${tool.name}`}
          aria-pressed={selected}
          className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
            selected
              ? "border-[#202123] bg-[#202123] text-white"
              : "border-black/15 bg-white text-transparent hover:border-black/30"
          }`}
          onClick={() => onSelectedChange(!selected)}
          type="button"
        >
          <Check className="size-3" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#202123]">
            {formatConnectionToolName(tool.name)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#96938c]">
            {tool.name}
          </p>
          <p className="mt-1 text-sm leading-6 text-[#6b6b6b]">
            {tool.description ?? "No description provided."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5",
                tool.enabled
                  ? "border-[#cfe1d3] bg-[#f2f8f3] text-[#55725b]"
                  : "border-black/[0.08] bg-[#f3f3f1] text-[#77746d]",
              )}
            >
              {tool.enabled ? "Enabled" : "Disabled"}
            </span>
            <span className="rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-[#77746d]">
              {isWriteCapableConnectionTool(tool)
                ? "Write-capable"
                : "Read-only"}
            </span>
            {!tool.available ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                Unavailable
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              className="rounded-lg"
              disabled={busy || !tool.available}
              onClick={() =>
                toolActions.updatePolicy(connectionId, tool, {
                  enabled: !tool.enabled,
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              {tool.enabled ? "Disable" : "Enable"}
            </Button>
            <Select
              disabled={busy}
              onValueChange={(value) =>
                toolActions.updatePolicy(connectionId, tool, {
                  approvalMode: value as "always" | "risky" | "never",
                })
              }
              value={tool.approvalMode}
            >
              <SelectTrigger
                aria-label={`Approval policy for ${tool.name}`}
                className="rounded-lg bg-background"
                size="sm"
              >
                <SelectValue>
                  {tool.approvalMode === "always"
                    ? "Always ask"
                    : tool.approvalMode === "risky"
                      ? "Ask for risky calls"
                      : "Never ask"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="always">Always ask</SelectItem>
                <SelectItem value="risky">Ask for risky calls</SelectItem>
                <SelectItem value="never">Never ask</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="rounded-lg"
              disabled={busy || !tool.available}
              onClick={() => toolActions.toggleToolConsole(tool)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Play />
              {testing ? "Close test" : "Test tool"}
            </Button>
          </div>

          {testing ? (
            <div className="mt-4 rounded-lg border border-black/[0.08] bg-white p-4 shadow-xs">
              <div className="grid gap-2">
                <Label className="text-xs" htmlFor={`arguments-${tool.id}`}>
                  JSON arguments
                </Label>
                <Textarea
                  className="min-h-32 resize-y rounded-xl border-black/10 bg-[#f7f7f5] p-3 font-mono text-xs leading-5"
                  id={`arguments-${tool.id}`}
                  onChange={(event) =>
                    onArgumentDraftChange(tool.id, event.target.value)
                  }
                  spellCheck={false}
                  value={argumentDraft}
                />
              </div>
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground/75">
                  View input schema
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-950 p-3 font-mono text-zinc-100">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              </details>
              <Button
                className="mt-4 rounded-xl"
                disabled={busy || !tool.enabled || !tool.available}
                onClick={() => toolActions.runTool(tool)}
                type="button"
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Play />}
                Run tool
              </Button>
              {!tool.enabled ? (
                <p className="mt-2 text-xs text-amber-700">
                  Enable this tool before testing it.
                </p>
              ) : null}

              {pendingApproval?.toolId === tool.id ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                  <div className="flex gap-2.5">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold">Approval required</p>
                      <p className="mt-1 text-xs leading-5">
                        Review the arguments above. The backend executes this
                        exact request only after you approve it.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="rounded-xl bg-amber-950 text-white hover:bg-amber-900"
                      disabled={busy}
                      onClick={toolActions.approveToolCall}
                      size="sm"
                      type="button"
                    >
                      Approve and run
                    </Button>
                    <Button
                      className="rounded-xl border-amber-300"
                      onClick={toolActions.dismissApproval}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Not now
                    </Button>
                  </div>
                </div>
              ) : null}

              {callResult ? (
                <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold">
                      {callResult.status.replace("_", " ")}
                    </span>
                    {callResult.durationMs !== null ? (
                      <span className="font-mono text-muted-foreground">
                        {callResult.durationMs} ms
                      </span>
                    ) : null}
                  </div>
                  {callResult.errorMessage ? (
                    <p className="mt-2 text-xs text-destructive">
                      {callResult.errorMessage}
                    </p>
                  ) : null}
                  {callResult.result !== null ? (
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-950 p-3 font-mono text-xs text-zinc-100">
                      {JSON.stringify(callResult.result, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
