# Unified Automation And Conversation History Design

## Objective

Unify one-off and scheduled work under one Automation model. A user starts with a Conversation, approves an Automation, and may run that Automation manually or through an optional schedule. The product does not expose a separate manual Agent Run concept.

## Domain Model

### Conversation

An append-only exchange used to make an Automation explicit enough to approve. It collects the goal, success criteria, evidence requirements, tools, permission boundaries, expected output, budget, unavailable-tool behavior, and optional schedule.

A Conversation may be drafting, awaiting user input, ready for approval, linked to an Automation, or closed. It remains readable after Automation creation as the decision history behind that Automation.

### Automation

The reusable, user-approved definition of work. Every Automation supports manual execution through **Run now**. An Automation may additionally have a schedule.

An Automation owns immutable versions. Changing its Run Brief, tools, permissions, output destination, budget, retention policy, or schedule creates a new version that must pass approval and activation preflight.

### Automation Schedule

An optional recurrence rule attached to an Automation Version. Absence of a schedule means the Automation runs only when triggered manually. A scheduled Automation still supports **Run now**.

### Automation Run

One durable execution of an approved Automation Version. Every run records a trigger source of `manual` or `scheduled`. Both trigger sources use the same start preflight, frozen permissions, budget, Temporal workflow, artifacts, run steps, and final-output model.

Automation Runs never pause for surprise permission requests. A blocked manual trigger returns the user to the exact configuration or approval problem before execution begins.

## Navigation And Conversation History

The primary sidebar contains:

1. **New automation** — creates a Conversation and opens it.
2. **Automations** — opens the Automation library.
3. **Pinned** — pinned Conversations.
4. **Recent** — remaining Conversations ordered by latest activity.

Runs do not appear in conversation history. They appear inside the Automation that produced them.

Conversation rows show the title and one compact state indicator: Draft, Needs input, Ready for approval, or Automation created. The selected Conversation uses a quiet highlighted row. Titles are initially derived from the first user message and may be renamed. Conversations may be pinned, unpinned, or closed without mutating their messages.

### Visual Treatment

Use the current light Agents theme. Follow the Codex sidebar reference for hierarchy, density, indentation, full-width selected rows, section labels, and bottom-aligned workspace controls. Do not adopt the reference's dark palette.

## Conversation Experience

`/conversations/[conversationId]` uses a centered, free-form model conversation. Every user message is appended to model-visible history, and the model responds naturally to ordinary chat.

The model receives a `propose_automation` tool. It calls this only when the user clearly wants reusable, repeatable, on-demand, or scheduled work. The tool result is a reviewable Automation Proposal and never grants permissions, creates a schedule, or activates an Automation. The user must explicitly accept the proposal before it seeds a Run Brief. A compact **Run Brief** control exposes current progress and unresolved fields without replacing the conversation with a large form.

When all required fields are explicit, the agent presents a final review. **Approve automation** creates the first approved Automation Version and links it to the Conversation. The user is then sent to the Automation detail page, where **Run now** is available if activation preflight succeeds.

## Automation Library

`/automations` lists Automations rather than Conversations. Each row shows:

- Name
- State
- Schedule summary or “No schedule”
- Next scheduled run when applicable
- Latest run state and time
- Needs-reconfiguration reason when applicable

The default ordering is needs-attention first, then recently updated.

## Automation Detail

`/automations/[automationId]` shows:

- Automation name and lifecycle state
- **Run now** primary action
- Optional schedule and next run
- Current approved Run Brief Version
- Approved tools and Allowed Outcome Boundaries
- Run Budget and output destination
- Recent Automation Runs
- Link to the originating Conversation

**Run now** is enabled only when the owner scope is active, the Automation is live, the current version is approved, required connections are available, tool authorizations are current, write boundaries are present, and a Run Budget exists.

## Trigger Behavior

Manual and scheduled triggers create the same Automation Run record and start the same Temporal Run Workflow.

Every run records:

- Automation ID
- Automation Version ID
- Trigger source: `manual` or `scheduled`
- Trigger actor for manual runs
- Scheduled fire time for scheduled runs
- Run Start Decision

Overlap and missed-fire policies apply only to scheduled triggers. While an Automation already has an active run, **Run now** is disabled and identifies that run. This is the default manual-trigger concurrency rule; the product does not silently inherit schedule overlap behavior.

## Persistence Changes

Conversation history requires:

- `pinned_at` on Conversations
- Conversation list and detail queries scoped through Workspace membership
- Rename, pin, unpin, and close operations
- Latest-message ordering
- Automation link on a completed Conversation

The Run model retains `kind` only for migration compatibility until separate Agent Runs are removed. New product paths create Automation Runs only. Automation Runs gain an explicit trigger-source field and optional trigger metadata.

Automation schedule data becomes optional in product behavior. Existing `manual_only` versions migrate to Automations with no schedule.

## RPC Surface

Add authenticated operations for:

- List Conversations
- Get Conversation with append-only messages
- Rename Conversation
- Pin or unpin Conversation
- Close Conversation
- Create a new Automation Conversation
- List Automations
- Get Automation detail
- Approve an Automation proposal
- Trigger **Run now**

The existing append-message and Run Brief operations remain the foundation of the interview flow but move from a manual-run mode to an Automation-only flow.

## Safety And Visibility

- Approval is required before **Run now** becomes available.
- Model-generated Automation Proposals remain inert until explicitly accepted.
- Manual triggering never bypasses activation or start preflight.
- Changed tool schemas or annotations make authorization stale.
- User-facing run history remains redacted and append-only.
- Owner/admin audit logs remain separate from Conversation and Run History.
- Conversation messages never expose model chain-of-thought, raw credentials, or raw sensitive artifacts.

## Migration Sequence

1. Add Conversation history fields, trigger-source fields, and compatibility migrations.
2. Add repository and RPC operations for Conversation history.
3. Add the Conversation route and sidebar history.
4. Add Automation library and detail operations.
5. Change approval to create an Automation Version.
6. Route **Run now** and schedules through the shared Automation Run start path.
7. Remove the user-facing manual Agent Run path after existing data remains readable.

## Acceptance Criteria

- A user can create a Conversation from **New automation**.
- Pinned and recent Conversations survive reload and remain owner-scoped.
- A Conversation cannot produce an Automation until all required Run Brief fields and permissions are explicit.
- Approval creates an immutable Automation Version.
- The same approved Automation can run through **Run now** and an optional schedule.
- Manual and scheduled runs use the same preflight and Temporal workflow.
- Runs appear under their Automation and never as sidebar Conversations.
- Stale authorization, unavailable required connections, or missing write boundaries block both trigger sources.
- Existing manual-run records remain readable during migration.

## Out Of Scope

- Collaborative folders or project grouping in the sidebar
- Full-text Conversation search
- Deleting Conversation history
- Branching or forking Conversations
- Different execution engines for manual and scheduled triggers
