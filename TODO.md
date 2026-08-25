# TODO

## Full V1: Durable Agents And Automations

### Superseding product decision

- New work follows Conversation → Automation → Automation Run.
- Every Automation supports Run now; an Automation Schedule is optional.
- Manual and scheduled triggers use the same preflight, permissions, budget, Temporal workflow, and run history.
- `Agent Run` and `manual_agent_run` remain only for migration-compatible reads and are not created by new product flows.
- Conversations are free-form model turns. The model may call `propose_automation`, but the result is only a reviewable proposal; user acceptance and Run Brief approval remain deterministic gates.

1. Migrate the backend API from Bun/Elysia to Node.js so the API and Temporal worker share one runtime.
2. Split runtime responsibilities into `apps/api`, `apps/worker`, `packages/contracts`, `packages/db`, `packages/mcp-gateway`, and `packages/agent-runtime`.
3. Migrate the current `backend/` package away after its API, worker, database, MCP, and Temporal code are moved into the target packages.
4. Use Fastify as the Node HTTP Runtime because HyperExpress/uWebSockets.js does not support the repo's Node 26 runtime.
5. Keep `packages/contracts` as the shared schema/source of truth while making the HTTP transport replaceable and free of Bun-specific adapters.
6. Replace Bun-specific database and Redis clients with Node-compatible clients while keeping Drizzle schemas and migrations.
7. Move Drizzle schema, migrations, clients, and repositories into `packages/db`; API and worker may import it, but it imports no API, worker, or agent runtime code.
8. Move MCP enforcement into `packages/mcp-gateway`; API and agent runtime may import it, but it remains the only tool execution enforcement boundary.
9. Move LangGraph graph code, bridge interfaces, workflow/activity types, budget accounting, checkpoints, and run execution logic into `packages/agent-runtime`.
10. Keep `apps/worker` as the executable Temporal worker entrypoint only.
11. Keep Stytch HTTP/session authentication in `apps/api`; shared owner-scope authorization lives in package-level policy code and workers use durable IDs.
12. Add real `workspaces` and `workspace_memberships`; create a Personal Workspace for each user and use Workspace ownership from v1.
13. Eliminate direct user-owned code paths for MCP Connections and new product objects after migration; use Owner Scope and `created_by_user_id` instead of compatibility ownership.
14. Define the Automation, Automation Run, Conversation, Agent, Approval Request, Artifact, Audit Log, Owner Scope, and shared Run data model.
15. Add a manual run flow where a user selects connected MCP tools and gives the Agent a goal.
16. Build the internal TypeScript LangGraph Temporal Bridge for v1, mapping model calls, MCP tool calls, artifact writes, and checkpoint persistence onto Temporal Activities.
17. Persist Conversations and draft Run Briefs in Postgres before starting execution.
17a. Expose Conversation create/append, Run Brief draft save/approval, and Manual Agent Run start through authenticated RPC.
18. Use one Temporal Run Workflow per Agent Run or Automation Run.
19. Standardize Bridge Step Results with status, Run Step ID, Artifact IDs, Agent Checkpoint ID, Run Budget usage delta, and failure details.
20. Execute every LLM/model call as a Model Activity.
21. Persist Run Steps through dedicated persistence Activities; Workflows do not touch the database directly.
22. Route all tool calls through the MCP Gateway.
23. Persist Agent Runs and Automation Runs through one shared Run execution model with a `kind` discriminator and domain-specific parent links.
24. Keep Run Steps append-only; corrections and status changes are represented by new Run Steps.
25. Keep Conversation Messages append-only once they contribute to a Run Brief; corrections create new messages and supersede the affected Run Brief version.
26. Store Run Briefs as logical `run_briefs` plus immutable `run_brief_versions` containing schema version, structured content, state, Approval Actor, and supersession links.
27. Version Run Briefs immutably; edits create a new draft version and approved versions are never mutated.
28. Store Automations as logical `automations` plus immutable `automation_versions` pointing to approved Run Brief version, schedule config, budget config, Tool Authorization Snapshot, and retention policy.
29. Version Automations immutably; every Automation Run points to the exact Automation Version it used.
30. Derive Temporal Workflow IDs from durable Run IDs, store Temporal Workflow ID and Temporal Run ID on the Run, and make run start idempotent.
31. Default scheduled overlap handling to skipped Automation Runs with a clear reason.
32. Attach tool authorizations to an approved Run Brief version, then copy them into an immutable Tool Authorization Snapshot when an Automation goes live.
33. Bind Tool Authorizations to a specific MCP Connection/account, not only to an MCP server type.
34. Store MCP connection ID, MCP tool ID, server ID, tool name, schema hash, annotation hash, annotations, required or optional flag, approval actor, and approval timestamp for each approved tool so stale authorizations can be detected.
35. Refresh MCP tool catalogs on connection, before Run Brief approval, before Automation activation, and periodically for Live Automations.
36. Mark affected Tool Authorizations stale when MCP tool schemas or annotations change.
37. Move affected Live Automations to needs_reconfiguration when a required MCP Connection is disconnected or revoked.
38. Cancel queued Runs that require a revoked MCP Connection.
39. Fail or complete running Runs partially when required tools become unavailable because of revocation or outage.
40. Block Automation Run Brief approval when required tools cannot be inspected.
41. Keep MCP Credential Secrets encrypted; users and Agents see only connection status and scoped metadata after connection.
42. Use workspace-ready Owner Scope for Automations and related product objects, with individual user as the first owner type.
43. Define Workspace Roles for owner/admin, editor, approver, and viewer permissions.
44. Allow individual-user ownership to map the user to all Workspace Roles.
45. Record the Approval Actor for Run Briefs, Tool Authorizations, Write-Capable Tools, and Automation Versions.
46. Support separate approvers for workspace-owned Automations, while allowing same-person approval for individual users.
47. Restrict Audit Log visibility to workspace owner/admin by default.
48. Define Artifact Retention Policy per Automation or Owner Scope, with shorter retention for raw sensitive Artifacts and longer retention for redacted summaries.
49. Disable Live Automations immediately when their Owner Scope is deleted or disabled; cancel queued Runs, block new Runs, and apply retention/deletion policy.
50. Require Automation Activation Preflight before an Automation can go live: approved Automation Version, approved Run Brief, current tool catalog, non-stale Tool Authorizations, healthy required MCP Connections, explicit Schedule Timezone, Run Budget, Output Destination authorization, and retention policy.
50a. Emit Temporal Schedule intent `automation:${automation_id}` only after Automation Activation Preflight succeeds.
51. Require Run Start Preflight before each scheduled Automation Run: active Owner Scope, live Automation, valid Automation Version, available required connections, non-stale authorizations, allowed schedule firing, and present Run Budget.
51a. Make scheduled Run Start Preflight produce start, skip, queue-one, cancel-old-then-start, or needs-reconfiguration decisions without asking for runtime approvals.
52. Treat the MCP Gateway as the final enforcement point for ownership, frozen Tool Authorization Snapshot lookup, idempotency, schema validation, annotation fingerprint checks, and write boundaries before any MCP tool call executes.
53. Record Denied Tool Calls in the Audit Log and add a redacted Run Step when user-visible behavior is affected.
54. Define Retention Defaults with short retention for raw sensitive Artifacts and longer retention for redacted summaries and Audit Logs.
55. Validate Run Briefs against strict versioned Run Brief Schemas before approval or execution.
56. Keep approved Run Briefs valid under their original schema version; edits create a new version under the current schema.
57. Version Agent instructions and record the exact Agent Instruction Version used by every Run.
58. Record the Model Execution Profile on every Run, including provider, model, model settings, and effective tool policy version.
59. Build Golden Interview Scenarios with expected Run Briefs, required clarifying questions, forbidden assumptions, and approved tool sets.
59a. Keep `pnpm run test:evals` passing as the product-level accuracy acceptance route for interview, approval, activation, schedule, and visibility behavior.
60. Keep Run Steps user-readable and maintain a separate internal Audit Log for credential changes, approvals, revocations, tool executions, schedule changes, and permission changes.
61. Encrypt MCP Credential Secrets with envelope encryption and support key rotation.
62. Create a durable Tool Call Idempotency Key before every MCP tool call and have the MCP Gateway record attempts and results.
63. Allow Live Automations to use Write-Capable Tools only when the approved Automation Version explicitly includes the tool, the user acknowledged it before activation, and the Run Brief defines the Allowed Outcome Boundary.
64. Persist artifact metadata and redacted summaries in Postgres while keeping raw sensitive payloads in encrypted artifact storage referenced by ID.
64a. Use `PostgresEncryptedArtifactStorage` for local v1 raw Artifacts, with `ArtifactStorageAdapter` as the production object-storage swap boundary.
65. Persist run steps, tool calls, approvals, artifacts, and final output.
65b. Start manual Agent Runs from approved Run Brief Versions with Temporal Workflow ID `run:${run_id}` and persist the Temporal Run ID on the Run.
65a. Project persisted `runs`, `run_steps`, `audit_log_events`, and Artifact summaries through the Run History visibility contract before exposing them in API/UI.
66. Produce a Run Brief before execution, including goal, success criteria, required tools, optional tools, authorization summary, expected output, output destination, Evidence Standard, Forbidden Actions, unavailable-tool behavior, and Run Budget.
67. Keep Agent Memory explicit, user-visible, editable, and scoped to an Agent or Automation.
68. Require scheduled Automation Runs to gather Fresh Evidence through approved required tools unless the Run Brief explicitly permits cached data.
69. Separate verified evidence, summary, and Agent interpretation in final outputs where relevant.
70. Block unapproved tool execution at runtime.
71. Require explicit Run Brief approval before execution; high-risk/write-capable tools need per-tool acknowledgement.
72. Keep Temporal payloads small by passing IDs instead of full messages, tool results, or artifacts.
73. Ensure the HTTP API never executes Agent work directly; it only updates product state and starts/signals Temporal Workflows.
74. Use the same core Run Workflow engine for manual Agent Runs and Automation Runs, with Automation Runs forbidden from entering waiting_for_user.
75. Show missing required fields when a valid Run Brief cannot be produced.
76. Show run history and current run state in the UI.
77. Save a Conversation as an Automation proposal, not as a live Automation.
78. Require the user to approve the goal, schedule, required/optional tools, tool annotations, output destination, Run Budget, unavailable-tool behavior, and Automation Version before an Automation goes live.
79. Add Temporal Schedules for recurring Automations with an explicit Schedule Timezone, defaulting new schedules to America/New_York.
80. Default missed scheduled fire times to skipped Automation Runs unless backfill is explicitly enabled for that Automation.
81. Add schedule pause, resume, delete, manual trigger, and overlap behavior.
82. Pause Automations for review when an approved tool's schema or annotations change.
83. Move Automations to needs_reconfiguration after the configured Failure Threshold is reached.
84. Retry unavailable required tools within budget, then fail or produce partial output depending on available evidence.
85. Continue without unavailable optional tools and mark evidence as degraded where relevant.
86. Add notifications for completed_partial, failed, and needs_reconfiguration runs; successful completion notifications depend on Output Destination or Notification Preference.
87. Mark Runs completed_partial when work succeeds but external Output Destination delivery fails; store the output in-app and append a delivery failure Run Step.
88. Implement cancellation by requesting Temporal cancellation, stopping future tool calls, persisting cancelled, and keeping existing Run Steps and Artifacts.
89. Add authorized external Output Destinations such as email, Slack, or connected write tools.
90. Add stricter policies for financial and destructive tools.

## Follow-Up Hardening

91. Add deeper argument-level authorization constraints after the tool-level authorization model is proven.
92. Move local encrypted artifact storage to production object storage if v1 starts with Postgres-backed encrypted artifacts.
93. Add long-term retention and deletion policies for raw artifacts, run history, and checkpoints.
