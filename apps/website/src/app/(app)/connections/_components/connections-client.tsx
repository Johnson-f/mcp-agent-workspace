"use client";

import type {
  McpConnection,
  McpDirectoryEntry,
  McpTool,
  McpToolCallResult,
} from "@agents/contracts";
import { Dialog } from "@base-ui/react/dialog";
import { CircleAlert, Library, Plus, Server, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { CONNECT_SERVER_MODAL_OPEN_EVENT } from "@/lib/connect-server-modal";
import { agentsRpc, RpcRequestError } from "@/lib/rpc";
import { ConnectServerForm } from "./connect-server-form";
import { ConnectionCard } from "./connection-card";
import {
  connectionUrlWithoutModalHash,
  connectServerModalIsOpen,
  directoryConnectionPrefill,
} from "./connection-modal";
import {
  type ConnectionAuthType,
  errorMessage,
  initialArguments,
  parseArguments,
  parseCustomHeaders,
} from "./connection-utils";
import { DeleteConnectionDialog } from "./delete-connection-dialog";
import { McpDirectoryBrowser } from "./mcp-directory-browser";

const defaultCustomHeaders = JSON.stringify({ "x-api-key": "" }, null, 2);

export function ConnectionsClient() {
  const router = useRouter();
  const { session, isInitialized } = useAuthSession();
  const [connections, setConnections] = useState<readonly McpConnection[]>([]);
  const [tools, setTools] = useState<Record<string, readonly McpTool[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectView, setConnectView] = useState<"directory" | "manual">(
    "manual",
  );
  const [transport, setTransport] = useState<"streamable_http" | "sse">(
    "streamable_http",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authType, setAuthType] = useState<ConnectionAuthType>("none");
  const [bearerToken, setBearerToken] = useState("");
  const [customHeaders, setCustomHeaders] = useState(defaultCustomHeaders);
  const [testingToolId, setTestingToolId] = useState<string | null>(null);
  const [argumentDrafts, setArgumentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [callResults, setCallResults] = useState<
    Record<string, McpToolCallResult>
  >({});
  const [pendingApproval, setPendingApproval] = useState<{
    callId: string;
    toolId: string;
    arguments: Record<string, unknown>;
  } | null>(null);
  const [connectionToDelete, setConnectionToDelete] =
    useState<McpConnection | null>(null);

  const loadConnections = useCallback(
    async (options: { preserveError?: boolean } = {}) => {
      try {
        const nextConnections = await agentsRpc.listConnections();
        setConnections(nextConnections);
        if (!options.preserveError) {
          setError(null);
        }
      } catch (requestError) {
        if (
          requestError instanceof RpcRequestError &&
          requestError.tag === "Unauthorized"
        ) {
          if (isDevAuthEnabled()) {
            setError(errorMessage(requestError));
            return;
          }
          router.replace("/login");
          return;
        }
        setError(errorMessage(requestError));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

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
    void loadConnections();
  }, [isInitialized, loadConnections, router, session]);

  useEffect(() => {
    const syncWithHash = () => {
      const open = connectServerModalIsOpen(window.location.hash);
      setConnectOpen(open);
      const prefill = directoryConnectionPrefill(
        window.location.search,
        window.location.hash,
      );
      if (prefill) {
        setName(prefill.name);
        setEndpointUrl(prefill.endpointUrl);
        setTransport(prefill.transport);
        setAuthType(prefill.authType);
        if (prefill.authHeaderNames.length > 0) {
          setCustomHeaders(
            JSON.stringify(
              Object.fromEntries(
                prefill.authHeaderNames.map((header) => [header, ""]),
              ),
              null,
              2,
            ),
          );
        }
        setConnectView("manual");
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}#connect-server`,
        );
      }
    };
    const openFromAppAction = () => {
      setConnectView("manual");
      setConnectOpen(true);
      if (!connectServerModalIsOpen(window.location.hash)) {
        window.history.replaceState(
          window.history.state,
          "",
          `${connectionUrlWithoutModalHash(
            window.location.pathname,
            window.location.search,
          )}#connect-server`,
        );
      }
    };
    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    window.addEventListener(CONNECT_SERVER_MODAL_OPEN_EVENT, openFromAppAction);
    return () => {
      window.removeEventListener("hashchange", syncWithHash);
      window.removeEventListener(
        CONNECT_SERVER_MODAL_OPEN_EVENT,
        openFromAppAction,
      );
    };
  }, []);

  const updateConnectOpen = (open: boolean) => {
    setConnectOpen(open);
    if (!open && connectServerModalIsOpen(window.location.hash)) {
      window.history.replaceState(
        window.history.state,
        "",
        connectionUrlWithoutModalHash(
          window.location.pathname,
          window.location.search,
        ),
      );
    }
  };

  const submitConnection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const result = await agentsRpc.createConnection({
        name,
        endpointUrl,
        transport,
        authType,
        bearerToken: authType === "bearer" ? bearerToken : undefined,
        customHeaders:
          authType === "custom_headers"
            ? parseCustomHeaders(customHeaders)
            : undefined,
      });
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setName("");
      setEndpointUrl("");
      setBearerToken("");
      setCustomHeaders(defaultCustomHeaders);
      setAuthType("none");
      setTransport("streamable_http");
      await loadConnections();
      updateConnectOpen(false);
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      await loadConnections({ preserveError: true });
    } finally {
      setSaving(false);
    }
  };

  const selectDirectoryEntry = (entry: McpDirectoryEntry) => {
    setName(entry.title);
    setEndpointUrl(entry.endpointUrl);
    setTransport(entry.transport);
    setAuthType(entry.authType);
    setCustomHeaders(
      entry.authHeaderNames.length > 0
        ? JSON.stringify(
            Object.fromEntries(
              entry.authHeaderNames.map((header) => [header, ""]),
            ),
            null,
            2,
          )
        : defaultCustomHeaders,
    );
    setBearerToken("");
    setConnectView("manual");
  };

  const refreshConnection = async (connectionId: string) => {
    setBusyId(connectionId);
    setError(null);
    try {
      const result = await agentsRpc.refreshConnection(connectionId);
      if (result.authorizationUrl) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      const nextTools = await agentsRpc.listTools(connectionId);
      setTools((current) => ({ ...current, [connectionId]: nextTools }));
      await loadConnections();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const showTools = async (connectionId: string) => {
    if (tools[connectionId]) {
      setTools((current) => {
        const next = { ...current };
        delete next[connectionId];
        return next;
      });
      return;
    }

    setBusyId(connectionId);
    try {
      const nextTools = await agentsRpc.listTools(connectionId);
      setTools((current) => ({ ...current, [connectionId]: nextTools }));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const removeConnection = async (connectionId: string) => {
    setConnectionToDelete(null);
    setBusyId(connectionId);
    try {
      await agentsRpc.deleteConnection(connectionId);
      await loadConnections();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const updatePolicy = async (
    connectionId: string,
    tool: McpTool,
    update: Partial<Pick<McpTool, "enabled" | "approvalMode">>,
  ) => {
    setBusyId(tool.id);
    setError(null);
    try {
      const nextTool = await agentsRpc.updateToolPolicy({
        toolId: tool.id,
        enabled: update.enabled ?? tool.enabled,
        approvalMode: update.approvalMode ?? tool.approvalMode,
      });
      setTools((current) => ({
        ...current,
        [connectionId]: (current[connectionId] ?? []).map((candidate) =>
          candidate.id === nextTool.id ? nextTool : candidate,
        ),
      }));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const updatePolicies = async (
    connectionId: string,
    toolIds: string[],
    update: Partial<Pick<McpTool, "enabled" | "approvalMode">>,
  ) => {
    setBusyId(connectionId);
    setError(null);
    try {
      const updated = await agentsRpc.updateToolPolicies({
        connectionId,
        toolIds,
        ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
        ...(update.approvalMode === undefined
          ? {}
          : { approvalMode: update.approvalMode }),
      });
      const updatedById = new Map(updated.map((tool) => [tool.id, tool]));
      setTools((current) => ({
        ...current,
        [connectionId]: (current[connectionId] ?? []).map(
          (tool) => updatedById.get(tool.id) ?? tool,
        ),
      }));
    } catch (requestError) {
      setError(errorMessage(requestError));
      throw requestError;
    } finally {
      setBusyId(null);
    }
  };

  const toggleToolConsole = (tool: McpTool) => {
    setTestingToolId((current) => (current === tool.id ? null : tool.id));
    setArgumentDrafts((current) =>
      current[tool.id]
        ? current
        : { ...current, [tool.id]: initialArguments(tool.inputSchema) },
    );
  };

  const runTool = async (tool: McpTool) => {
    setBusyId(tool.id);
    setError(null);
    try {
      const argumentsValue = parseArguments(argumentDrafts[tool.id] ?? "{}");
      const result = await agentsRpc.prepareToolCall({
        toolId: tool.id,
        arguments: argumentsValue,
        idempotencyKey: crypto.randomUUID(),
      });
      setCallResults((current) => ({ ...current, [tool.id]: result }));
      if (result.status === "awaiting_approval") {
        setPendingApproval({
          callId: result.callId,
          toolId: tool.id,
          arguments: argumentsValue,
        });
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const approveToolCall = async () => {
    if (!pendingApproval) {
      return;
    }
    const approval = pendingApproval;
    setBusyId(approval.toolId);
    setError(null);
    try {
      const result = await agentsRpc.approveToolCall({
        callId: approval.callId,
        arguments: approval.arguments,
      });
      setCallResults((current) => ({
        ...current,
        [approval.toolId]: result,
      }));
      setPendingApproval(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusyId(null);
    }
  };

  const connectedCount = connections.filter(
    (connection) => connection.status === "connected",
  ).length;
  const attentionCount = connections.filter(
    (connection) =>
      connection.status === "auth_required" || connection.status === "error",
  ).length;

  if (!isInitialized || loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-52 rounded-lg" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <main className="min-h-full w-full bg-[#fbfbfa]">
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
        <section className="flex flex-col gap-4 border-b border-black/[0.07] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#96938c]">
              Connection library
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[#262522]">
              MCP connections
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#77746d]">
              Manage server health, authentication, tools, and approval policy.
            </p>
          </div>
          <p className="text-xs text-[#85827b]">
            <span className="font-semibold text-[#302f2c]">
              {connections.length}
            </span>{" "}
            {connections.length === 1 ? "connection" : "connections"}
            <span className="mx-2 text-[#c2c0ba]">·</span>
            <span className="font-semibold text-[#55725b]">
              {connectedCount}
            </span>{" "}
            connected
          </p>
          <Button
            className="h-9 rounded-xl border-black/[0.08] bg-white px-3 text-xs shadow-none"
            nativeButton={false}
            render={<Link href="/connections/directory" />}
            variant="outline"
          >
            <Library className="size-3.5" />
            Browse directory
          </Button>
        </section>

        {error && !connectOpen ? (
          <div
            className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <section
          aria-labelledby="connected-servers"
          className="mt-7 grid gap-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2
                className="text-sm font-semibold text-[#202123]"
                id="connected-servers"
              >
                Connected servers
              </h2>
              <p className="mt-0.5 text-xs text-[#8a8a8a]">
                Review discovered tools and their approval policy.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                className="h-6 gap-1.5 rounded-md border-black/[0.07] bg-white px-2 text-[11px] text-[#666870]"
                variant="outline"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {connectedCount} live
              </Badge>
              {attentionCount > 0 ? (
                <Badge
                  className="h-6 rounded-md px-2 text-[11px]"
                  variant="destructive"
                >
                  {attentionCount} need attention
                </Badge>
              ) : null}
            </div>
          </div>

          {connections.length === 0 ? (
            <Card className="min-h-[24rem] border border-black/[0.07] bg-white py-12 shadow-none">
              <CardContent className="flex flex-1 flex-col items-center justify-center text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-[#f5f5f6] text-[#73757c]">
                  <Server className="size-4" />
                </span>
                <p className="mt-4 text-sm font-semibold text-[#202123]">
                  No connections yet
                </p>
                <p className="mt-1 max-w-sm text-sm leading-5 text-[#74767e]">
                  Connect an MCP server to discover the tools your agents can
                  use.
                </p>
                <Button
                  className="mt-5 h-8 rounded-lg bg-[#202125] px-3 text-xs text-white hover:bg-black"
                  nativeButton={false}
                  render={<a href="#connect-server" />}
                >
                  <Plus className="size-3.5" />
                  Add server
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {connections.map((connection) => (
              <ConnectionCard
                argumentDrafts={argumentDrafts}
                busyId={busyId}
                callResults={callResults}
                connection={connection}
                key={connection.id}
                onArgumentDraftChange={(toolId, value) =>
                  setArgumentDrafts((current) => ({
                    ...current,
                    [toolId]: value,
                  }))
                }
                onDeleteRequest={setConnectionToDelete}
                onRefresh={(connectionId) =>
                  void refreshConnection(connectionId)
                }
                onShowTools={(connectionId) => void showTools(connectionId)}
                pendingApproval={pendingApproval}
                testingToolId={testingToolId}
                toolActions={{
                  approveToolCall: () => void approveToolCall(),
                  dismissApproval: () => setPendingApproval(null),
                  runTool: (tool) => void runTool(tool),
                  toggleToolConsole,
                  updatePolicy: (connectionId, tool, update) =>
                    void updatePolicy(connectionId, tool, update),
                  updatePolicies,
                }}
                tools={tools[connection.id]}
              />
            ))}
          </div>
        </section>

        <Dialog.Root onOpenChange={updateConnectOpen} open={connectOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
            <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-black/[0.1] bg-[#fbfbfa] text-[#202123] outline-none transition duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
              <header className="flex items-start gap-3 border-b border-black/[0.07] px-5 py-4 sm:px-6">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#efefec] text-[#5f6168]">
                  {connectView === "directory" ? (
                    <Library className="size-4" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="text-base font-semibold">
                    {connectView === "directory"
                      ? "Browse MCP servers"
                      : "Connect a server"}
                  </Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-xs leading-5 text-[#74767e]">
                    {connectView === "directory"
                      ? "Find remotely hosted servers from the official MCP Registry."
                      : "Add an MCP endpoint, then review its tools."}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label="Close connect server"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#77756f] transition-colors hover:bg-black/[0.05] hover:text-[#2c2b29] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30"
                  disabled={saving}
                >
                  <X className="size-4" />
                </Dialog.Close>
              </header>
              <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
                {error ? (
                  <div
                    className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
                    role="alert"
                  >
                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}
                {connectView === "directory" ? (
                  <McpDirectoryBrowser onSelect={selectDirectoryEntry} />
                ) : (
                  <ConnectServerForm
                    authType={authType}
                    bearerToken={bearerToken}
                    customHeaders={customHeaders}
                    embedded
                    endpointUrl={endpointUrl}
                    name={name}
                    onAuthTypeChange={setAuthType}
                    onBearerTokenChange={setBearerToken}
                    onCustomHeadersChange={setCustomHeaders}
                    onEndpointUrlChange={setEndpointUrl}
                    onNameChange={setName}
                    onSubmit={submitConnection}
                    saving={saving}
                  />
                )}
                <div className="mt-4 border-t border-black/[0.06] pt-4 text-center">
                  <button
                    className="text-xs font-medium text-[#66645f] hover:text-[#242320]"
                    onClick={() =>
                      setConnectView(
                        connectView === "directory" ? "manual" : "directory",
                      )
                    }
                    type="button"
                  >
                    {connectView === "directory"
                      ? "Connect an endpoint manually"
                      : "Browse the MCP directory"}
                  </button>
                </div>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>

        <DeleteConnectionDialog
          busyId={busyId}
          connection={connectionToDelete}
          onDelete={(connectionId) => void removeConnection(connectionId)}
          onOpenChange={(open) => {
            if (!open) {
              setConnectionToDelete(null);
            }
          }}
        />
      </div>
    </main>
  );
}
