"use client";

import type {
  ConversationSummary,
  InteractiveAgentApprovalPolicy,
} from "@agents/contracts";
import {
  ArchiveRestore,
  Check,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DeleteConversationDialog } from "@/components/delete-conversation-dialog";
import { isDevAuthEnabled, useAuthSession } from "@/lib/auth-session";
import { agentsRpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

const options: Array<{
  value: InteractiveAgentApprovalPolicy;
  title: string;
  description: string;
}> = [
  {
    value: "always_ask",
    title: "Ask every time",
    description: "Require approval before every interactive Agent tool call.",
  },
  {
    value: "tool_policy",
    title: "Follow each tool's policy",
    description: "Use the Always, Risky, or Never setting configured per tool.",
  },
  {
    value: "auto_approve_eligible",
    title: "Auto-approve eligible Agent tools",
    description:
      "Skip prompts when policy allows. Sensitive, destructive, unknown-risk, and Always tools still ask.",
  },
];

export function SettingsClient({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { isInitialized, session } = useAuthSession();
  const [policy, setPolicy] =
    useState<InteractiveAgentApprovalPolicy>("always_ask");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<InteractiveAgentApprovalPolicy | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [archived, setArchived] = useState<readonly ConversationSummary[]>([]);
  const [conversationToDelete, setConversationToDelete] =
    useState<ConversationSummary | null>(null);

  useEffect(() => {
    if (!isInitialized) return;
    if (!session && !isDevAuthEnabled()) {
      router.replace("/login");
      return;
    }
    Promise.all([
      agentsRpc.getInteractiveAgentPreferences(),
      agentsRpc.listArchivedConversations(),
    ])
      .then(([preferences, archivedConversations]) => {
        setPolicy(preferences.approvalPolicy);
        setArchived(archivedConversations);
      })
      .catch((requestError) =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Agent settings could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, [isInitialized, router, session]);

  const update = async (nextPolicy: InteractiveAgentApprovalPolicy) => {
    setSaving(nextPolicy);
    setError(null);
    try {
      const preferences =
        await agentsRpc.updateInteractiveAgentPreferences(nextPolicy);
      setPolicy(preferences.approvalPolicy);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Agent settings could not be saved.",
      );
    } finally {
      setSaving(null);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      className={cn(
        "w-full",
        embedded ? "p-0" : "mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[#f1f1ef] text-[#55534e]">
          <ShieldCheck className="size-4.5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-[#2c2b29]">
            Agent tool approvals
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[#77756f]">
            Choose how interactive Agent mode handles MCP tool calls. This does
            not change Automation permissions.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-8 space-y-2">
        {options.map((option) => {
          const selected = policy === option.value;
          return (
            <button
              className={`flex w-full items-start gap-3 rounded-[16px] border p-4 text-left transition-colors ${
                selected
                  ? "border-[#2c2b29]/25 bg-[#fafaf8]"
                  : "border-black/[0.08] bg-white hover:bg-[#fafaf9]"
              }`}
              disabled={loading || saving !== null}
              key={option.value}
              onClick={() => void update(option.value)}
              type="button"
            >
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  selected
                    ? "border-[#2c2b29] bg-[#2c2b29] text-white"
                    : "border-black/[0.18] text-transparent"
                }`}
              >
                {saving === option.value ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
              </span>
              <span>
                <span className="block text-sm font-medium text-[#34332f]">
                  {option.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#77756f]">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-6 rounded-xl bg-[#f5f5f3] px-4 py-3 text-xs leading-5 text-[#716f69]">
        Hard safety checks always remain active: owner scope, connection state,
        schema validation, idempotency, rate limits, audit logging, and explicit
        confirmation for unsafe actions.
      </p>

      <section className="mt-10 border-t border-black/[0.07] pt-8">
        <div className="flex items-start gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#f1f1ef] text-[#55534e]">
            <ArchiveRestore className="size-4.5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-[#2c2b29]">
              Archived conversations
            </h2>
            <p className="mt-1 text-sm text-[#77756f]">
              Restore archived history or permanently delete eligible
              conversations.
            </p>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          {archived.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/[0.1] px-4 py-8 text-center text-sm text-[#8a8882]">
              No archived conversations
            </p>
          ) : (
            archived.map((conversation) => (
              <div
                className="flex items-center gap-3 rounded-xl border border-black/[0.07] px-3 py-3"
                key={conversation.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#34332f]">
                    {conversation.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#8a8882]">
                    Archived{" "}
                    {conversation.archivedAt
                      ? new Date(conversation.archivedAt).toLocaleString()
                      : "recently"}
                  </p>
                </div>
                <button
                  className="rounded-lg px-2.5 py-1.5 text-xs text-[#55534e] hover:bg-black/[0.04]"
                  onClick={async () => {
                    await agentsRpc.setConversationArchived(
                      conversation.id,
                      false,
                    );
                    setArchived((current) =>
                      current.filter((item) => item.id !== conversation.id),
                    );
                  }}
                  type="button"
                >
                  Restore
                </button>
                <button
                  aria-label={`Delete ${conversation.title}`}
                  className="flex size-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                  onClick={() => setConversationToDelete(conversation)}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
      <DeleteConversationDialog
        conversation={conversationToDelete}
        onDelete={async (conversation, confirmationTitle) => {
          await agentsRpc.deleteConversation(
            conversation.id,
            confirmationTitle,
          );
          setArchived((current) =>
            current.filter((item) => item.id !== conversation.id),
          );
          setConversationToDelete(null);
        }}
        onOpenChange={(open) => {
          if (!open) setConversationToDelete(null);
        }}
      />
    </Root>
  );
}
