# Conversation Activity and Reasoning Summaries Design

Date: 2026-08-22
Status: Chat-approved; awaiting written-spec review

## Summary

Conversation turns will expose a real-time, durable activity timeline above the assistant's final answer. The timeline combines:

- model-provided reasoning summaries when the provider supports them;
- factual MCP tool lifecycle events;
- Automation proposal and response lifecycle events.

The feature will never request, stream, persist, or label raw hidden chain-of-thought as user-visible content. OpenAI reasoning summary events are the only model reasoning content that may enter the product-visible activity stream.

The timeline follows the supplied reference: a compact step count, thin vertical rail, small status dots, expandable reasoning summaries, terse tool rows, and a final answer that remains visually primary.

## Goals

1. Show reasoning summaries and tool progress while a conversation turn is running.
2. Persist the same ordered activity stream so reloads and reconnects reproduce it.
3. Support Chat, Agent, and Automation conversation modes through one contract.
4. Degrade cleanly when the selected model emits no reasoning summary.
5. Keep provider payloads, raw reasoning, credentials, tool arguments, and raw tool results outside the visible activity ledger.
6. Support three disclosure behaviors: Auto, Always expanded, and Remember last.

## Non-goals

- Exposing raw chain-of-thought or `reasoning_text` content.
- Requesting or storing provider `encrypted_content` reasoning.
- Replacing the existing durable Automation Run timeline.
- Replaying every provider-native SSE event to the browser.
- Showing raw MCP arguments, results, credentials, IDs, hashes, or internal retry details.
- Generating synthetic reasoning summaries with a second model call.

## Product Language and Safety Boundary

The UI calls the content **Reasoning summary**, not raw thought or chain-of-thought. It may use the shorter row label **Reasoning** when space is constrained.

Provider reasoning summaries are treated as model output:

- they may be incomplete or unavailable;
- they are not evidence that a tool ran;
- they cannot grant permission or alter policy;
- they are rendered with the same safe Markdown boundary as assistant messages;
- they are owner-scoped like the surrounding Conversation.

Factual activity rows come only from application state, such as a persisted tool call entering `running` or `completed`. Model prose cannot create a successful tool row.

## Considered Approaches

### 1. Native summaries plus a structured activity ledger — selected

Request provider reasoning summaries, normalize them with application-owned tool and status events, stream them through the existing WebSocket, and persist them in a dedicated activity table.

This preserves accurate chronology, avoids extra model calls, and gives reload/reconnect a durable authority.

### 2. Generate synthetic thoughts with another model call — rejected

This would add latency and cost, could narrate reasoning that did not occur, and would remain unavailable until after the underlying action. It does not satisfy the requirement for truthful live activity.

### 3. Store raw provider reasoning — rejected

Raw reasoning is not consistently available, is provider-specific, and violates the product's safety and abstraction boundaries. The implementation must explicitly ignore `response.reasoning_text.*` events.

## Provider Integration

The Responses API request will set:

```json
{
  "reasoning": {
    "summary": "auto"
  }
}
```

for supported reasoning models and auth modes.

The provider adapter recognizes only these reasoning-summary events:

- `response.reasoning_summary_part.added`
- `response.reasoning_summary_text.delta`
- `response.reasoning_summary_text.done`
- `response.reasoning_summary_part.done`

It ignores `response.reasoning_text.delta`, `response.reasoning_text.done`, encrypted reasoning, and unknown provider events.

The normalized model stream becomes:

```ts
type ModelStreamEvent =
  | { type: "text_delta"; delta: string }
  | {
      type: "reasoning_summary_started";
      providerItemId: string;
      summaryIndex: number;
    }
  | {
      type: "reasoning_summary_delta";
      providerItemId: string;
      summaryIndex: number;
      delta: string;
    }
  | {
      type: "reasoning_summary_completed";
      providerItemId: string;
      summaryIndex: number;
      text: string;
    }
  | { type: "function_call"; call: ModelFunctionCall };
```

Provider item IDs are used only for in-process correlation and are not sent to the browser or rendered in the UI.

If the provider rejects reasoning summaries as unsupported, the adapter retries once without the reasoning option only when the rejection occurs before response generation. The turn then continues without reasoning activities. Deterministic fallback mode emits no reasoning summaries.

## Normalized Conversation Activity

The product contract uses provider-independent activity objects:

```ts
type ConversationActivityKind =
  | "reasoning_summary"
  | "tool"
  | "automation"
  | "status";

type ConversationActivityStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "incomplete";

interface ConversationActivity {
  id: string;
  conversationId: string;
  turnId: string;
  sequence: number;
  kind: ConversationActivityKind;
  status: ConversationActivityStatus;
  title: string;
  content: string | null;
  toolCallId: string | null;
  startedAt: string;
  completedAt: string | null;
}
```

The public view omits owner IDs, provider IDs, tool IDs, arguments, results, hashes, artifact IDs, and internal error details.

Sequence numbers are assigned by the API per turn. They order reasoning and tool steps consistently across streaming, persistence, reconnect, and reload.

## Persistence

Add a `conversation_turn_activities` table:

- `id` UUID primary key;
- `conversation_id` foreign key with cascade delete;
- `turn_id` UUID, matching the Conversation WebSocket turn identity;
- `assistant_message_id` nullable foreign key, filled when the assistant message is persisted;
- `sequence` positive integer;
- `kind` enum;
- `status` enum;
- `title` bounded text;
- `content` nullable bounded text;
- `tool_call_id` nullable foreign key with `set null` deletion behavior;
- `public_metadata` JSONB containing only allowlisted display metadata;
- `started_at`, `completed_at`, and `updated_at` timestamps.

Constraints and indexes:

- unique `(turn_id, sequence)`;
- unique non-null `tool_call_id` so a tool call has one display activity;
- index `(conversation_id, started_at, sequence)`;
- content is capped at 16 KB per reasoning-summary activity;
- title is capped at 200 characters.

Conversation activity uses the Conversation's owner scope and retention lifecycle. It is not a replacement for encrypted Artifacts or the MCP audit log.

### Write behavior

- Lifecycle transitions are persisted before they are broadcast.
- Reasoning deltas are streamed immediately and checkpointed to the activity row at most every 250 ms or 1 KB, whichever comes first.
- Completion, failure, cancellation, disconnect, and process shutdown force a final checkpoint.
- A turn failure leaves active activities as `incomplete` unless a more specific failed state was already recorded.
- Completed assistant-message persistence links all activities for the turn to the new assistant message in the same transaction when practical; otherwise an idempotent follow-up update completes the link.

The database snapshot is the recovery authority. A crash may omit a provider delta that was never received or checkpointed, but already-persisted activity is never reconstructed from model guesses.

## WebSocket Contract

Add normalized server frames:

```ts
type ConversationActivityFrame =
  | {
      type: "activity_started";
      turnId: string;
      activity: ConversationActivity;
    }
  | {
      type: "activity_delta";
      turnId: string;
      activityId: string;
      delta: string;
    }
  | {
      type: "activity_completed";
      turnId: string;
      activity: ConversationActivity;
    }
  | {
      type: "activity_failed";
      turnId: string;
      activity: ConversationActivity;
    }
  | {
      type: "activity_snapshot";
      turnId: string;
      activities: ConversationActivity[];
    };
```

Frames contain display-safe activity views only. Existing tool approval frames remain authoritative and separate.

On reconnect during an active turn, `activity_snapshot` is emitted before new deltas. On ordinary page reload, Conversation detail returns persisted activities grouped by `turnId`.

## Mode-specific Activity

### Chat

- reasoning summaries when available;
- response lifecycle status;
- Automation proposal status when the model proposes one.

### Agent

- reasoning summaries when available;
- approval waiting state;
- tool started/completed/failed/denied rows;
- response lifecycle status.

Tool rows are derived from MCP gateway and tool-call state, never from model text.

### Automation discovery

- reasoning summaries when available;
- clarification and proposal-generation status;
- Automation proposal prepared status;
- no MCP execution rows because configuration mode does not run tools.

Durable Automation Run steps continue to use the existing Run timeline and Artifact model.

## UI Design

Create a reusable `ConversationActivityTimeline` rendered above each assistant message when that turn has visible activities.

### Timeline header

- `N steps` label and chevron;
- compact disclosure control with an accessible expanded state;
- an adjacent overflow or preferences control for Activity display mode;
- active turns show a subtle spinner next to the step count;
- no card shadow or heavy container border.

### Timeline body

- one-pixel vertical rail;
- small neutral dots for completed steps;
- animated but low-motion indicator for the active step;
- reasoning rows use an inner disclosure labeled `Reasoning`;
- reasoning content renders safe Markdown with restrained typography;
- tool rows use humanized names and connection context when useful;
- failures use muted red text without dumping technical errors;
- a jump-to-latest control appears only when live activity extends beyond the visible timeline and the user has scrolled away.

The final assistant answer remains outside and below the timeline with the existing primary message typography.

### Display modes

The default is `Auto`.

**Auto**

- expand when a turn starts or receives its first activity;
- collapse when the final assistant answer completes;
- a manual toggle during the active turn is respected until the next lifecycle transition.

**Always expanded**

- remain open during generation, after completion, and after reload;
- individual reasoning rows may still be collapsed.

**Remember last**

- remember the user's most recent timeline disclosure state;
- apply it to completed timelines and reloads;
- new active turns initially open so real-time progress is visible, after which a manual toggle is respected.

The display mode and remembered disclosure state are browser-local presentation preferences stored under versioned local-storage keys. Durable activities remain server-side and are not lost when preferences are cleared.

### Accessibility

- use native `details`/`summary` or equivalent accessible disclosure semantics;
- maintain keyboard navigation and visible focus;
- announce new step labels through a bounded polite live region, not every reasoning token;
- respect reduced-motion preferences;
- do not rely on color alone for status.

## Conversation Detail Contract

Conversation detail returns activities grouped by turn:

```ts
interface ConversationTurnActivityGroup {
  turnId: string;
  assistantMessageId: string | null;
  status: "running" | "completed" | "failed" | "incomplete";
  activities: ConversationActivity[];
}
```

The client associates a group with an assistant message through `assistantMessageId`, falling back to the message metadata `turnId` during transitional or incomplete states.

Historical messages without activities render exactly as they do today.

## Error Handling and Recovery

- Unsupported summary configuration: retry without summaries; do not fail the turn.
- Malformed summary event: ignore that event, record an internal diagnostic, and continue text/tool streaming.
- Oversized summary: truncate at the server boundary and mark public metadata `truncated: true`.
- Persistence failure before broadcast: omit the activity event and continue the assistant response when safe; record a redacted service diagnostic.
- Tool failure: show a failed factual tool row and preserve the existing Agent error behavior.
- Turn cancellation or disconnect: flush buffered summary content and mark unfinished activities `incomplete`.
- Reconnect: emit a database-backed snapshot, then resume new live deltas.
- Duplicate or out-of-order frames: reducer applies activity IDs and sequence numbers idempotently.

Reasoning-summary failures never prevent the assistant's final answer.

## Security and Privacy

- Never request or consume raw reasoning text for this feature.
- Never persist provider response bodies or raw SSE frames.
- Never include credentials, authorization headers, raw MCP arguments, or raw results in activities.
- Use human-readable connection and tool labels; do not expose internal UUIDs.
- Apply Conversation owner-scope checks to every activity read and write.
- Render reasoning Markdown with raw HTML disabled and external links hardened.
- Cap activity counts, title length, content length, and snapshot size.
- Treat reasoning summaries and tool output as untrusted model/data content, not permission or evidence of execution.

## Testing Strategy

### Provider adapter

- parses fragmented reasoning-summary SSE deltas;
- orders multiple summary parts;
- ignores raw reasoning-text events;
- preserves text and function-call streaming;
- falls back when summaries are unsupported.

### Contracts and reducer

- validates every activity frame;
- orders and deduplicates activities by ID and sequence;
- merges deltas idempotently;
- applies snapshots during reconnect;
- preserves existing conversation events.

### Database

- enforces sequence uniqueness and owner-scoped reads;
- checkpoints and completes reasoning activities;
- links activities to assistant messages;
- preserves incomplete activities after failure;
- cascades activities with Conversation deletion.

### API and WebSocket

- streams a reasoning summary before the final answer when available;
- persists before lifecycle broadcasts;
- emits factual tool rows from gateway state;
- reconnects with a snapshot without duplicating activities;
- continues when summaries are unavailable or malformed.

### Browser walkthrough

- Chat, Agent, and Automation turns display the timeline;
- activities update in real time;
- reload reproduces completed and incomplete activity;
- Auto collapses after completion;
- Always expanded survives reload;
- Remember last restores the disclosure choice;
- final answers remain readable and visually primary;
- keyboard and reduced-motion behavior are correct.

## Rollout and Compatibility

1. Apply the database migration before deploying the API.
2. Deploy provider parsing and persistence behind display-safe contracts.
3. Deploy WebSocket and Conversation-detail support.
4. Deploy the UI timeline and display preferences.

Old clients ignore unknown WebSocket frames only if their parser is forward-compatible. If strict decoding is present, deploy the contract/client before the API begins emitting activity frames.

Historical Conversations need no backfill. Their messages render without timelines.

This specification supersedes the older Conversation WebSocket design statement that the protocol never streams model reasoning: it still forbids raw reasoning, but now permits provider-generated reasoning summaries through the normalized activity contract.

## Acceptance Criteria

1. A supported reasoning-model turn shows a live reasoning summary before or alongside the final answer.
2. A model without reasoning summaries completes normally and shows factual application activities only.
3. Agent tool calls appear in chronological order with human-readable names and accurate lifecycle states.
4. Reloading the Conversation reproduces the same completed activities and summary content.
5. Reconnecting during an active turn emits a snapshot and does not duplicate steps.
6. Failed or cancelled turns retain bounded incomplete activity without exposing raw errors.
7. Auto, Always expanded, and Remember last each behave as specified.
8. Chat, Agent, and Automation discovery use the same timeline component and contract.
9. Existing historical messages and Run-detail timelines remain unchanged.
10. No raw reasoning text, encrypted reasoning, provider payload, UUID, credential, raw argument, or raw result appears in the visible timeline.
11. Reasoning-summary failure never prevents the final assistant answer.

