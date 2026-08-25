"use client";

import type { ConversationSummary } from "@agents/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAuthSession } from "@/lib/auth-session";
import {
  CONVERSATION_TITLE_EVENT,
  type ConversationTitleEventDetail,
} from "@/lib/conversation-events";
import { agentsRpc } from "@/lib/rpc";

export const useConversationHistory = (refreshKey: string) => {
  const { isInitialized, session } = useAuthSession();
  const [conversations, setConversations] = useState<
    readonly ConversationSummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isInitialized || !session) {
      if (isInitialized) {
        setLoading(false);
      }
      return;
    }

    try {
      setConversations(await agentsRpc.listConversations());
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Conversation history could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [isInitialized, session]);

  useEffect(() => {
    if (refreshKey) {
      void refresh();
    }
  }, [refresh, refreshKey]);

  useEffect(() => {
    const updateTitle = (event: Event) => {
      const { conversationId, title } = (
        event as CustomEvent<ConversationTitleEventDetail>
      ).detail;
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, title }
            : conversation,
        ),
      );
    };
    window.addEventListener(CONVERSATION_TITLE_EVENT, updateTitle);
    return () =>
      window.removeEventListener(CONVERSATION_TITLE_EVENT, updateTitle);
  }, []);

  const setPinned = async (conversationId: string, pinned: boolean) => {
    const previous = conversations;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              pinnedAt: pinned ? new Date().toISOString() : null,
            }
          : conversation,
      ),
    );
    try {
      await agentsRpc.setConversationPinned(conversationId, pinned);
      await refresh();
    } catch (requestError) {
      setConversations(previous);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Conversation pin could not be changed.",
      );
    }
  };

  const rename = async (conversationId: string, title: string) => {
    const previous = conversations;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, title }
          : conversation,
      ),
    );
    try {
      await agentsRpc.renameConversation(conversationId, title);
      await refresh();
    } catch (requestError) {
      setConversations(previous);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Conversation title could not be changed.",
      );
    }
  };

  const archive = async (conversationId: string) => {
    try {
      await agentsRpc.setConversationArchived(conversationId, true);
      setConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId),
      );
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Conversation could not be archived.",
      );
      return false;
    }
  };

  const remove = async (conversationId: string, confirmationTitle: string) => {
    await agentsRpc.deleteConversation(conversationId, confirmationTitle);
    setConversations((current) =>
      current.filter((conversation) => conversation.id !== conversationId),
    );
  };

  return {
    conversations,
    loading,
    error,
    refresh,
    rename,
    setPinned,
    archive,
    remove,
  };
};
