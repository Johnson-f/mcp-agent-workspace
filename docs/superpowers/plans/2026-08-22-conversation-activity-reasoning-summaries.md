# Conversation Activity and Reasoning Summaries Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use `ns-work` to implement this plan inline, preserve the dirty working tree, and do not commit, push, deploy, or publish.

**Goal:** Add a real-time, persisted Conversation activity timeline containing provider reasoning summaries when available and factual tool/status events, with Auto, Always expanded, and Remember last display modes.

**Architecture:** Normalize provider summary events in `@agents/agent-runtime`, persist display-safe ordered activities in PostgreSQL, stream them through the existing Conversation WebSocket, and render the same durable activity objects before assistant messages. Raw reasoning, provider payloads, tool arguments, raw results, credentials, and internal identifiers never enter the public activity contract.

**Tech Stack:** TypeScript, OpenAI Responses API SSE, Effect RPC contracts, Fastify WebSockets, Drizzle/PostgreSQL, React 19, Next.js 16, Tailwind CSS, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-22-conversation-activity-reasoning-summaries-design.md`

## Global Constraints

- Display only provider-generated reasoning summaries; ignore raw `response.reasoning_text.*` and encrypted reasoning content.
- Reasoning-summary failure must never prevent the final assistant answer.
- Activities are owner-scoped, display-safe, ordered by API-assigned sequence, capped at 16 KB content and 200-character titles.
- Tool activity is derived from MCP gateway state, never model narration.
- Existing Run-detail timelines and historical Conversations remain compatible.
- Default display mode is Auto; all three approved modes must work after reload.
- Use TDD for every new behavior and run each focused test red then green.
- Preserve all pre-existing working-tree changes.

---

### Task 1: Public activity contracts and client reducer

**Files:**
- Modify: `packages/contracts/src/unified-automation.ts`
- Modify: `packages/contracts/src/conversation-stream.ts`
- Modify: `packages/contracts/src/conversation-stream.test.ts`
- Modify: `apps/website/src/lib/conversation-stream-state.ts`
- Modify: `apps/website/src/lib/conversation-stream-state.test.ts`
- Modify: `apps/website/package.json`

**Interfaces:**
- Produces `ConversationActivity`, `ConversationTurnActivityGroup`, and activity WebSocket frame types.
- Produces an activity-aware `ConversationStreamState.activities` reducer consumed by Tasks 4 and 5.

- [ ] **Step 1: Add failing contract tests** for activity frame parsing/serialization, display-safe activity fields, ordering, snapshot replacement, delta merge, completion, failure, and duplicate-frame idempotency.
- [ ] **Step 2: Run** `pnpm --dir packages/contracts test -- src/conversation-stream.test.ts` and `pnpm --dir apps/website test` and confirm failures are caused by missing activity types/reducer behavior.
- [ ] **Step 3: Add schemas and types** equivalent to:

```ts
export const ConversationActivity = Schema.Struct({
  id: Schema.String,
  turnId: Schema.String,
  sequence: Schema.Number,
  kind: Schema.Literal("reasoning_summary", "tool", "automation", "status"),
  status: Schema.Literal("running", "waiting", "completed", "failed", "incomplete"),
  title: Schema.String,
  content: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
});
```

Add `activities: Schema.Array(ConversationTurnActivityGroup)` to `ConversationDetail`, and add `activity_started`, `activity_delta`, `activity_completed`, `activity_failed`, and `activity_snapshot` server frames.

- [ ] **Step 4: Implement reducer behavior** keyed by activity ID and sorted by sequence. Snapshots replace the active turn's activity set; deltas append only to the matching activity; terminal events replace the matching view.
- [ ] **Step 5: Run focused tests** until both suites pass.

### Task 2: Durable activity schema and repository

**Files:**
- Create: `packages/db/src/schema/conversation-activities.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/conversation-activities.ts`
- Create: `packages/db/src/conversation-activities.test.ts`
- Modify: `packages/db/src/conversations.ts`
- Create through Drizzle generator: `packages/db/drizzle/0013_*.sql`
- Create through Drizzle generator: `packages/db/drizzle/meta/0013_snapshot.json`
- Modify through Drizzle generator: `packages/db/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes public activity status/kind literals from Task 1.
- Produces `startConversationActivity`, `appendConversationActivityDelta`, `completeConversationActivity`, `failConversationActivity`, `markTurnActivitiesIncomplete`, `linkTurnActivitiesToAssistantMessage`, and `listConversationActivityGroups`.

- [ ] **Step 1: Add failing database tests** for sequence uniqueness, content/title bounds, ordered reads, delta checkpointing, terminal states, incomplete marking, assistant-message linking, and owner-scoped Conversation detail reads.
- [ ] **Step 2: Run** `pnpm --dir packages/db test -- src/conversation-activities.test.ts` and confirm the missing repository/schema failure.
- [ ] **Step 3: Define Drizzle schema** with `conversation_activity_kind` and `conversation_activity_status` enums, the columns and constraints from the spec, unique `(turn_id, sequence)`, unique non-null `tool_call_id`, and Conversation cascade deletion.
- [ ] **Step 4: Implement repository functions** that clamp title/content at the write boundary, update idempotently, and return public ISO-string views without internal IDs except the activity ID and turn ID required by the client.
- [ ] **Step 5: Extend Conversation detail** to return activity groups ordered by turn and sequence.
- [ ] **Step 6: Generate migration** with `pnpm run db:generate`, inspect it for activity-only changes, then run `pnpm run db:check` and the focused DB tests.

### Task 3: Provider reasoning-summary parsing

**Files:**
- Modify: `packages/agent-runtime/src/bridge/model-provider.ts`
- Modify: `packages/agent-runtime/src/bridge/model-provider.test.ts`
- Modify: `packages/agent-runtime/src/conversation-model.ts`
- Modify: `packages/agent-runtime/src/interactive-agent.ts`

**Interfaces:**
- Produces `ModelReasoningSummaryEvent` callbacks from `executeStreamingTextModel` without exposing raw provider events.
- Consumed by the WebSocket orchestration in Task 4.

- [ ] **Step 1: Add failing provider tests** using literal SSE fixtures for fragmented summary deltas, multiple summary parts, ignored `response.reasoning_text.delta`, preserved output text/function calls, and unsupported-summary fallback.
- [ ] **Step 2: Run** `pnpm --dir packages/agent-runtime test -- src/bridge/model-provider.test.ts` and confirm missing summary callbacks/configuration.
- [ ] **Step 3: Extend streaming request options** with `onReasoningSummaryEvent` and add `reasoning: { summary: "auto" }` to supported Responses API requests.
- [ ] **Step 4: Parse only summary events** into provider-independent started/delta/completed callbacks. Never surface `reasoning_text` or encrypted content.
- [ ] **Step 5: Thread the callback** through Chat/Automation streaming and interactive Agent steps while preserving existing text and function-call behavior.
- [ ] **Step 6: Run focused agent-runtime tests** until green.

### Task 4: WebSocket persistence and factual activity orchestration

**Files:**
- Modify: `apps/api/src/conversation-websocket.ts`
- Modify: `packages/db/src/interactive-agent.ts`
- Modify: `packages/mcp-gateway/src/service.ts` only if an existing lifecycle callback cannot provide the persisted tool-call ID
- Add focused tests at the narrowest existing seam in `packages/contracts`, `packages/db`, or `packages/agent-runtime`; do not add source-text tests.

**Interfaces:**
- Consumes provider callbacks from Task 3 and repository functions from Task 2.
- Emits Task 1 activity frames and reconnect snapshots.

- [ ] **Step 1: Add failing orchestration tests** proving a reasoning activity is persisted before lifecycle broadcast, deltas append to the correct activity, tool rows use gateway state, and a failed/cancelled turn marks active activities incomplete.
- [ ] **Step 2: Run the focused test** and confirm it catches missing persistence/frames.
- [ ] **Step 3: Add a per-turn activity writer** that assigns increasing sequence numbers, buffers reasoning deltas for at most 250 ms or 1 KB, and force-flushes on completion/failure/disconnect.
- [ ] **Step 4: Map model summaries** to reasoning activities in Chat, Agent, and Automation branches.
- [ ] **Step 5: Map Agent lifecycle** to waiting/running/completed/failed/denied tool activities using humanized connection/tool labels and persisted tool-call identity.
- [ ] **Step 6: Persist Automation proposal/status rows** without executing MCP tools.
- [ ] **Step 7: Emit database-backed `activity_snapshot`** on reconnect before new live deltas.
- [ ] **Step 8: Link completed turn activities** to the assistant message and preserve incomplete rows when final response persistence fails.
- [ ] **Step 9: Run focused orchestration, API typecheck, and affected package tests** until green.

### Task 5: Reference-style persistent activity timeline UI

**Files:**
- Create: `apps/website/src/components/conversation-activity-timeline.tsx`
- Create: `apps/website/src/lib/conversation-activity-display.ts`
- Create: `apps/website/src/lib/conversation-activity-display.test.ts`
- Modify: `apps/website/src/app/(app)/conversations/[conversationId]/conversation-client.tsx`
- Modify: `apps/website/src/components/markdown-message.tsx` only if a smaller typography variant is required
- Modify: `apps/website/package.json`

**Interfaces:**
- Consumes persisted `ConversationTurnActivityGroup[]` and live reducer activities from Tasks 1 and 4.
- Produces the Activity display preference `"auto" | "always_expanded" | "remember_last"` and the timeline component.

- [ ] **Step 1: Add failing display-policy tests** for Auto live-open/completed-collapse, Always-expanded reload behavior, Remember-last restoration, and safe invalid-storage fallback.
- [ ] **Step 2: Run** `pnpm --dir apps/website test` and confirm missing policy behavior.
- [ ] **Step 3: Implement versioned local-storage helpers** for display mode and remembered expanded state; default to Auto and avoid server-render reads.
- [ ] **Step 4: Build `ConversationActivityTimeline`** with an accessible `N steps` disclosure, vertical rail, reasoning inner disclosures with safe Markdown, compact factual tool/status rows, reduced-motion support, and no card shadow.
- [ ] **Step 5: Add the three-mode preference menu** adjacent to the step header. Active turns initially open in all modes; subsequent behavior follows the approved policy.
- [ ] **Step 6: Render persisted groups** above their assistant messages using `assistantMessageId` or `turnId`, and render the active group's live activities before the streaming assistant answer.
- [ ] **Step 7: Remove the old standalone live tool-activity cards** only after the timeline covers the same factual states and approval UI remains unchanged.
- [ ] **Step 8: Run website tests, lint, and build** until green.

### Task 6: Integration, recovery, and compatibility

**Files:**
- Modify only the files above as failures require.
- Modify: `docs/superpowers/specs/2026-08-20-conversation-websocket-streaming-design.md` to clarify that raw reasoning remains forbidden while normalized summaries are permitted.

**Interfaces:**
- Integrates all prior tasks without changing Automation Run history.

- [ ] **Step 1: Apply migration locally** with `pnpm run db:migrate` and restart the complete stack with `make dev` so the API and worker load new code.
- [ ] **Step 2: Run full static gate:** `pnpm run check`.
- [ ] **Step 3: Run relevant tests:** `pnpm run test:contracts`, `pnpm run test:db`, `pnpm run test:mcp-gateway`, `pnpm run test:agent-runtime`, `pnpm --dir apps/api test`, and `pnpm run test:website`.
- [ ] **Step 4: Run production build:** `pnpm --dir apps/website build`.
- [ ] **Step 5: Browser-walk Chat, Agent, and Automation turns** and verify live steps, final-answer primacy, no UUID/raw payload leakage, keyboard disclosure behavior, and all three display modes.
- [ ] **Step 6: Reload completed and interrupted turns** and verify database-backed activity persistence and no duplicate activities.
- [ ] **Step 7: Query PostgreSQL read-only** to confirm ordered persisted activities and absence of raw tool arguments/results in the activity table.
- [ ] **Step 8: Inspect all owned files and generated migration**; classify remaining failures as owned, pre-existing, unrelated, environmental, or blocked.

