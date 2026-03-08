# Object State and History Contract v1

## Purpose
Define how current state, history, routing boundaries, and output-contract semantics map to MongoDB and TypeDB.

## Current vs History in MongoDB
### Current state collections
These are read by default:
- `automation_projects`
- `automation_tasks`
- `automation_voice_bot_sessions`
- `automation_voice_bot_messages`

### History / event collections
These are queried only when history is explicitly requested:
- `automation_voice_bot_session_log`
- `automation_voice_bot_session_merge_log`
- future object-family revision/event collections
- patch/version collections where applicable

## Object-Family Contract
### Project family
Current:
- `automation_projects`
History:
- project merges / future project revision log
Retention:
- current kept indefinitely
- history retained indefinitely unless replaced by durable compaction policy

### Task family
Current:
- `automation_tasks`
History:
- status/task history fields inside task row now; future normalized task event stream may externalize them
Retention:
- current kept indefinitely
- history compressed, never silently dropped

### Voice session family
Current:
- `automation_voice_bot_sessions`
History:
- `automation_voice_bot_session_log`
- `automation_voice_bot_session_merge_log`
Retention:
- session current kept indefinitely
- logs compressible but not deletable without explicit policy

### Voice message family
Current:
- `automation_voice_bot_messages`
History:
- transcript/categorization changes remain object-bound; externalized event stream can be added later
Retention:
- current rows kept until deletion policy applies
- history/derived audit retained according to session policy

## Retention and Compression Rules
- current state is authoritative and always directly queryable
- history is append-first
- compression may summarize or compact history, but must preserve provenance and explicit access path
- no object history is silently reclassified as generic memory

## Routing Boundary
`project_context_card` contains project-level semantic defaults and inherited configuration.
It does not equal a runtime routing item.

Runtime routing data may include:
- chat/thread destinations
- tool paths
- execution routing defaults
- ephemeral run parameters

These belong to operational routing artifacts, not semantic truth.

## Output Contract Mapping
The runtime product flow should be read as:
- `output_contract` — what kind of output this mode expects
- `promise_content` — what semantic payload the output promises
- `admissibility_gate` — whether output may be emitted under evidence/policy
- `writeback_gate` — whether output may mutate durable object state

### Runtime flow mapping
- voice/task decomposition: `output_contract + promise_content`
- summary generation: `output_contract + promise_content + admissibility_gate`
- object-bound note/conclusion writeback: `writeback_gate + writeback_decision + review_annotation`
- high-stakes context assembly: `object_manifest + context_bundle + access_policy`
