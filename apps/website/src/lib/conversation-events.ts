export const CONVERSATION_TITLE_EVENT = "agents:conversation-title";

export interface ConversationTitleEventDetail {
  conversationId: string;
  title: string;
}
