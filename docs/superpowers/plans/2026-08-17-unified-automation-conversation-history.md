# Unified Automation And Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate manual-run product path with Conversation-created Automations that always support Run now and may optionally have schedules, while adding persistent pinned/recent Conversation history to the light sidebar.

**Architecture:** Extend the existing contracts-first monorepo in dependency order: contracts, Drizzle schema, database repositories, authenticated RPC handlers, Temporal start path, then Next.js routes and sidebar. Preserve existing manual Agent Run records for reading, but route every new approval and execution through Automation and Automation Run objects.

**Tech Stack:** Node.js 24+, TypeScript 7, Effect RPC, Fastify, Drizzle/PostgreSQL, Temporal TypeScript SDK, Next.js 16.3.1, React 19.2.8, Tailwind CSS 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-unified-automation-conversation-history-design.md`

## Global Constraints

- Every Automation supports Run now; scheduling is optional.
- Manual and scheduled triggers create the same Automation Run shape and use the same preflight and Temporal workflow.
- Run now is disabled while another run is active.
- Automation Runs never wait for surprise permission approval.
- Conversations and messages remain append-only decision history.
- Conversation is free-form and model-led. `propose_automation` creates only an inert proposal; accepting and approving configuration remains explicit.
- Approved Run Brief and Automation Versions remain immutable.
- The sidebar uses the current light theme with Codex-like density and hierarchy.
- Existing manual Agent Run records remain readable during migration.

---

### Task 1: Define unified product contracts

**Files:**
- Modify: `packages/contracts/src/product-flow.ts`
- Modify: `packages/contracts/src/conversation-run-brief.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/unified-automation.ts`
- Create: `packages/contracts/src/unified-automation.test.ts`

**Interfaces:**
- Produces: `ConversationSummary`, `ConversationDetail`, `AutomationSummary`, `AutomationDetail`, `AutomationRunView`, `AutomationRunTriggerSource`, and authenticated RPC declarations consumed by API, database projections, and website.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  automationRunWorkflowInput,
  canRunAutomationNow,
  conversationHistorySections,
} from "./unified-automation";

describe("unified Automation behavior", () => {
  it("allows Run now with or without a schedule", () => {
    expect(canRunAutomationNow({ state: "live", hasActiveRun: false })).toBe(true);
  });

  it("blocks Run now while an Automation Run is active", () => {
    expect(canRunAutomationNow({ state: "live", hasActiveRun: true })).toBe(false);
  });

  it("records manual trigger metadata on workflow input", () => {
    expect(
      automationRunWorkflowInput({
        automationId: "automation-1",
        automationVersionId: "version-1",
        runId: "run-1",
        triggeredByUserId: "user-1",
      }),
    ).toMatchObject({ kind: "automation", triggerSource: "manual" });
  });

  it("separates pinned and recent Conversations", () => {
    const sections = conversationHistorySections([
      { id: "pinned", pinnedAt: "2026-08-17T10:00:00Z", updatedAt: "2026-08-17T10:00:00Z" },
      { id: "recent", pinnedAt: null, updatedAt: "2026-08-17T11:00:00Z" },
    ]);
    expect(sections.pinned.map((item) => item.id)).toEqual(["pinned"]);
    expect(sections.recent.map((item) => item.id)).toEqual(["recent"]);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --dir packages/contracts test -- src/unified-automation.test.ts`

Expected: FAIL because `unified-automation.ts` does not exist.

- [ ] **Step 3: Add the contract types and pure decisions**

```ts
export type AutomationRunTriggerSource = "manual" | "scheduled";

export interface ConversationSummary {
  id: string;
  title: string;
  state: "drafting" | "awaiting_user_input" | "ready_for_run_brief" | "run_brief_created" | "closed";
  pinnedAt: string | null;
  automationId: string | null;
  updatedAt: string;
}

export const canRunAutomationNow = (input: {
  state: "draft" | "pending_approval" | "live" | "paused" | "needs_reconfiguration" | "archived";
  hasActiveRun: boolean;
}) => input.state === "live" && !input.hasActiveRun;

export const conversationHistorySections = <T extends {
  pinnedAt: string | null;
  updatedAt: string;
}>(items: T[]) => ({
  pinned: items.filter((item) => item.pinnedAt !== null),
  recent: items.filter((item) => item.pinnedAt === null),
});

export const automationRunWorkflowInput = (input: {
  automationId: string;
  automationVersionId: string;
  runId: string;
  triggeredByUserId: string;
}) => ({
  runId: input.runId,
  kind: "automation" as const,
  automationId: input.automationId,
  automationVersionId: input.automationVersionId,
  triggerSource: "manual" as const,
  triggeredByUserId: input.triggeredByUserId,
});
```

Add Effect Schema projections for the new views and RPC declarations:

```ts
Rpc.make("ConversationsList", { success: Schema.Array(ConversationSummary), error: ApiError });
Rpc.make("ConversationGet", { payload: { conversationId: Schema.String }, success: ConversationDetail, error: ApiError });
Rpc.make("ConversationRename", { payload: { conversationId: Schema.String, title: Schema.String }, success: ConversationSummary, error: ApiError });
Rpc.make("ConversationPinUpdate", { payload: { conversationId: Schema.String, pinned: Schema.Boolean }, success: ConversationSummary, error: ApiError });
Rpc.make("AutomationsList", { success: Schema.Array(AutomationSummary), error: ApiError });
Rpc.make("AutomationGet", { payload: { automationId: Schema.String }, success: AutomationDetail, error: ApiError });
Rpc.make("AutomationApprove", { payload: { runBriefVersionId: Schema.String }, success: AutomationDetail, error: ApiError });
Rpc.make("AutomationRunNow", { payload: { automationId: Schema.String }, success: AutomationRunView, error: ApiError });
```

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --dir packages/contracts test && pnpm --dir packages/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contract layer**

```bash
git add packages/contracts/src
git commit -m "feat: define unified automation contracts"
```

### Task 2: Add Conversation history and run-trigger persistence

**Files:**
- Modify: `packages/db/src/schema/run-briefs.ts`
- Modify: `packages/db/src/schema/run-history.ts`
- Create: `packages/db/drizzle/0009_unify_automation_conversation_history.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Create: generated `packages/db/drizzle/meta/0009_snapshot.json`
- Create: `packages/db/src/unified-automation-schema.test.ts`

**Interfaces:**
- Produces: `conversations.pinnedAt`, `conversations.automationId`, `runs.triggerSource`, `runs.triggeredByUserId`, and `runs.scheduledFireTime`.

- [ ] **Step 1: Add failing schema assertions**

```ts
import { describe, expect, it } from "vitest";
import { conversations, runs } from "./schema";

describe("unified Automation schema", () => {
  it("persists Conversation history metadata", () => {
    expect(conversations.pinnedAt.name).toBe("pinned_at");
    expect(conversations.automationId.name).toBe("automation_id");
  });

  it("persists Automation Run trigger metadata", () => {
    expect(runs.triggerSource.name).toBe("trigger_source");
    expect(runs.triggeredByUserId.name).toBe("triggered_by_user_id");
    expect(runs.scheduledFireTime.name).toBe("scheduled_fire_time");
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/db test -- src/unified-automation-schema.test.ts`

Expected: FAIL because the columns are absent.

- [ ] **Step 3: Add schema fields**

Add `automation_run_trigger_source` with values `manual` and `scheduled`. Add nullable trigger fields so existing Agent Runs remain valid. Add `pinned_at` and nullable `automation_id` to Conversations, plus owner/pinned/update indexes.

```ts
export const automationRunTriggerSource = pgEnum("automation_run_trigger_source", [
  "manual",
  "scheduled",
]);

// conversations
pinnedAt: timestamp("pinned_at", { withTimezone: true, mode: "date" }),
automationId: uuid("automation_id"),

// runs
triggerSource: automationRunTriggerSource("trigger_source"),
triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
scheduledFireTime: timestamp("scheduled_fire_time", { withTimezone: true, mode: "date" }),
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `pnpm run db:generate`

The migration must preserve existing rows, add a foreign key from `conversations.automation_id` to `automations.id`, and include a check that Automation Runs have a trigger source while legacy Agent Runs may remain null.

- [ ] **Step 5: Verify schema and tests**

Run: `pnpm run db:check && pnpm --dir packages/db test && pnpm --dir packages/db typecheck`

Expected: PASS.

- [ ] **Step 6: Commit persistence shape**

```bash
git add packages/db/src/schema packages/db/src/unified-automation-schema.test.ts packages/db/drizzle
git commit -m "feat: persist conversation history and run triggers"
```

### Task 3: Implement owner-scoped Conversation history repositories

**Files:**
- Create: `packages/db/src/conversations.ts`
- Create: `packages/db/src/conversations.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/product-flow.ts`

**Interfaces:**
- Produces: `listConversationsForUser(userId)`, `getConversationForUser(userId, conversationId)`, `renameConversationForUser(input)`, `setConversationPinnedForUser(input)`, and `closeConversationForUser(input)`.

- [ ] **Step 1: Write repository tests against a transaction-capable test database adapter**

Cover owner isolation, pinned-first ordering, latest-activity ordering, rename trimming/length validation, pin/unpin timestamps, append-only message retrieval, and closed Conversation visibility.

```ts
expect(await listConversationsForUser(ownerUserId)).toEqual([
  expect.objectContaining({ id: pinnedConversationId, pinnedAt: expect.any(String) }),
  expect.objectContaining({ id: recentConversationId, pinnedAt: null }),
]);
expect(await getConversationForUser(otherUserId, pinnedConversationId)).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/db test -- src/conversations.test.ts`

Expected: FAIL because repository functions are absent.

- [ ] **Step 3: Implement workspace-membership-scoped queries**

Use the same `workspaceMemberships` join used by `findConversationForUser`. Return messages ordered by `createdAt`, summaries ordered by pinned first then `updatedAt DESC`, and never load raw artifacts.

- [ ] **Step 4: Make append update Conversation activity**

Keep `conversation_messages` append-only and update only `conversations.updated_at` after a successful append. When the initial title is the default, derive a title from the first user message, trimmed to 80 characters.

- [ ] **Step 5: Run database tests and typecheck**

Run: `pnpm --dir packages/db test && pnpm --dir packages/db typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Conversation persistence**

```bash
git add packages/db/src
git commit -m "feat: add conversation history repositories"
```

### Task 4: Create approved Automations from Conversations

**Files:**
- Create: `packages/db/src/automations.ts`
- Create: `packages/db/src/automations.test.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/contracts/src/automation-activation.ts`

**Interfaces:**
- Consumes: approved `run_brief_versions` and Tool Authorization Snapshots.
- Produces: `approveAutomationProposal(input)`, `listAutomationsForUser(userId)`, `getAutomationForUser(userId, automationId)`, and `getAutomationRunStartContext(input)`.

- [ ] **Step 1: Write failing approval tests**

Test that approval rejects an incomplete Run Brief, creates one logical Automation and immutable version, links the Conversation, copies frozen tool authorization data, treats `manual_only` as “No schedule,” and is idempotent for the same Run Brief Version.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/db test -- src/automations.test.ts`

- [ ] **Step 3: Implement atomic approval**

Inside one database transaction:

1. Lock the Run Brief Version and verify `state = approved` and `mode = automation`.
2. Reuse an existing linked Automation or insert one in `pending_approval`.
3. Insert Automation Version 1 with the approved Run Brief, budget, destination, optional schedule, retention policy, and frozen authorization snapshot.
4. Evaluate activation preflight.
5. Set the Automation to `live` only when preflight succeeds.
6. Link `conversations.automation_id` and set Conversation state to `closed`.

- [ ] **Step 4: Test list/detail projections**

Automation summaries must include schedule label, latest Run state/time, next scheduled time when present, and needs-reconfiguration reason. Detail must include current version, tools, budget, output destination, recent runs, and originating Conversation ID.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --dir packages/db test && pnpm --dir packages/db typecheck`

- [ ] **Step 6: Commit Automation repositories**

```bash
git add packages/db/src packages/contracts/src/automation-activation.ts
git commit -m "feat: create automations from approved conversations"
```

### Task 5: Add authenticated Conversation and Automation RPC handlers

**Files:**
- Modify: `apps/api/src/rpc/server.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/website/src/lib/rpc.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/rpc/server.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4 repository functions.
- Produces: website client methods with the same names as the RPC declarations.

- [ ] **Step 1: Write failing handler tests**

Exercise unauthenticated rejection, owner scoping, rename, pin/unpin, list/get, Automation approval, and Automation detail. Assert that API errors use `InvalidRequest`, `NotFound`, or `Conflict` without exposing database messages.

Add `"test": "vitest run"` to `apps/api/package.json` and add `vitest` as a dev dependency matching the workspace version.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir apps/api test -- src/rpc/server.test.ts`

- [ ] **Step 3: Add handlers and website wrappers**

```ts
listConversations: () => run((client) => client.ConversationsList()),
getConversation: (conversationId: string) =>
  run((client) => client.ConversationGet({ conversationId })),
renameConversation: (conversationId: string, title: string) =>
  run((client) => client.ConversationRename({ conversationId, title })),
setConversationPinned: (conversationId: string, pinned: boolean) =>
  run((client) => client.ConversationPinUpdate({ conversationId, pinned })),
listAutomations: () => run((client) => client.AutomationsList()),
getAutomation: (automationId: string) =>
  run((client) => client.AutomationGet({ automationId })),
approveAutomation: (runBriefVersionId: string) =>
  run((client) => client.AutomationApprove({ runBriefVersionId })),
runAutomationNow: (automationId: string) =>
  run((client) => client.AutomationRunNow({ automationId })),
```

- [ ] **Step 4: Run API, contract, and website typechecks**

Run: `pnpm run check:contracts && pnpm run check:api && pnpm run check:website`

- [ ] **Step 5: Commit RPC surface**

```bash
git add apps/api/src/rpc apps/website/src/lib/rpc.ts packages/contracts/src/index.ts
git commit -m "feat: expose conversation and automation RPCs"
```

### Task 6: Route Run now through Automation Run preflight and Temporal

**Files:**
- Modify: `packages/agent-runtime/src/bridge/types.ts`
- Modify: `packages/agent-runtime/src/start-run.ts`
- Modify: `apps/api/src/rpc/server.ts`
- Modify: `packages/db/src/automations.ts`
- Create: `packages/agent-runtime/src/automation-run.test.ts`

**Interfaces:**
- Produces: `startAutomationRunNow({ automationId, userId })` and workflow input with `kind: "automation"`, Automation IDs, `allowWaitingForUser: false`, and `triggerSource: "manual"`.

- [ ] **Step 1: Write failing run-start tests**

Cover live/no-active success, active-run conflict, paused/stale/unavailable denial, workflow ID `run:${runId}`, manual trigger actor persistence, and scheduled-trigger compatibility.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/agent-runtime test -- src/automation-run.test.ts`

- [ ] **Step 3: Implement atomic Run now creation**

The database operation must re-read the current Automation Version, execute Run Start Preflight, reject when an active run exists, insert `runs.kind = automation`, set trigger metadata, and return the exact workflow input IDs. The API then starts Temporal and persists the Temporal identity using the existing `updateRunTemporalIdentity` function.

```ts
executionPolicy: {
  allowWaitingForUser: false,
  allowUnapprovedTools: false,
  requiredToolUnavailable: version.requiredToolUnavailable,
  optionalToolUnavailable: "continue_degraded",
}
```

- [ ] **Step 4: Keep legacy reads working**

Leave `ManualAgentRunStart` and Agent Run detail available only for existing links during migration. Remove them from new website flows but do not delete rows or routes in this task.

- [ ] **Step 5: Run runtime, database, and API tests**

Run: `pnpm run test:agent-runtime && pnpm run test:db && pnpm run check:api`

- [ ] **Step 6: Commit unified run start**

```bash
git add packages/agent-runtime apps/api/src/rpc/server.ts packages/db/src/automations.ts
git commit -m "feat: run automations on demand"
```

### Task 7: Build the light Conversation history sidebar

**Files:**
- Modify: `apps/website/src/components/app-sidebar.tsx`
- Modify: `apps/website/src/components/app-header.tsx`
- Modify: `apps/website/src/lib/app-navigation.ts`
- Modify: `apps/website/src/lib/app-navigation.test.ts`
- Create: `apps/website/src/hooks/use-conversation-history.ts`

**Interfaces:**
- Consumes: `agentsRpc.listConversations()` and pin/rename operations.
- Produces: sidebar groups New automation, Automations, Pinned, and Recent.

- [ ] **Step 1: Extend navigation tests**

Assert `/conversations/new`, `/conversations/[id]`, `/automations`, and `/automations/[id]` headers and active states. Test `conversationHistorySections` ordering with pinned and recent records.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test apps/website/src/lib/app-navigation.test.ts`

- [ ] **Step 3: Implement the sidebar**

Keep the current light palette. Use full-width selected rows, 32px row height, 11px section labels, truncated titles, and bottom-aligned workspace controls. Load history after authentication, show skeleton rows during the first request, and preserve navigation when history refresh fails.

- [ ] **Step 4: Add pin and rename menus**

Expose menus only from a Conversation row. Update optimistically, roll back on RPC failure, and display the existing inline error treatment rather than a browser alert.

- [ ] **Step 5: Verify responsive behavior**

The same history content must render inside the existing mobile Sheet. Long titles truncate; sidebar and sheet remain keyboard navigable.

- [ ] **Step 6: Run website checks**

Run: `pnpm --dir apps/website exec tsc --noEmit && pnpm --dir apps/website lint && pnpm --dir apps/website build`

- [ ] **Step 7: Commit sidebar history**

```bash
git add apps/website/src/components apps/website/src/hooks apps/website/src/lib
git commit -m "feat: add conversation history sidebar"
```

### Task 8: Replace New run with the Automation Conversation route

**Files:**
- Create: `apps/website/src/app/(app)/conversations/new/page.tsx`
- Create: `apps/website/src/app/(app)/conversations/[conversationId]/page.tsx`
- Create: `apps/website/src/app/(app)/conversations/[conversationId]/conversation-client.tsx`
- Create: `apps/website/src/app/(app)/conversations/conversation-view-model.ts`
- Create: `apps/website/src/app/(app)/conversations/conversation-view-model.test.ts`
- Move reusable composer UI from: `apps/website/src/app/(app)/runs/new/new-run-client.tsx`
- Modify: `apps/website/src/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: Conversation RPCs, Run Brief draft evaluation, and Automation approval.
- Produces: free-form model conversation, reviewable Automation Proposals, explicit configuration, and final Approve automation action.

Every message is sent to the model with bounded append-only history. The model may emit one structured proposal tool call:

```ts
type AutomationProposal = {
  goal: string;
  successCriteria: string[];
  expectedOutput: string | null;
  schedule: SuggestedSchedule | null;
  suggestedToolNames: string[];
};
```

The proposal is persisted in assistant-message metadata. It remains inert until the user clicks **Use this proposal**. Tool permissions, schedule details, budget, output destination, and final approval remain explicit controls.

- [ ] **Step 1: Write Conversation view-model tests**

Test missing-field ordering, Run Brief progress, final-review availability, and the post-approval destination. Use the real `evaluateRunBriefDraft` contract function.

```ts
expect(conversationNextAction(incompleteDraft)).toEqual({
  kind: "ask_missing_field",
  field: "successCriteria",
});
expect(conversationNextAction(completeDraft)).toEqual({ kind: "review_automation" });
expect(automationApprovalDestination("automation-1")).toBe("/automations/automation-1");
```

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test apps/website/src/app/'(app)'/conversations/conversation-view-model.test.ts`

Expected: FAIL because the view-model module is missing.

- [ ] **Step 3: Implement the Conversation screen**

Reuse the centered Claude-style composer. Render append-only user and assistant messages above it. The Run Brief control shows missing fields and current approved tools. Ask one missing field at a time and preserve the draft when navigating away.

- [ ] **Step 4: Implement final approval**

When `evaluateRunBriefDraft` reports no missing fields, show the final Run Brief review and per-write-tool acknowledgements. Approval calls `AutomationApprove`; success navigates to the resulting Automation detail route.

- [ ] **Step 5: Redirect legacy New run navigation**

Change sidebar and landing actions to `/conversations/new`. Keep `/runs/new` temporarily redirecting to `/conversations/new` so existing bookmarks do not break.

- [ ] **Step 6: Run website build and flow tests**

Run: `pnpm --dir apps/website lint && pnpm --dir apps/website build`

- [ ] **Step 7: Commit Conversation UI**

```bash
git add apps/website/src/app apps/website/src/components
git commit -m "feat: create automations through conversations"
```

### Task 9: Add Automation library and detail pages

**Files:**
- Create: `apps/website/src/app/(app)/automations/page.tsx`
- Create: `apps/website/src/app/(app)/automations/automations-client.tsx`
- Create: `apps/website/src/app/(app)/automations/[automationId]/page.tsx`
- Create: `apps/website/src/app/(app)/automations/[automationId]/automation-detail-client.tsx`
- Create: `apps/website/src/app/(app)/automations/automation-view-model.ts`
- Create: `apps/website/src/app/(app)/automations/automation-view-model.test.ts`
- Modify: `apps/website/src/lib/app-navigation.ts`

**Interfaces:**
- Consumes: Automation list/detail/Run now RPCs.
- Produces: state-aware Automation management UI.

- [ ] **Step 1: Add failing view-model tests**

Test needs-attention-first ordering, schedule labels, latest-run display, Run now enablement, active-run blocking, and linked Conversation navigation.

- [ ] **Step 2: Verify RED**

Run: `node --import tsx --test apps/website/src/app/'(app)'/automations/automation-view-model.test.ts`

Expected: FAIL because `automation-view-model.ts` is missing.

- [ ] **Step 3: Build the Automation library**

Render rows with name, lifecycle state, “No schedule” or recurrence, next run, and latest result. Keep list rows compact and consistent with the light sidebar.

- [ ] **Step 4: Build Automation detail**

Render Run now as the primary action, followed by schedule, Run Brief version, approved tools/boundaries, budget, destination, recent runs, and originating Conversation. When blocked, replace a generic disabled tooltip with the exact preflight reason.

- [ ] **Step 5: Verify Run now behavior**

On success, navigate to `/runs/[runId]`; on conflict, refresh Automation detail so active/stale state is current.

- [ ] **Step 6: Run website checks and build**

Run: `pnpm --dir apps/website exec tsc --noEmit && pnpm --dir apps/website lint && pnpm --dir apps/website build`

- [ ] **Step 7: Commit Automation UI**

```bash
git add apps/website/src/app apps/website/src/lib/app-navigation.ts
git commit -m "feat: add automation library and detail"
```

### Task 10: Migrate terminology and verify the complete story

**Files:**
- Modify: `CONTEXT.md`
- Modify: `TODO.md`
- Modify: `apps/website/src/app/(app)/runs/new/page.tsx`
- Modify: `packages/contracts/src/conversation-run-brief.test.ts`
- Modify: `packages/contracts/src/product-flow.test.ts`
- Modify: `packages/contracts/src/eval-route.test.ts`
- Modify: `packages/agent-runtime/src/bridge/types.test.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: one coherent product vocabulary and verified end-to-end flow.

- [ ] **Step 1: Update the glossary**

Define Conversation → Automation → Automation Run, optional Automation Schedule, trigger source, and Run now. Mark Agent Run as a legacy migration term rather than a user-facing product concept.

- [ ] **Step 2: Update acceptance/evaluation fixtures**

Replace new `manual_agent_run` scenarios with Automation conversations that have no schedule. Retain explicit legacy read fixtures for migration coverage.

- [ ] **Step 3: Apply migrations to local infrastructure**

Run: `make infra-up && make db-migrate`

Expected: migration applies once and `pnpm run db:check` passes.

- [ ] **Step 4: Run the complete verification suite**

```bash
make check
make test
pnpm run test:evals
pnpm run db:check
pnpm --dir apps/website build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Verify the live user flow**

Start with `make dev`, then verify:

1. New automation creates and opens a Conversation.
2. The Conversation appears under Recent and can be pinned.
3. Missing Run Brief fields prevent approval.
4. Approval creates one live Automation with no schedule when none was requested.
5. Run now creates an Automation Run and opens its run detail.
6. Adding a schedule creates a new approved version.
7. The same Automation can run from Run now and its schedule.
8. An active run disables Run now.
9. Runs appear under Automation detail, not in sidebar history.

- [ ] **Step 6: Commit final terminology and compatibility work**

```bash
git add CONTEXT.md TODO.md apps packages
git commit -m "refactor: unify runs under automations"
```
