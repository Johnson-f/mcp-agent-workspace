"use client";

import type {
  ConversationMode,
  ConversationServerMessage,
} from "@agents/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { isDevAuthEnabled } from "@/lib/auth-session";
import {
  CONVERSATION_TITLE_EVENT,
  type ConversationTitleEventDetail,
} from "@/lib/conversation-events";
import {
  initialConversationStreamState,
  reduceConversationStreamState,
} from "@/lib/conversation-stream-state";

const websocketUrl = (conversationId: string) => {
  const base = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? "ws://localhost:6020";
  const url = new URL(`/ws/conversations/${conversationId}`, base);
  if (isDevAuthEnabled()) {
    url.searchParams.set(
      "devUserId",
      process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID ?? "local",
    );
  }
  return url.toString();
};

export const pendingConversationMessageKey = (conversationId: string) =>
  `agents:pending-conversation-message:${conversationId}`;

export const pendingConversationModeKey = (conversationId: string) =>
  `agents:pending-conversation-mode:${conversationId}`;

export const useConversationWebSocket = (input: {
  conversationId: string;
  onCompleted: () => void | Promise<void>;
  onTitle: (title: string) => void;
}) => {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState(initialConversationStreamState);
  const socketRef = useRef<WebSocket | null>(null);
  const completedRef = useRef(input.onCompleted);
  const titleRef = useRef(input.onTitle);
  completedRef.current = input.onCompleted;
  titleRef.current = input.onTitle;

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const socket = new WebSocket(websocketUrl(input.conversationId));
      socketRef.current = socket;
      socket.addEventListener("message", (message) => {
        let event: ConversationServerMessage;
        try {
          event = JSON.parse(String(message.data)) as ConversationServerMessage;
        } catch {
          return;
        }
        if (event.type === "connection_ready") {
          setConnected(true);
          return;
        }
        if (event.type === "conversation_title") {
          titleRef.current(event.title);
          window.dispatchEvent(
            new CustomEvent<ConversationTitleEventDetail>(
              CONVERSATION_TITLE_EVENT,
              {
                detail: {
                  conversationId: input.conversationId,
                  title: event.title,
                },
              },
            ),
          );
          return;
        }
        if (event.type === "user_message_accepted" && event.duplicate) {
          void Promise.resolve(completedRef.current()).finally(() => {
            setState(initialConversationStreamState);
          });
          return;
        }
        if (event.type === "turn_completed") {
          void Promise.resolve(completedRef.current()).finally(() => {
            setState(initialConversationStreamState);
          });
          return;
        }
        setState((current) => reduceConversationStreamState(current, event));
      });
      socket.addEventListener("close", () => {
        setConnected(false);
        if (!disposed) reconnectTimer = setTimeout(connect, 1_000);
      });
      socket.addEventListener("error", () => setConnected(false));
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [input.conversationId]);

  const sendMessage = useCallback((content: string, mode: ConversationMode) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const clientMessageId = crypto.randomUUID();
    setState({
      ...initialConversationStreamState,
      status: "starting",
      clientMessageId,
      optimisticUserText: content,
    });
    socket.send(
      JSON.stringify({
        type: "user_message",
        clientMessageId,
        content,
        mode,
      }),
    );
    return true;
  }, []);

  const sendToolDecision = useCallback(
    (decision: "approve" | "deny", turnId: string, callId: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(
        JSON.stringify({
          type: decision === "approve" ? "tool_call_approve" : "tool_call_deny",
          turnId,
          callId,
        }),
      );
      setState((current) => {
        const pending = current.pendingApproval;
        if (
          !pending ||
          pending.callId !== callId ||
          pending.turnId !== turnId
        ) {
          return current;
        }
        return {
          ...current,
          pendingApproval: null,
          toolActivities: [
            ...current.toolActivities.filter(
              (activity) => activity.callId !== callId,
            ),
            {
              callId,
              toolName: pending.toolName,
              status: decision === "approve" ? "running" : "denied",
              resultPreview: null,
              isError: decision === "deny",
            },
          ],
        };
      });
      return true;
    },
    [],
  );

  return {
    connected,
    active: state.status === "starting" || state.status === "streaming",
    state,
    sendMessage,
    sendToolDecision,
  };
};
