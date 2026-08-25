# Conversation Archive and Delete Design

Date: 2026-08-22
Status: Chat-approved; awaiting written-spec review

## Summary

Conversations will support two distinct lifecycle actions:

- **Archive** is reversible. It removes a Conversation from active history, blocks new messages, and preserves all content and relationships.
- **Delete** is permanent. It removes the Conversation and its Conversation-owned content only after an explicit confirmation and only when no Automation is linked.

Durable Automation and Run records remain separate product objects. A Conversation linked to an Automation cannot be deleted. Historical Runs associated with an otherwise deletable Conversation remain durable and are detached before Conversation deletion.

## Goals

1. Let users archive Conversations from the sidebar menu.
2. Let users restore archived Conversations from Settings.
3. Let users permanently delete eligible Conversations after confirmation.
4. Prevent deletion from corrupting a linked Automation, frozen Run Brief, permission snapshot, or durable Run history.
5. Keep archive/delete owner-scoped, idempotent, and auditable.
6. Redirect safely when the currently open Conversation is archived or deleted.

## Non-goals

- Cascading deletion into an Automation or its versions.
- Deleting durable Runs, Run Steps, audit history, or retained Run Artifacts.
- Bulk archive/delete in the first version.
- Automatic retention-based deletion of archived Conversations.
- Undoing permanent deletion.

## Considered Approaches

### Reversible archive plus guarded delete — selected

Add first-class archive state, hide archived Conversations from active history, provide restore management, and allow permanent deletion only through a confirmation boundary and backend preflight.

This meets both requested behaviors without weakening durable Automation and Run guarantees.

### Archive only — rejected

This is safer but does not provide permanent deletion.

### Cascade through linked Automations — rejected

This could silently destroy approved versions, frozen permissions, schedules, and Run provenance. Conversation deletion must never authorize Automation deletion.

## Domain Model

Add `archived_at timestamp with time zone nullable` to `conversations`.

Conversation lifecycle is derived as:

- `archivedAt === null`: active Conversation;
- `archivedAt !== null`: archived Conversation.

The existing Conversation workflow state remains responsible for drafting/configuration lifecycle and is not overloaded with archive state.

Archive and restore update `updated_at`. Archive also clears `pinned_at`; restore returns the Conversation as unpinned.

`ConversationSummary` adds:

```ts
archivedAt: string | null;
```

## Archive Behavior

Archiving is an idempotent owner-scoped mutation:

1. Verify the user belongs to the Conversation's Workspace.
2. Reject or cancel any active transient model turn before archive completes.
3. Set `archived_at = now()`.
4. Set `pinned_at = null`.
5. Update `updated_at`.
6. Return the updated Conversation summary.

Archiving does not alter:

- messages;
- reasoning/activity rows;
- Run Briefs or permission snapshots;
- linked Automation state;
- durable Runs or Artifacts.

Active history queries exclude archived Conversations. Archived history uses a separate owner-scoped query ordered by `archived_at DESC`.

## Archived Conversation Access

Archived Conversations remain readable by direct URL and through Settings, but they are read-only:

- show an **Archived conversation** banner;
- disable the composer and Conversation mode selector;
- provide a Restore action;
- reject new WebSocket user-message frames server-side with `conversation_archived`;
- allow navigation, copy actions, activity disclosures, and historical viewing.

Restoring clears `archived_at`, keeps `pinned_at = null`, updates `updated_at`, and returns the Conversation to Chats and tasks.

## Permanent Deletion Preflight

Deletion is owner-scoped and always revalidates current database state.

The mutation is rejected when:

- the Conversation does not exist in the user's Workspace;
- `automation_id` is non-null;
- an active Conversation turn is running or awaiting tool approval;
- the supplied confirmation title does not exactly match the current Conversation title.

The API returns a typed conflict for linked Automations containing the Automation identifier required for an internal navigation link. It never exposes another user's identifiers.

The UI must not rely on its cached eligibility state; the backend preflight is authoritative.

## Permanent Deletion Transaction

For an eligible Conversation, one database transaction:

1. Lock the Conversation row.
2. Recheck owner scope and `automation_id IS NULL`.
3. Set `runs.conversation_id = NULL` for durable Runs referencing the Conversation.
4. Insert a redacted audit event describing the Conversation deletion, actor, owner scope, and timestamp.
5. Delete the Conversation row.

Existing foreign-key cascades remove Conversation-owned records:

- Conversation messages;
- Conversation activities;
- interactive Agent turns;
- Run Briefs and Run Brief Versions;
- Tool Authorization Snapshots associated through the Run Brief;
- pending Conversation-scoped MCP tool-call references according to existing foreign-key behavior.

The transaction does not delete:

- Automations or Automation Versions;
- Runs, Run Steps, or their final Artifacts;
- audit records;
- independently owned MCP Connections or Tools.

Artifacts created exclusively for transient Conversation tool arguments/results follow their existing retention and reference policies rather than an ad hoc deletion rule.

## RPC Contracts

Add authenticated RPCs:

```ts
ConversationArchiveUpdate({ conversationId, archived: boolean })
  -> ConversationSummary

ArchivedConversationsList()
  -> ConversationSummary[]

ConversationDelete({ conversationId, confirmationTitle })
  -> void
```

`ConversationsList` continues to return active Conversations only.

Typed delete conflicts include:

- `conversation_linked_automation`;
- `conversation_turn_active`;
- `confirmation_mismatch`.

## Sidebar UI

Each active Conversation overflow menu contains:

1. Rename
2. Pin or Unpin
3. Archive
4. Delete

Archive uses a neutral archive icon. Delete is visually destructive and separated from non-destructive actions.

Archive executes immediately after selection. If the archived Conversation is the current route, navigate to `/conversations/new` after the server confirms success.

Delete opens the confirmation dialog; it never executes directly from the menu.

The sidebar refreshes from authoritative history after every mutation. Failed mutations keep the item visible and show an accessible error message.

## Delete Confirmation Dialog

The dialog shows:

- Conversation title;
- permanent-deletion warning;
- summary of data removed;
- title confirmation input;
- Cancel and Delete permanently actions.

The destructive action stays disabled until the entered title exactly matches the current title.

If the Conversation is linked to an Automation:

- replace the destructive action with **Open Automation**;
- explain that the Conversation contains the Automation's approved configuration history;
- allow Archive as the safe alternative.

After successful deletion of the current Conversation, navigate to `/conversations/new`.

## Settings: Archived Conversations

Add an **Archived conversations** section to the existing Settings modal.

It contains:

- archived title;
- archived date;
- Restore action;
- Delete action opening the same confirmation dialog;
- empty state when none exist.

Restored Conversations disappear from the archived list and reappear in Chats and tasks after authoritative refresh.

Linked-Automation archived Conversations may be restored or viewed but cannot be permanently deleted.

## Conversation Page

Conversation detail returns `archivedAt`.

When archived:

- render a compact banner above history;
- keep messages, reasoning summaries, tool rows, and copy actions available;
- disable message submission in both the client and WebSocket server;
- expose Restore;
- hide Automation approval/configuration mutation controls until restored.

## Active Turns and Concurrency

Archive/delete must not race with active model or approval work.

- Archive requests abort the in-process active turn before the state update when the API instance owns it.
- If a persisted turn is still `running` or `awaiting_approval`, archive/delete returns `conversation_turn_active` unless the turn can be safely cancelled first.
- WebSocket message handling reloads archive state before accepting each user message.
- A turn started before an archive mutation cannot persist a new assistant message after archive confirmation.
- Delete never proceeds while a turn or pending approval is active.

## Audit and Security

- Every archive, restore, and delete mutation is owner-scoped.
- Archive and restore create redacted audit events.
- Delete creates its audit event before the Conversation row is removed.
- Audit metadata includes public action type and previous archive state, never message content.
- User-facing responses never expose UUIDs except as internal application navigation targets.
- Confirmation input is not logged.
- Delete remains backend-guarded even when the UI disables the action.

## Error Handling

- Not found or outside owner scope: return `NotFound` without existence disclosure.
- Linked Automation: typed conflict with safe UI explanation and Automation navigation.
- Active turn: typed retryable conflict.
- Confirmation mismatch: non-retryable validation error.
- Archive/restore persistence failure: leave current sidebar state until refresh and show an error.
- Delete transaction failure: roll back run detachment, audit insertion, and Conversation deletion together.

## Migration and Compatibility

Add the nullable `archived_at` column and an index supporting active/archived owner history queries.

Existing Conversations migrate as active because `archived_at` defaults to null.

Old clients receive the additional nullable summary field without losing existing behavior. Active history remains the default RPC behavior.

Historical Conversations with linked Automations become automatically ineligible for permanent deletion.

## Testing Strategy

### Contracts

- validates `archivedAt` and the three RPC payloads/results;
- rejects blank delete confirmations;
- preserves active history section behavior.

### Database

- active listing excludes archived rows;
- archived listing returns only archived owner-scoped rows;
- archive clears pinned state;
- restore returns unpinned active state;
- linked-Automation deletion is rejected;
- deletion detaches Runs and cascades Conversation-owned content;
- failed transaction leaves all data unchanged.

### API

- archive/restore/delete require authentication and owner membership;
- active turns block unsafe lifecycle mutations;
- archived Conversations reject WebSocket user messages;
- typed conflicts map to stable UI behavior.

### Website

- sidebar menu exposes Archive and Delete;
- destructive confirmation requires exact title;
- active-route archive/delete redirects to New;
- archived Settings list restores and refreshes history;
- linked Automation shows Open Automation instead of Delete;
- archived Conversation page is readable but non-interactive;
- keyboard focus and screen-reader labels are correct.

### Browser walkthrough

- archive a disposable Conversation and verify sidebar removal;
- open Settings and restore it;
- verify it returns unpinned;
- delete a disposable unlinked Conversation after title confirmation;
- verify direct URL returns not found after deletion;
- verify a linked-Automation Conversation cannot be deleted;
- verify archived direct URL is read-only;
- verify no raw identifiers appear in dialogs or errors.

## Acceptance Criteria

1. Archive removes a Conversation from active sidebar history without deleting content.
2. Archived Conversations are readable, cannot accept new messages, and can be restored.
3. Settings lists archived Conversations with Restore and guarded Delete actions.
4. Restore returns the Conversation to active history as unpinned.
5. Delete always requires exact-title confirmation.
6. Linked-Automation Conversations cannot be permanently deleted.
7. Eligible deletion removes Conversation-owned content in one transaction.
8. Durable Runs remain and no longer reference the deleted Conversation.
9. Archive, restore, and delete are owner-scoped and auditable.
10. Archiving or deleting the current route navigates safely to New.
11. Active turns cannot race archive/delete into partial state.
12. Historical active Conversations continue to behave unchanged.

