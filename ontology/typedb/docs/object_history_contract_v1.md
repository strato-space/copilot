# Object Current/History Contract v1

## Purpose
Freeze the MongoDB contract for current state and object history.

## Rule
Default reads return current object state only.
History is retrieved only on explicit request.

## Current-state collections
Examples of current-state-first collections:
- `automation_projects`
- `automation_tasks`
- `automation_voice_bot_sessions`
- `automation_voice_bot_messages`

These collections store the latest materialized state of an object.

## History / event collections
Examples of object-bound history/event collections:
- `automation_voice_bot_session_log`
- `automation_voice_bot_session_merge_log`
- patch/revision/event collections introduced per object family as needed

History stores:
- revisions
- lifecycle events
- patches
- notes/conclusions when versioning is required

## High-value object families
### Project family
- current: `automation_projects`
- history: project revisions/events should be stored separately when project-card semantics or operational settings change materially

### Task family
- current: `automation_tasks`
- history: task revisions, status changes, codex review lifecycle, possible-task materialization lineage

### Voice session family
- current: `automation_voice_bot_sessions`
- history: `automation_voice_bot_session_log`, `automation_voice_bot_session_merge_log`

### Voice message family
- current: `automation_voice_bot_messages`
- history: message-level processing events and transcript/categorization corrections where versioning is required

## Retention / compression rules
- current collections are canonical for default reads
- history may be compressed, never silently folded into current state
- raw event streams may be compacted only after derived object history remains reconstructable
- any destructive history compaction requires an explicit operator policy and migration note
