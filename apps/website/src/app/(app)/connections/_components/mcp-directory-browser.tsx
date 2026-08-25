"use client";

import type { McpDirectoryEntry } from "@agents/contracts";
import {
  ArrowRight,
  ExternalLink,
  LoaderCircle,
  Search,
  Server,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentsRpc } from "@/lib/rpc";
import { errorMessage } from "./connection-utils";

interface McpDirectoryBrowserProps {
  onSelect: (entry: McpDirectoryEntry) => void;
  screen?: boolean;
}

export function McpDirectoryBrowser({
  onSelect,
  screen = false,
}: McpDirectoryBrowserProps) {
  const [query, setQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [entries, setEntries] = useState<readonly McpDirectoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search: string, cursor?: string) => {
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const page = await agentsRpc.listMcpDirectory({ search, cursor });
      setEntries((current) =>
        cursor ? [...current, ...page.entries] : page.entries,
      );
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const search = query.trim();
    setActiveSearch(search);
    void load(search);
  };

  return (
    <div className="grid gap-4">
      <form className="flex gap-2" onSubmit={submitSearch}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9a9892]" />
          <Input
            aria-label="Search MCP directory"
            className="h-10 rounded-xl border-black/[0.08] bg-white pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search servers by name"
            value={query}
          />
        </div>
        <Button
          className="h-10 rounded-xl px-4"
          type="submit"
          variant="outline"
        >
          Search
        </Button>
      </form>

      <div className="flex items-center justify-between gap-3 text-xs text-[#85827b]">
        <p>
          {activeSearch ? `Results for “${activeSearch}”` : "Remote servers"}
        </p>
        <Badge
          className="rounded-md border-black/[0.07] bg-white text-[#77746d]"
          variant="outline"
        >
          Official registry
        </Badge>
      </div>

      {error ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-56 items-center justify-center text-sm text-[#77746d]">
          <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading
          directory
        </div>
      ) : entries.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-black/[0.1] text-center">
          <Server className="size-5 text-[#929089]" />
          <p className="mt-3 text-sm font-medium text-[#34332f]">
            No remote servers found
          </p>
          <p className="mt-1 text-xs text-[#85827b]">
            Try a broader name or connect an endpoint manually.
          </p>
        </div>
      ) : (
        <div
          className={
            screen
              ? "grid gap-4 md:grid-cols-2"
              : "grid max-h-[52svh] gap-2 overflow-y-auto pr-1"
          }
        >
          {entries.map((entry) => (
            <article
              className="rounded-xl border border-black/[0.07] bg-white p-4"
              key={`${entry.name}:${entry.version ?? "latest"}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/[0.06] bg-[#f1f1ee] text-[#6f706c]">
                  {entry.icons[0] ? (
                    // biome-ignore lint/performance/noImgElement: Registry icons use dynamic trusted HTTPS hosts and must preserve no-referrer loading.
                    <img
                      alt=""
                      className="size-full object-contain"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      src={entry.icons[0].src}
                    />
                  ) : (
                    <Server className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-[#292825]">
                      {entry.title}
                    </h3>
                    {entry.version ? (
                      <span className="text-[10px] text-[#9a9892]">
                        v{entry.version}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[#a09e97]">
                    {entry.name}
                  </p>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#706e68]">
                    {entry.description ??
                      "No description supplied by the publisher."}
                  </p>
                </div>
                <Button
                  className="h-8 shrink-0 rounded-lg px-3 text-xs"
                  onClick={() => onSelect(entry)}
                  type="button"
                >
                  Connect <ArrowRight className="size-3.5" />
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/[0.05] pt-3">
                <p className="min-w-0 truncate font-mono text-[10px] text-[#8e8b85]">
                  {entry.endpointUrl}
                </p>
                {entry.websiteUrl ? (
                  <a
                    className="flex shrink-0 items-center gap-1 text-[11px] text-[#66645f] hover:text-[#252421]"
                    href={entry.websiteUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Website <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            </article>
          ))}
          {nextCursor ? (
            <Button
              className="mt-1 h-9 rounded-xl"
              disabled={loadingMore}
              onClick={() => void load(activeSearch, nextCursor)}
              type="button"
              variant="outline"
            >
              {loadingMore ? <LoaderCircle className="animate-spin" /> : null}
              Load more
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
