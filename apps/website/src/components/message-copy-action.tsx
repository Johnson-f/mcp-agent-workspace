"use client";

import { Check, CircleX, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyMessageText } from "@/lib/message-copy";

type CopyState = "idle" | "copied" | "failed";

export function MessageCopyAction({
  content,
  align,
}: {
  content: string;
  align: "left" | "right";
}) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    const result = await copyMessageText(content, (text) =>
      navigator.clipboard.writeText(text),
    );
    setState(result);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2_000);
  };

  const label =
    state === "copied"
      ? "Copied"
      : state === "failed"
        ? "Copy failed"
        : "Copy message";

  return (
    <div
      className={`mt-1 flex ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <button
        aria-label={label}
        className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] text-[#8a8882] opacity-70 transition-[color,opacity,background-color] hover:bg-black/[0.035] hover:text-[#44423e] hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b63f6]/30 sm:opacity-0 sm:group-hover/message:opacity-70 sm:group-focus-within/message:opacity-70"
        onClick={() => void copy()}
        title={label}
        type="button"
      >
        {state === "copied" ? (
          <Check className="size-3.5 text-[#66836b]" />
        ) : state === "failed" ? (
          <CircleX className="size-3.5 text-[#a35d52]" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {state === "idle" ? (
          <span className="sr-only">Copy</span>
        ) : (
          <span>{label}</span>
        )}
      </button>
    </div>
  );
}
