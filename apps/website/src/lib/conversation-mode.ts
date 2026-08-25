import type { ConversationMode } from "@agents/contracts";

export const CONVERSATION_MODE_STORAGE_KEY = "agents:conversation-mode";

export const normalizeConversationMode = (
  value: string | null | undefined,
): ConversationMode =>
  value === "agent" || value === "automation" ? value : "chat";
