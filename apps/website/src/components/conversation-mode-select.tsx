"use client";

import type { ConversationMode } from "@agents/contracts";
import { Bot, MessageCircle, Workflow } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeConversationMode } from "@/lib/conversation-mode";

export function ConversationModeSelect({
  disabled,
  onValueChange,
  value,
}: {
  disabled?: boolean;
  onValueChange: (mode: ConversationMode) => void;
  value: ConversationMode;
}) {
  const Icon =
    value === "agent" ? Bot : value === "automation" ? Workflow : MessageCircle;

  return (
    <Select
      disabled={disabled}
      onValueChange={(nextValue) =>
        onValueChange(normalizeConversationMode(nextValue))
      }
      value={value}
    >
      <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent px-1.5 text-xs text-[#6f6d67] shadow-none hover:bg-black/[0.035] focus-visible:ring-0">
        <Icon className="size-3.5" strokeWidth={1.8} />
        <SelectValue>
          {value === "agent"
            ? "Agent"
            : value === "automation"
              ? "Automation"
              : "Chat"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="w-56">
        <SelectItem value="chat">
          <span className="flex items-center gap-2">
            <MessageCircle className="size-3.5" />
            <span>
              <span className="block">Chat</span>
              <span className="block text-[11px] text-[#8a8882]">
                Talk naturally with Agents
              </span>
            </span>
          </span>
        </SelectItem>
        <SelectItem value="agent">
          <span className="flex items-center gap-2">
            <Bot className="size-3.5" />
            <span>
              <span className="block">Agent</span>
              <span className="block text-[11px] text-[#8a8882]">
                Use connected MCP tools
              </span>
            </span>
          </span>
        </SelectItem>
        <SelectItem value="automation">
          <span className="flex items-center gap-2">
            <Workflow className="size-3.5" />
            <span>
              <span className="block">Automation</span>
              <span className="block text-[11px] text-[#8a8882]">
                Create a reviewable workflow
              </span>
            </span>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
