# Interactive Agent Mode Design

Date: 2026-08-20
Status: Implemented and locally verified

## Summary

Agents will support three explicit conversation modes:

- **Chat** provides natural conversation and may suggest an Automation when intent is clear. It does not execute MCP tools.
- **Agent** runs a bounded, interactive model-and-tool loop. It can request any connected, enabled, and available MCP tool within the user's owner scope, subject to the centralized policy engine.
- **Automation** creates a reviewable manual or scheduled workflow. It never executes tools during configuration and continues to require a frozen, explicitly approved Run Brief and Tool Authorization snapshots.

Agent mode reuses the existing MCP gateway, encrypted artifact store, audit records, tool-call idempotency, and WebSocket conversation transport. The model may request a tool, but it never grants itself permission and never executes a tool directly.

## Goals

1. Let an interactive Agent select and call MCP tools while it converses with the user.
2. Ask for approval before every Agent tool call by default.
3. Provide a durable global user preference for less frequent approval prompts without weakening hard safety rules.
4. Resume pending approvals after navigation, reconnects, and API restarts.
5. Preserve exact tool arguments between proposal and approval.
6. Make tool selection accurate when multiple MCP servers expose overlapping names or large catalogs.
7. Keep Agent-mode permissions separate from durable Automation permissions.

## Non-goals

- Agent mode will not create or silently activate an Automation.
- Agent preferences will not change approved Run Briefs or scheduled Automation behavior.
- The first version will not execute tool calls in parallel.
- The first version will not provide workspace-admin policy management; preferences belong to the authenticated user.
- The first version will not let the model install, connect, enable, or reconfigure MCP servers.

## Domain Model

### Conversation Mode

`ConversationMode` becomes `"chat" | "agent" | "automation"`.

The selected mode applies to the submitted message. The browser retains the last selected mode as a convenience, but the mode is included in every `user_message` frame so backend behavior never depends on browser-local state.

### Interactive Agent Turn

An Agent message creates one persisted `InteractiveAgentTurn` with these states:

- `running`
- `awaiting_approval`
- `completed`
- `failed`
- `cancelled`
- `interrupted`

Only one active turn may exist per conversation. A turn contains bounded model steps and sequential MCP tool calls. A pending approval belongs to exactly one turn and one immutable tool-call record.

### Approval Preference

Each user has one `InteractiveAgentApprovalPolicy`:

- `always_ask` — default; every requested MCP tool call pauses for approval.
- `tool_policy` — respects each tool's existing `always`, `risky`, or `never` approval mode.
- `auto_approve_eligible` — auto-approves eligible Agent calls, but cannot override a tool configured as `always` or any hard-confirmation rule.

This preference applies only to interactive Agent mode.

## Safety Policy

The effective decision is computed only by the MCP gateway, in this precedence order:

1. Hard denial and hard-confirmation rules.
2. Connection, owner-scope, enabled, availability, schema, and credential checks.
3. Explicit per-tool approval policy.
4. User's interactive Agent approval preference.
5. Turn limits and idempotency/replay checks.

The model and browser cannot override this decision.

### Policy Matrix

| Condition | Result |
| --- | --- |
| Tool is disconnected, disabled, unavailable, outside owner scope, or schema-invalid | Deny |
| Tool approval mode is `always` | Ask, regardless of global preference |
| Global preference is `always_ask` | Ask |
| Global preference is `tool_policy` | Apply existing `always` / `risky` / `never` behavior |
| Global preference is `auto_approve_eligible` and call is eligible | Execute without an approval prompt |
| Call is destructive, security-sensitive, credential-related, financial, permission-changing, or has missing/untrusted risk metadata | Ask regardless of global preference |
| Idempotency key was already completed with the same argument hash | Replay the recorded result |
| Idempotency key exists with different arguments | Deny |

MCP annotations are hints, not authority. Unknown or contradictory annotations move a call toward approval, never toward automatic execution. Tool output is untrusted content and cannot alter permissions, settings, limits, or the available tool set.

## Tool Discovery and Selection

The Agent receives stable server-side aliases instead of raw MCP tool names. An alias maps to one connection and one tool ID, preventing collisions across servers.

For a small catalog, the model receives all eligible tool definitions. For a large catalog, the runtime performs two stages:

1. Select a bounded candidate set from a compact catalog containing stable alias, title, description, connection, and risk hints.
2. Give the model full input schemas only for those candidates.

The runtime may expand the candidate set once when the model reports that no supplied tool fits. It never invents a tool or calls a tool that was not resolved from the current registry.

Tool descriptions should retain positive and negative usage guidance. The model uses structured function calling; free-text tool names are never executed.

## Agent Loop

The API starts an interactive turn and calls the runtime with bounded conversation history and the resolved tool catalog.

For each step:

1. Stream assistant text or receive a structured MCP tool request.
2. Resolve the stable alias to the current MCP tool record.
3. Validate arguments against the current advertised schema.
4. Store exact arguments as a restricted encrypted artifact and store only a redacted preview plus hash on the tool-call row.
5. Ask the centralized policy engine for a decision.
6. If approval is required, persist `awaiting_approval` and emit an inline approval event.
7. Approve or deny by immutable call ID. The browser never resubmits authoritative arguments.
8. Execute approved calls through the MCP gateway.
9. Store the full result as an encrypted artifact and a bounded redacted preview on the call row.
10. Return a bounded, clearly delimited tool result to the model as untrusted data.
11. Continue until the model produces a final answer or a limit is reached.

Initial hard limits per turn:

- 8 model steps
- 5 MCP tool calls
- 90 seconds total wall time, excluding time awaiting user approval
- 64 KB tool arguments
- 32 KB tool result supplied back to the model; the complete encrypted artifact remains available for evidence and audit
- sequential tool execution only

Limits are server-owned and cannot be changed by model output.

## Persistence

### `interactive_agent_preferences`

- `user_id` primary key and foreign key
- `approval_policy`
- `updated_at`

### `conversation_agent_turns`

- `id`
- `conversation_id`
- `user_message_id`
- `assistant_message_id` nullable until completion
- `state`
- `step_count`
- `tool_call_count`
- `failure_code` and redacted `failure_message`
- `started_at`, `completed_at`, `updated_at`

### `mcp_tool_calls` extensions

- add `denied` to the call-status enum
- `conversation_id`
- `agent_turn_id`
- `step_number`
- `arguments_artifact_id`
- `result_artifact_id`
- `denied_at`

Exact arguments and results use the existing AES-256-GCM encrypted artifact store and retention policies. Conversation metadata references tool-call IDs and redacted display summaries only.

## WebSocket Protocol

### Client frames

```ts
type ConversationClientMessage =
  | {
      type: "user_message";
      clientMessageId: string;
      content: string;
      mode: "chat" | "agent" | "automation";
    }
  | {
      type: "tool_call_approve";
      turnId: string;
      callId: string;
    }
  | {
      type: "tool_call_deny";
      turnId: string;
      callId: string;
    };
```

Approval and denial frames contain identifiers only. The server loads the sealed arguments and verifies owner, conversation, turn, current state, and argument hash.

### Server frames

The existing streaming frames remain. Agent mode adds:

- `agent_turn_started`
- `agent_step_started`
- `tool_approval_required`
- `tool_call_started`
- `tool_call_completed`
- `tool_call_denied`
- `agent_turn_snapshot`

`tool_approval_required` includes a redacted argument preview, tool and connection display names, model-stated reason, risk classification, and whether the global setting could have auto-approved it. It never includes credentials or raw restricted values.

On connection, the server emits the current turn snapshot when a turn is active or awaiting approval.

## Recovery and Concurrency

- Duplicate user messages are rejected or replayed using the existing client message ID.
- Duplicate approvals are idempotent. Approval after denial or completion returns a conflict without executing again.
- Navigating away does not discard a pending approval.
- If the socket disconnects during a model stream, partial assistant text is stored as incomplete.
- Completed tool calls remain committed even when the socket disconnects.
- An API restart marks in-flight model work `interrupted`. The user may retry from persisted history without replaying completed tool calls.
- An awaiting approval survives an API restart and resumes from the sealed call record.
- A second active Agent message in the same conversation receives `turn_in_progress`.

Interactive Agent turns remain API-orchestrated because they are short-lived and require token streaming. Durable manual and scheduled Automation runs remain Temporal workflows. Both paths execute MCP calls through the same gateway enforcement boundary.

## User Interface

The composer mode selector contains:

- Chat
- Agent
- Automation

Agent mode uses the same Claude-style transcript. Inline states appear between assistant messages:

- Selecting tools
- Waiting for approval
- Running a tool
- Tool completed or denied

The approval card shows the exact user-understandable action, redacted arguments, connection, risk label, and **Allow once** / **Deny** actions. Approval controls are disabled immediately after one decision.

A new Settings page includes **Agent tool approvals** with:

- Ask every time
- Follow each tool's policy
- Auto-approve eligible Agent tools

The Settings explanation states that destructive, sensitive, unknown-risk, and per-tool `always` calls still require confirmation. Changing the preference affects future calls only and cannot approve a call already waiting.

## Error Handling

Failures use stable codes and plain user-facing messages:

- `tool_not_available`
- `tool_schema_changed`
- `tool_arguments_invalid`
- `approval_required`
- `approval_conflict`
- `tool_execution_failed`
- `agent_step_limit_reached`
- `agent_tool_limit_reached`
- `agent_timeout`
- `agent_interrupted`

Tool failure is returned to the model as an observation when safe, allowing a final explanation or another eligible strategy. Permission denial is also returned as an observation. Within the same turn, the gateway rejects another request for the same tool and argument hash even when the model generates a new idempotency key. Changed arguments create a new request and receive a fresh policy decision.

## Testing Strategy

### Unit tests

- Complete effective-policy matrix, including contradictory/missing annotations
- Stable alias resolution and duplicate-name isolation
- Argument hashing, sealing, schema validation, and mutation rejection
- Step, call, output-size, and timeout limits
- Tool-output prompt-injection boundaries
- WebSocket frame parsing and state reduction

### Integration tests

- One read-only tool with approval
- Approval denial followed by a safe model response
- Auto-approved eligible tool
- Hard-confirmation tool under auto-approve preference
- Multiple sequential tools
- Duplicate approval and reconnect replay
- API restart while awaiting approval
- Tool schema changes between proposal and approval
- Ownership isolation across users and workspaces

### End-to-end browser flow

1. Connect and enable the local smoke MCP server.
2. Select Agent mode and request current watchlist news.
3. Observe the inline approval card.
4. Approve and observe tool execution plus streamed final response.
5. Change Settings to auto-approve eligible tools.
6. Repeat and verify no prompt for the eligible read-only tool.
7. Verify an unsafe fixture still requires approval.
8. Refresh while approval is pending and resume successfully.

## Acceptance Criteria

- Chat cannot execute MCP tools.
- Agent can request every connected, enabled, available, owner-scoped MCP tool.
- Automation configuration cannot execute MCP tools.
- The default Agent policy asks before every tool call.
- User preference changes persist and affect only future interactive Agent calls.
- No preference bypasses hard confirmation, per-tool `always`, schema validation, owner scope, idempotency, limits, or audit logging.
- Approval executes exactly the sealed arguments shown by the server-side hash.
- Tool calls and pending approvals survive navigation and reconnects.
- Completed calls never execute twice after reconnect or retry.
- Tool output cannot grant permission or change settings.
- The transcript displays the complete redacted tool lifecycle without exposing credentials or restricted payloads.
