"use client";

import { Bot, Cable, Menu, MessageSquarePlus, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebarContent } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getAppPageMeta } from "@/lib/app-navigation";
import { useAuthSession } from "@/lib/auth-session";
import { requestConnectServerModal } from "@/lib/connect-server-modal";
import {
  CONVERSATION_TITLE_EVENT,
  type ConversationTitleEventDetail,
} from "@/lib/conversation-events";
import { agentsRpc } from "@/lib/rpc";

export function AppHeader() {
  const pathname = usePathname();
  const { isInitialized, session } = useAuthSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [conversationTitle, setConversationTitle] = useState<string | null>(
    null,
  );
  const page = getAppPageMeta(pathname);
  const opensConnectServerModal =
    page.action?.href === "/connections#connect-server";
  const conversationRouteId =
    pathname.match(/^\/conversations\/([^/]+)$/)?.[1] ?? null;
  const conversationId =
    conversationRouteId && conversationRouteId !== "new"
      ? conversationRouteId
      : null;
  const Icon =
    page.section === "Configure"
      ? Cable
      : page.section === "Automations"
        ? Bot
        : MessageSquarePlus;

  useEffect(() => {
    if (!conversationId || !isInitialized || !session) {
      setConversationTitle(null);
      return;
    }
    let cancelled = false;
    void agentsRpc
      .getConversation(conversationId)
      .then((detail) => {
        if (!cancelled) setConversationTitle(detail.conversation.title);
      })
      .catch(() => undefined);
    const updateTitle = (event: Event) => {
      const detail = (event as CustomEvent<ConversationTitleEventDetail>)
        .detail;
      if (detail.conversationId === conversationId) {
        setConversationTitle(detail.title);
      }
    };
    window.addEventListener(CONVERSATION_TITLE_EVENT, updateTitle);
    return () => {
      cancelled = true;
      window.removeEventListener(CONVERSATION_TITLE_EVENT, updateTitle);
    };
  }, [conversationId, isInitialized, session]);

  return (
    <header className="flex min-h-11 shrink-0 items-center border-b border-black/[0.06] bg-white px-2.5 sm:px-3">
      <Sheet onOpenChange={setMobileOpen} open={mobileOpen}>
        <SheetTrigger className="mr-1.5 flex size-8 items-center justify-center rounded-lg text-[#65676e] transition hover:bg-[#f2f2f3] md:hidden">
          <Menu className="size-4" />
          <span className="sr-only">Open navigation</span>
        </SheetTrigger>
        <SheetContent
          className="w-[15.5rem] border-r-black/[0.06] bg-[#f5f5f6] p-0 shadow-2xl"
          side="left"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Agents navigation</SheetTitle>
            <SheetDescription>Navigate the Agents workspace.</SheetDescription>
          </SheetHeader>
          <AppSidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-[#666870]" strokeWidth={1.8} />
        <h1 className="truncate text-[13px] font-semibold text-[#25262a]">
          {conversationTitle ?? page.title}
        </h1>
        {!conversationId ? (
          <p className="hidden truncate text-[11px] text-[#8a8c93] sm:block">
            {page.description}
          </p>
        ) : null}
      </div>

      {page.action && opensConnectServerModal ? (
        <Button
          className="ml-auto h-7 rounded-lg border-black/[0.08] bg-white px-2.5 text-xs text-[#303136] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f6f6f7]"
          onClick={() => requestConnectServerModal(window)}
          type="button"
          variant="outline"
        >
          <Plus className="size-3" />
          {page.action.label}
        </Button>
      ) : page.action ? (
        <Button
          className="ml-auto h-7 rounded-lg border-black/[0.08] bg-white px-2.5 text-xs text-[#303136] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-[#f6f6f7]"
          render={<Link href={page.action.href} />}
          nativeButton={false}
          variant="outline"
        >
          <Plus className="size-3" />
          {page.action.label}
        </Button>
      ) : null}
    </header>
  );
}
