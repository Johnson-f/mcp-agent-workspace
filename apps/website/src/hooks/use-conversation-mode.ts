"use client";

import type { ConversationMode } from "@agents/contracts";
import { useCallback, useEffect, useState } from "react";
import {
  CONVERSATION_MODE_STORAGE_KEY,
  normalizeConversationMode,
} from "@/lib/conversation-mode";

export const useConversationMode = () => {
  const [mode, setModeState] = useState<ConversationMode>("chat");

  useEffect(() => {
    setModeState(
      normalizeConversationMode(
        window.localStorage.getItem(CONVERSATION_MODE_STORAGE_KEY),
      ),
    );
  }, []);

  const setMode = useCallback((nextMode: ConversationMode) => {
    setModeState(nextMode);
    window.localStorage.setItem(CONVERSATION_MODE_STORAGE_KEY, nextMode);
  }, []);

  return { mode, setMode };
};
