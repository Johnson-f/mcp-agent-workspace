"use client";

import {
  type ConversationSummary,
  conversationHistorySections,
} from "@agents/contracts";
import {
  Archive,
  Bot,
  Cable,
  CircleHelp,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  SlidersHorizontal,
  Trash2,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DeleteConversationDialog } from "@/components/delete-conversation-dialog";
import { useConversationHistory } from "@/hooks/use-conversation-history";
import { requestSettingsModal } from "@/lib/settings-modal";
import { cn } from "@/lib/utils";

const primaryItems = [
  {
    title: "New",
    href: "/conversations/new",
    icon: Plus,
    active: (pathname: string) => pathname === "/conversations/new",
  },
  {
    title: "Automations",
    href: "/automations",
    icon: Bot,
    active: (pathname: string) => pathname.startsWith("/automations"),
  },
  {
    title: "Connections",
    href: "/connections",
    icon: Cable,
    active: (pathname: string) => pathname.startsWith("/connections"),
  },
];

export function AppSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { conversations, loading, error, rename, setPinned, archive, remove } =
    useConversationHistory(pathname);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [conversationToDelete, setConversationToDelete] =
    useState<ConversationSummary | null>(null);
  const sections = useMemo(
    () => conversationHistorySections([...conversations]),
    [conversations],
  );

  const conversationSection = (
    label: string,
    items: typeof sections.pinned,
    emptyMessage?: string,
  ) => {
    if (items.length === 0 && !loading && !emptyMessage) {
      return null;
    }

    return (
      <div>
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-[12px] font-medium text-[#898983]">{label}</p>
          {label === "Chats and tasks" ? (
            <SlidersHorizontal className="size-3.5 text-[#94948e]" />
          ) : null}
        </div>
        <div className="space-y-1">
          {loading && items.length === 0 ? (
            [0, 1, 2].map((item) => (
              <div
                className="mx-1 h-8 animate-pulse rounded-lg bg-black/[0.04]"
                key={item}
              />
            ))
          ) : items.length === 0 && emptyMessage ? (
            <div className="flex items-start gap-2 px-2 py-1.5 text-[12px] leading-5 text-[#999791]">
              <Pin className="mt-0.5 size-3.5 shrink-0" />
              <span>{emptyMessage}</span>
            </div>
          ) : (
            items.map((conversation) => {
              const active = pathname === `/conversations/${conversation.id}`;
              const editing = editingId === conversation.id;
              return (
                <div className="group relative" key={conversation.id}>
                  {editing ? (
                    <input
                      className="h-9 w-full rounded-xl border border-[#5b63f6]/30 bg-white px-3 text-[14px] outline-none ring-2 ring-[#5b63f6]/10"
                      defaultValue={conversation.title}
                      maxLength={80}
                      onBlur={(event) => {
                        const title = event.currentTarget.value.trim();
                        setEditingId(null);
                        if (title && title !== conversation.title) {
                          void rename(conversation.id, title);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 min-w-0 items-center gap-3 rounded-xl pl-2 pr-8 text-[14px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30",
                        active
                          ? "bg-[#e8e8e6] font-medium text-[#202125]"
                          : "text-[#5e5e59] hover:bg-black/[0.035] hover:text-[#242420]",
                      )}
                      href={`/conversations/${conversation.id}`}
                      onClick={onNavigate}
                    >
                      <Bot
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-[#5b63f6]" : "text-[#aaa9a3]",
                        )}
                        strokeWidth={1.7}
                      />
                      <span className="truncate">{conversation.title}</span>
                    </Link>
                  )}
                  {!editing ? (
                    <button
                      aria-label={`Conversation options for ${conversation.title}`}
                      className="absolute right-1 top-1.5 flex size-6 items-center justify-center rounded-md text-[#85878e] opacity-0 transition hover:bg-black/[0.06] group-hover:opacity-100 focus:opacity-100"
                      onClick={() =>
                        setMenuId((current) =>
                          current === conversation.id ? null : conversation.id,
                        )
                      }
                      type="button"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  ) : null}
                  {menuId === conversation.id ? (
                    <div className="absolute right-1 top-8 z-40 w-32 rounded-lg border border-black/[0.08] bg-white p-1 text-xs shadow-lg">
                      <button
                        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[#f2f2f3]"
                        onClick={() => {
                          setMenuId(null);
                          setEditingId(conversation.id);
                        }}
                        type="button"
                      >
                        <Pencil className="size-3" />
                        Rename
                      </button>
                      <button
                        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[#f2f2f3]"
                        onClick={() => {
                          setMenuId(null);
                          void setPinned(
                            conversation.id,
                            conversation.pinnedAt === null,
                          );
                        }}
                        type="button"
                      >
                        {conversation.pinnedAt ? (
                          <PinOff className="size-3" />
                        ) : (
                          <Pin className="size-3" />
                        )}
                        {conversation.pinnedAt ? "Unpin" : "Pin"}
                      </button>
                      <button
                        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[#f2f2f3]"
                        onClick={() => {
                          setMenuId(null);
                          void archive(conversation.id).then((archived) => {
                            if (archived && active)
                              router.push("/conversations/new");
                          });
                        }}
                        type="button"
                      >
                        <Archive className="size-3" />
                        Archive
                      </button>
                      <div className="my-1 h-px bg-black/[0.06]" />
                      <button
                        className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-red-600 hover:bg-red-50"
                        onClick={() => {
                          setMenuId(null);
                          setConversationToDelete(conversation);
                        }}
                        type="button"
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-2.5 py-3 text-[#26272b]">
      <Link
        className="mb-5 flex h-10 items-center gap-2.5 rounded-xl px-2.5 text-sm font-semibold outline-none transition-colors hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30"
        href="/conversations/new"
        onClick={onNavigate}
      >
        <span className="flex size-7 items-center justify-center rounded-lg border border-black/[0.07] bg-white text-[#44464d]">
          <Waypoints className="size-3.5" strokeWidth={2} />
        </span>
        <span>Agents</span>
      </Link>

      <nav aria-label="Agents workspace" className="space-y-1">
        {primaryItems.map((item) => {
          const active = item.active(pathname);
          const Icon = item.icon;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30",
                active
                  ? "bg-[#e8e8e6] font-medium text-[#202125]"
                  : "text-[#5f5f5a] hover:bg-black/[0.035] hover:text-[#242420]",
              )}
              href={item.href}
              key={item.title}
              onClick={onNavigate}
            >
              <Icon className="size-5" strokeWidth={1.7} />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-7 min-h-0 flex-1 space-y-7 overflow-y-auto pb-4">
        {conversationSection(
          "Pinned",
          sections.pinned,
          "Pin chats to keep them here",
        )}
        {conversationSection("Chats and tasks", sections.recent)}
        {error ? (
          <p className="px-2 text-[11px] text-red-600">{error}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <button
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-[#5f5f5a] outline-none transition-colors hover:bg-black/[0.035] hover:text-[#242420] focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30"
          onClick={() => {
            requestSettingsModal(window);
            onNavigate?.();
          }}
          type="button"
        >
          <Settings className="size-5" strokeWidth={1.7} />
          <span>Settings</span>
        </button>
        <Link
          className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-[#74767e] transition-colors hover:bg-black/[0.035] hover:text-[#26272b]"
          href="/connections"
          onClick={onNavigate}
        >
          <LockKeyhole className="size-3.5" />
          Credentials encrypted
        </Link>
        <div className="flex items-center justify-between border-t border-black/[0.05] px-2 pt-3 text-[11px] text-[#8a8c93]">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[#5b63f6]" />
            Local workspace
          </span>
          <CircleHelp className="size-3.5" />
        </div>
      </div>
      <DeleteConversationDialog
        conversation={conversationToDelete}
        onDelete={async (conversation, confirmationTitle) => {
          await remove(conversation.id, confirmationTitle);
          setConversationToDelete(null);
          if (pathname === `/conversations/${conversation.id}`) {
            router.push("/conversations/new");
          }
        }}
        onOpenChange={(open) => {
          if (!open) setConversationToDelete(null);
        }}
      />
    </div>
  );
}

export function AppSidebar() {
  return (
    <aside
      aria-label="Primary"
      className="hidden h-full w-[15rem] shrink-0 md:block lg:w-[15.5rem]"
    >
      <AppSidebarContent />
    </aside>
  );
}
