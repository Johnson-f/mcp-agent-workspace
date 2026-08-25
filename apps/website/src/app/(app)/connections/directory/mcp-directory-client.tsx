"use client";

import type { McpDirectoryEntry } from "@agents/contracts";
import { ArrowLeft, BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { McpDirectoryBrowser } from "../_components/mcp-directory-browser";

export function McpDirectoryClient() {
  const router = useRouter();

  const connect = (entry: McpDirectoryEntry) => {
    const query = new URLSearchParams({
      directoryName: entry.title,
      directoryEndpoint: entry.endpointUrl,
      directoryTransport: entry.transport,
      directoryAuth: entry.authType,
    });
    if (entry.authHeaderNames.length > 0) {
      query.set("directoryHeaders", entry.authHeaderNames.join(","));
    }
    router.push(`/connections?${query.toString()}#connect-server`);
  };

  return (
    <main className="min-h-full bg-[#fbfbfa]">
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
        <Link
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#77746d] hover:text-[#292825]"
          href="/connections"
        >
          <ArrowLeft className="size-3.5" />
          Connections
        </Link>
        <header className="mt-6 flex flex-col gap-5 border-b border-black/[0.07] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#96938c]">
              <BookOpen className="size-3.5" /> Official MCP Registry
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#262522]">
              Find a server for your agent
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#77746d]">
              Browse remotely hosted MCP servers, inspect their published
              identity, and connect one to this workspace.
            </p>
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/connections#connect-server" />}
            variant="outline"
          >
            <Plus className="size-3.5" /> Connect manually
          </Button>
        </header>
        <section className="mt-7">
          <McpDirectoryBrowser onSelect={connect} screen />
        </section>
      </div>
    </main>
  );
}
