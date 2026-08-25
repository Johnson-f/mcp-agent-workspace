# Agents

Agents is a workspace for connecting user-owned MCP servers to controlled AI workers that can run interactive conversations and confirmed automations.

## Language

**Automation**:
A user-confirmed repeatable instruction that can be run manually or on a schedule.
_Avoid_: Workflow, task, job

**Owner Scope**:
The user or workspace that owns an Agent, Conversation, Run Brief, Automation, Run, MCP Connection, Artifact, or Agent Memory.
_Avoid_: User-only ownership

**Workspace**:
A collaborative or personal container that owns Agents, Conversations, Run Briefs, Automations, Runs, MCP Connections, Artifacts, and Agent Memory through Owner Scope.
_Avoid_: Organization, team account

**Personal Workspace**:
The default Workspace created for an individual user so all ownership follows the same workspace-ready model.
_Avoid_: Direct user ownership

**Workspace Role**:
The permission set that controls what a workspace member may do with Automations, credentials, approvals, runs, outputs, and audit records.
_Avoid_: Implicit team access

**Disabled Owner Scope**:
An Owner Scope that can no longer start or continue Live Automations. Its queued Runs are cancelled, new Runs are blocked, and retention policy applies to its credentials, artifacts, memory, and logs.
_Avoid_: Deleted user cleanup

**Live Automation**:
An Automation that has been confirmed by the user and is eligible to run manually or on its schedule using only its pre-authorized tools.
_Avoid_: Active workflow

**Automation Version**:
An immutable approved configuration of an Automation, including its Run Brief, Automation Schedule, Run Budget, required and optional tools, and Tool Authorization Snapshot.
_Avoid_: Edited automation

**Automation Activation Preflight**:
The atomic validation required before an Automation Version can become live.
_Avoid_: Best-effort activation

**Activation Preflight Blocker**:
A specific reason an Automation Version cannot go live, such as stale tool authorization, unavailable required connection, missing schedule rule, missing Run Budget, unauthorized Output Destination, or missing retention policy.
_Avoid_: Generic validation error

**Temporal Schedule Intent**:
The durable command emitted only after Automation Activation Preflight succeeds, containing the Temporal Schedule ID, Automation Version, timezone, rule, missed-run policy, and overlap policy.
_Avoid_: Draft schedule

**Automation Run**:
One execution attempt of an Automation Version, including its tool calls, evidence status, result, and failure state. Automation Runs never wait for surprise user approvals.
_Avoid_: Execution, job, session

**Conversation**:
An interactive context-gathering exchange where the user and AI clarify what should be automated before creating an Automation.
_Avoid_: Unscheduled automation, chat run

**Automation Proposal**:
A model-generated, user-visible suggestion that a Conversation should become an Automation. It may suggest a goal, success criteria, schedule, or tools, but grants no permission and creates no live Automation until the user explicitly accepts, completes, and approves the Run Brief.
_Avoid_: Inferred Automation, auto-activation

**Conversation Message**:
An append-only user or AI message in a Conversation. Corrections are new messages, not edits to messages that contributed to a Run Brief.
_Avoid_: Mutable chat row

**Conversation State**:
The clarification lifecycle of a Conversation: drafting, awaiting_user_input, ready_for_run_brief, run_brief_created, or closed.
_Avoid_: Execution state

**Tool Proposal**:
The AI-proposed set of MCP tools needed for a Run Brief, including why each tool is required or optional and what the MCP annotations say it can do.
_Avoid_: Hidden tool selection

**Agent**:
A configured worker with instructions, allowed tools, model settings, memory policy, and execution policies.
_Avoid_: App, LangGraph graph, persona

**Agent Instruction Version**:
The immutable version of an Agent's instructions used for a Run.
_Avoid_: Current prompt

**Agent Memory**:
Explicit user-visible information an Agent may reuse across Conversations and Runs. Agent Memory is editable by the user and scoped to an Agent or Automation.
_Avoid_: Hidden memory, checkpoint

**Legacy Agent Run**:
A historical manually started Run created before all new work was unified under Automations. Legacy Agent Runs remain readable, but new product paths do not create them.
_Avoid_: New manual run, session

**Run**:
The durable execution concept behind an Automation Run. Legacy Agent Runs remain readable through the same execution history, budget, Artifact, and final-output model.
_Avoid_: Job, Temporal run

**Run Workflow**:
The Temporal Workflow that coordinates one Agent Run or Automation Run. Conversations and draft Run Briefs are persisted in the application database before a Run Workflow starts.
_Avoid_: Conversation workflow, draft workflow

**Run Workflow Identity**:
The idempotent Temporal identity derived from a durable Run ID, with the Temporal Workflow ID and Temporal Run ID recorded on the Run.
_Avoid_: Random workflow name

**Run Start Preflight**:
The validation required before one Automation Run starts, including active ownership, live Automation state, valid Automation Version, available required connections, non-stale authorizations, allowed schedule firing, and present Run Budget.
_Avoid_: Blind scheduled start

**Run Start Decision**:
The deterministic result of Run Start Preflight: start a queued Run, create a skipped Run, queue one overlapping Run, cancel the old Run then queue the new one, or move the Automation to needs_reconfiguration.
_Avoid_: Runtime approval prompt

**LangGraph Temporal Bridge**:
The internal TypeScript execution layer that maps LangGraph model, tool, and durable graph steps onto Temporal Activities while preserving product objects such as Run Brief, Run Step, Agent Run, Automation Run, and Artifact.
_Avoid_: Single graph activity, Python bridge

**Bridge Activity**:
A Temporal Activity executed by the LangGraph Temporal Bridge for non-deterministic or side-effecting work such as model calls, MCP tool calls, artifact writes, and checkpoint persistence.
_Avoid_: Tiny state transition

**Graph Advance Activity**:
A Bridge Activity that loads internal Agent Checkpoint state, lets LangGraph advance until the next durable operation boundary, and returns the next model call, tool call, artifact write, checkpoint save, Run Step persist operation, or terminal status.
_Avoid_: Temporal-owned graph routing

**Durable Operation**:
The next side-effecting operation selected by LangGraph and executed through a Temporal Activity: model call, MCP tool call, artifact write, checkpoint save, or Run Step persistence.
_Avoid_: Reducer step, hidden side effect

**Bridge Step Result**:
The standard result returned by a Bridge Activity, including status, Run Step ID, Artifact IDs, Agent Checkpoint ID, Run Budget usage delta, and failure details when applicable.
_Avoid_: Raw activity result

**Model Activity**:
A Bridge Activity that performs one LLM/model call and persists the corresponding Run Step and Agent Checkpoint.
_Avoid_: Workflow model call

**Model Execution Profile**:
The provider, model, model settings, and effective tool policy version recorded for a Run.
_Avoid_: Current model

**Node Backend**:
The Node.js HTTP API and Temporal worker runtime that replaces the Bun/Elysia backend so API code, worker code, LangGraph, and Temporal TypeScript run on one JavaScript runtime.
_Avoid_: Bun backend, split runtime backend

**HTTP Runtime**:
The Node.js HTTP serving layer for the backend API. The production choice is Fastify because it runs cleanly on the repo's Node runtime while preserving the `/rpc` HTTP contract.
_Avoid_: Elysia, Bun-only HTTP servers, Node-version-limited runtimes

**Run Brief**:
The structured summary that must exist before starting an Agent Run or activating an Automation, including the goal, required and optional tools, permission summary, expected output, and Run Budget.
_Avoid_: Prompt, tool proposal, automation draft

**Run Brief Version**:
An immutable version of a Run Brief, including its schema version, structured brief content, approval state, Approval Actor, and supersession relationship.
_Avoid_: Edited brief

**Run Brief Schema**:
The versioned typed schema that a Run Brief must satisfy before it can be approved or executed.
_Avoid_: Free-form brief JSON

**Run Brief State**:
The approval lifecycle of a versioned Run Brief: draft, pending_approval, approved, rejected, or superseded. An approved Run Brief is immutable.
_Avoid_: Mutable brief status

**Run Brief Approval**:
The user's confirmation that a Run Brief is accurate enough to execute. High-risk or write-capable tools require explicit per-tool acknowledgement before the final approval can be submitted.
_Avoid_: Generic confirmation

**Run Brief Draft Save**:
The API operation that persists a validated Run Brief draft as a new immutable Run Brief Version. Saving a draft never counts as approval; final approval is a separate operation.
_Avoid_: Auto-approval

**Run Now**:
The user action that creates a manual-triggered Automation Run from the current approved Automation Version after Run Start Preflight succeeds.
_Avoid_: Manual Agent Run, bypass approval

**Automation Run Trigger Source**:
The recorded origin of an Automation Run: manual from Run Now or scheduled from an Automation Schedule.
_Avoid_: Separate manual run type

**Missing Run Brief Field**:
A required piece of information the Conversation must ask the user for before a Run Brief can be created.
_Avoid_: Silent assumption

**Success Criteria**:
The explicit conditions that define whether an Agent Run or Automation Run satisfied the user's goal.
_Avoid_: Vibes, implicit intent

**Fresh Evidence**:
Current information gathered through approved required tools during a Run. Historical artifacts may provide context, but they are not Fresh Evidence unless the Run Brief explicitly permits cached data.
_Avoid_: Old context, remembered facts

**Forbidden Action**:
An explicit action the Agent must not perform while executing a Run Brief, even if a connected tool could technically do it.
_Avoid_: Assumption, hidden constraint

**Evidence Standard**:
The Run Brief's rule for what information is sufficient to answer, such as time window, source count, freshness, or required data source.
_Avoid_: Best effort

**Output Destination**:
The place where an Agent Run or Automation Run delivers its result. External destinations such as email or Slack are write-capable outputs and require explicit authorization.
_Avoid_: Notification channel

**Notification Preference**:
The user's rule for when an Automation should send a notification. Partial completion, failure, and needs-reconfiguration notify by default, while successful completion notifies only when the Output Destination or Notification Preference asks for it.
_Avoid_: Always notify

**Output Trust Boundary**:
The separation between verified evidence, summary, and Agent interpretation in a Run's final output.
_Avoid_: Blended answer

**Allowed Outcome Boundary**:
The exact permitted result of a write-capable tool inside an approved Run Brief or Automation Version.
_Avoid_: Open-ended write permission

**Run Budget**:
The bounded resource allowance for an Agent Run or Automation Run, including limits for LLM steps, tool calls, active runtime, retries, spend, and output size.
_Avoid_: Run limits, execution policy

**Run Step**:
A user-visible append-only timeline entry describing a meaningful event in an Agent Run or Automation Run, such as a tool call, approval request, tool result summary, or final answer.
_Avoid_: Chain-of-thought, raw graph checkpoint

**Run History**:
The user-facing ordered view of a Run made from visible Run Steps, public metadata, Artifact IDs, redacted Artifact summaries, final output references, and degraded evidence or failure markers.
_Avoid_: Audit log, raw execution trace

**Public Run Step Metadata**:
The allowlisted metadata shown in Run History, such as tool name, redacted arguments, status, duration, evidence status, or denial message. Internal IDs, hashes, storage keys, Temporal IDs, and encryption details are excluded.
_Avoid_: Redacted metadata dump

**Agent Checkpoint**:
Internal LangGraph execution state used to resume or inspect an Agent Run. Product-visible state remains in Conversations, Run Briefs, Runs, Run Steps, Approval Requests, and Artifacts.
_Avoid_: Product state

**Artifact**:
A persisted raw or derived payload from an Agent Run or Automation Run, such as a tool result, source data, or generated output. Product timelines show redacted summaries while raw sensitive payloads live in encrypted artifact storage and are referenced by ID.
_Avoid_: Temporal payload

**Artifact Storage Adapter**:
The interface used to create, read, and delete raw Artifact payloads. Local v1 uses Postgres-backed encrypted blobs, while production object storage can implement the same adapter without changing Run or MCP Gateway contracts.
_Avoid_: Direct blob access

**Artifact Encryption Envelope**:
The AES-256-GCM metadata stored with an Artifact, including key ID, key version, nonce, auth tag, and algorithm so raw payloads can be decrypted through managed key rotation.
_Avoid_: Plain artifact payload

**Raw Artifact Retention**:
The retention window for encrypted raw Artifact payloads. Defaults are shorter for sensitive and restricted payloads than for low-sensitivity payloads.
_Avoid_: Keep source data forever

**Artifact Summary Retention**:
The retention window for redacted Artifact summaries after raw payload deletion. Summaries may outlive raw payloads but are still deleted when their retention window expires.
_Avoid_: Permanent summary

**Artifact Retention Policy**:
The Owner Scope or Automation rule for how long raw Artifacts, redacted summaries, checkpoints, memory, credentials, and logs are retained.
_Avoid_: Permanent storage

**Retention Default**:
The default Artifact Retention Policy used when the owner has not chosen a stricter rule. Raw sensitive Artifacts use shorter defaults than redacted summaries and Audit Logs.
_Avoid_: Store forever

**Agent Run State**:
The lifecycle of a manual Agent Run: queued, running, waiting_for_user, completed, completed_partial, failed, cancelled, or expired.
_Avoid_: Automation run state

**Automation State**:
The lifecycle of an Automation: draft, pending_approval, live, paused, needs_reconfiguration, or archived.
_Avoid_: Workflow status

**Failure Threshold**:
The number of consecutive failed or degraded Automation Runs allowed before a Live Automation moves to needs_reconfiguration.
_Avoid_: Infinite retry

**Automation Schedule**:
The optional approved timing rule for an Automation Version, including recurrence, explicit timezone, missed-run policy, and overlap policy. Every Automation supports Run Now whether or not a schedule exists.
_Avoid_: Cron string

**Schedule Timezone**:
The IANA timezone stored with an Automation Schedule. The default Schedule Timezone is America/New_York, and server timezone is not used as the schedule authority.
_Avoid_: Server timezone

**Missed Run Policy**:
The Automation Schedule rule for what happens when the system misses a scheduled fire time. The default is to skip the missed run and record a skipped Automation Run.
_Avoid_: Silent backfill

**Delivery Failure**:
A failed attempt to send a completed Run output to an Output Destination. Delivery Failure makes the Run completed_partial while preserving the output in-app.
_Avoid_: Run failure

**Automation Run State**:
The lifecycle of one Automation execution: queued, running, completed, completed_partial, failed, cancelled, or skipped. Automation Runs do not wait for surprise user approvals.
_Avoid_: Agent run state

**MCP Gateway**:
The backend-owned final enforcement point that executes MCP tool calls after enforcing user ownership, tool policy, approval requirements, idempotency, schema validation, write boundaries, audit logging, and credential safety.
_Avoid_: Direct tool access

**MCP Gateway Tool Call Decision**:
The structured allow, deny, or replay decision returned by the MCP Gateway before tool execution. It includes redacted Audit Log metadata, user-visible Run Step intent when behavior is affected, Artifact intent, idempotency status, and denial details when blocked.
_Avoid_: Throw-only policy error

**MCP Connection**:
A user's specific connected MCP server account, including its encrypted credentials, connection metadata, and current tool catalog.
_Avoid_: MCP server type

**MCP Credential Secret**:
The encrypted credential material for an MCP Connection. Users and Agents never see raw MCP Credential Secrets after connection.
_Avoid_: Visible token

**Credential Envelope**:
The encrypted wrapper around an MCP Credential Secret, designed for managed key rotation without exposing raw credentials to application logs, Temporal payloads, Run Steps, or Artifacts.
_Avoid_: Plain credential row

**Tool Catalog Refresh**:
The inspection of an MCP Connection's current tools, schemas, and annotations. Tool Catalog Refresh happens on connection, before Run Brief approval, before Automation activation, and periodically for Live Automations.
_Avoid_: Static tool list

**Audit Log**:
An internal append-only security record for approvals, revocations, credential changes, tool executions, schedule changes, permission changes, and other sensitive control-plane events.
_Avoid_: Run Step

**Admin Audit Visibility**:
The owner/admin-only view of Audit Log events. It can include redacted enforcement metadata, targets, actors, and argument hashes, but never raw payloads, plaintext credentials, chain-of-thought, ciphertext, nonce values, or auth tags.
_Avoid_: User timeline

**Denied Tool Call**:
An MCP tool call blocked by policy, authorization, ownership, schema validation, idempotency, or write-boundary enforcement.
_Avoid_: Silent block

**Approval Request**:
A user-visible permission decision required before an Automation goes live or before an Agent Run starts, covering the tools and capabilities the Agent may use for that context.
_Avoid_: Interrupt, confirmation modal

**Approval Actor**:
The user who approved a Run Brief, Tool Authorization, Write-Capable Tool, or Automation Version. Workspaces may require an Approval Actor who is different from the drafting user.
_Avoid_: Anonymous approval

**Tool Authorization**:
The user's permission for an Agent to use specific tools on a specific MCP Connection for a Run Brief, Agent Run, or Automation.
_Avoid_: Server approval, global MCP access

**Tool Authorization Snapshot**:
The immutable approved tool set copied from an approved Run Brief into a Live Automation, including tool references, tool names, required or optional status, MCP tool annotations, and tool fingerprints.
_Avoid_: Live tool lookup, current server permission

**Conversation Product Flow**:
The user-facing path from Conversation creation through append-only messages, Run Brief draft save, Run Brief approval, and manual Agent Run start.
_Avoid_: Hidden prompt execution

**Tool Annotation Fingerprint**:
The hash of an MCP tool's annotations used to detect whether an approved Tool Authorization Snapshot is stale.
_Avoid_: Trust current annotations blindly

**Tool Authorization State**:
The lifecycle of permission for one tool in a context: proposed, approved, rejected, revoked, or stale.
_Avoid_: Enabled flag

**Tool Fingerprint**:
The stored MCP server ID, tool name, schema hash, and annotation hash used to determine whether a prior Tool Authorization has become stale.
_Avoid_: Capability label

**Tool Call Idempotency Key**:
A durable identifier created before an MCP tool call so retries can return the existing recorded result instead of repeating the tool side effect.
_Avoid_: Retry token

**Write-Capable Tool**:
An MCP tool whose annotations do not declare it read-only. Live Automations may use Write-Capable Tools only when the approved Automation Version explicitly includes them and the user acknowledged their Allowed Outcome Boundary.
_Avoid_: Safe tool

**Required Tool**:
A pre-authorized MCP tool that an Agent Run or Automation Run must be able to use to satisfy its Run Brief.
_Avoid_: Dependency

**Optional Tool**:
A pre-authorized MCP tool that can improve an Agent Run or Automation Run but is not required to produce an acceptable result.
_Avoid_: Nice-to-have dependency

**MCP Tool Annotation**:
The MCP-provided metadata describing a tool's declared behavior, such as whether it is read-only, destructive, idempotent, or open-world.
_Avoid_: Product capability label

**Tool Proposal**:
An Agent-generated request to use specific MCP tools for a Conversation, Automation, or Automation Run, including an explanation of the tools and their MCP annotations.
_Avoid_: Auto-selection

**Golden Interview Scenario**:
A test case for the Conversation interview, including expected clarifying questions, forbidden assumptions, expected Run Brief, and approved tool set.
_Avoid_: Prompt snapshot

**Eval Route**:
The v1 acceptance path that proves accuracy with Golden Interview Scenarios plus package-level tests for Run Brief validation, forbidden assumptions, tool approvals, MCP Gateway denial/idempotency, Automation activation/schedule behavior, Bridge failure mapping, Artifact retention, and Run History visibility.
_Avoid_: Ad hoc prompt testing

**Forbidden Assumption Check**:
An eval assertion that an underspecified user request produces a missing required field instead of letting the AI silently fill in schedule, tool choice, output destination, success criteria, or permissions.
_Avoid_: Best-effort default
