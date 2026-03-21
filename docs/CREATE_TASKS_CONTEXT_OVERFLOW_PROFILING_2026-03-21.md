# Create Tasks Context Overflow Profiling

## Status 🟡In Progress

- Task-surface ticket line: ⚪Open 1  🟡In Progress 1  💤Deferred 0  ⛔Blocked 0  ✅Closed 0
- Plan status: profiling substrate implemented; inner MCP payload growth visible; historical Draft backfill exhausted under the current contract; next wave is offender reduction and exact runtime-window capture.
- Canonical investigation epic: `copilot-6g7r`
- Known follow-up tracks:
  - exact runtime `model_context_window` capture remains unresolved;
  - `voice.crm_tickets(project)` payload reduction is the first mitigation target;
  - `string_above_max_length` must be handled as a separate payload-class failure, not folded into pure context overflow.

## Session Registries Used In This Investigation

### Ambiguous/overflow candidate registries

- [voice-create-tasks-ambiguous-sessions-queue.md](/home/strato-space/copilot/plan/voice-create-tasks-ambiguous-sessions-queue.md)
- [voice-create-tasks-ambiguous-sessions-queue.csv](/home/strato-space/copilot/plan/voice-create-tasks-ambiguous-sessions-queue.csv)
- [ambiguous_batch_1.txt](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_1.txt)
- [ambiguous_batch_2.txt](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_2.txt)
- [ambiguous_batch_3.txt](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_3.txt)
- [ambiguous_batch_4.txt](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_4.txt)

### Batch reports

- [ambiguous_batch_1_report.json](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_1_report.json)
- [ambiguous_batch_2_report.json](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_2_report.json)
- [ambiguous_batch_3_report.json](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_3_report.json)
- [ambiguous_batch_4_report.json](/home/strato-space/copilot/tmp/voice-investigation-artifacts/ambiguous_batch_4_report.json)

### Historical Draft recount / backfill registries

- [recount-draft-sessions-oldest-first.state.json](/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.state.json)
- [recount-draft-sessions-oldest-first.report.jsonl](/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.report.jsonl)
- [recount-draft-sessions-oldest-first.registry.md](/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.registry.md)

**Статус документа**: active investigation; profiling live; mitigation pending
**Дата**: 2026-03-21
**Основание**: live `create_tasks` failures on `gpt-5.3-codex-spark`, `gpt-5.3-codex`, and `gpt-5.4`, profiling logs from `copilot-agent-services-gpt54`, historical Draft recount/backfill registry, and `bd` execution trail under `copilot-6g7r`.

**Scope:** `create_tasks` agent via `copilot-agent-services` / MCP `voice`  
**Goal:** before any prompt/context optimization, measure exactly which MCP calls inflate context and by how much.

## Why This File Exists

`create_tasks` has a recurring failure class:

- `create_tasks_agent_error: ... context_length_exceeded`

The current hypothesis is not "bad model choice" in the abstract, but:

- one specific enrichment bundle inflates the second and later LLM turns too much;
- we need per-tool profiling, not intuition;
- optimization should start only after exact byte/token accounting.

This file is the working notebook for that profiling.

## Canonical Question

For each problematic session we need to answer:

1. Which MCP tools were called, in which order?
2. How many bytes/chars did each tool response return?
3. How many tokens did each LLM turn consume after those tool results were injected?
4. Which concrete tool payload dominates the context?
5. Which minimal reduction removes the overflow without destroying task quality?

## Known Enrichment Sequence

The recurring enrichment path inside `create_tasks` is:

1. `voice.fetch`
2. `voice.session_task_counts`
3. `voice.session_tasks`
4. `voice.crm_tickets(session_id)`
5. `voice.project(project_id)`
6. `voice.crm_tickets(project_id)`

Current suspicion:

- the overflow does **not** happen on the initial `voice.fetch`;
- it happens on the next turn(s) after the enrichment bundle above is injected into the prompt context.

## Known Log Evidence

### Baseline failing pattern on `gpt-5.3-codex` / `gpt-5.3-codex-spark`

For heavy sessions, logs show:

- first turn after `voice.fetch`: about `4.7k` input tokens;
- next enriched turn after the MCP bundle: about `23k` input tokens on 5.3 runs;
- then `context_length_exceeded`.

### Confirmed `gpt-5.4` smoke behavior

`fast-agent` currently has **no first-class catalog entry** for `gpt-5.4`, and `?context=1m` is **not** wired as a special OpenAI/Codex long-context branch in the package.  
But the runtime does accept explicit model spec `codexresponses.gpt-5.4`, and the backend can execute it successfully.

Observed successful `gpt-5.4` turn sizes in logs:

- one successful session path reached `Input tokens: 312794`
- another successful session path reached `Input tokens: 320029`

This means `gpt-5.4` is worth testing experimentally, but it does **not** remove the need for exact MCP payload profiling.

### Codex upstream mismatch: static metadata vs runtime window

Codex upstream already shows that static model metadata is **not** enough to infer true runtime headroom.

Observed references:

- Codex model catalog in `openai/codex` lists `gpt-5.4` with static `context_window: 272000`
- Codex runtime/UI tests separately show `TurnStarted.model_context_window = 950000`
- the UI then renders `950K window`

Implication:

- exact `model_context_window` for the live run must be treated as a **runtime-fed value**
- if fast-agent does not surface that value, it must currently be treated as unknown/inferred
- a static model-database patch alone does **not** prove actual runtime context capacity

## Session Bucket

These are the sessions currently tracked as context-overflow or near-overflow cases for `create_tasks`.

| Session ID | URL | `gpt-5.3-codex-spark` | `gpt-5.3-codex` | `gpt-5.4` | Notes |
|---|---|---:|---:|---:|---|
| `69bb9e3de492c93c4a8c5fd6` | `https://copilot.stratospace.fun/voice/session/69bb9e3de492c93c4a8c5fd6` | overflow | overflow | ok (`9` tasks) | old batch script marked `no_payload`, direct run confirmed overflow on 5.3 |
| `69bcc6c9b82ad88929c519e7` | `https://copilot.stratospace.fun/voice/session/69bcc6c9b82ad88929c519e7` | overflow | overflow | overflow | strong profiling candidate |
| `6996ae012835b2811da9b9ca` | `https://copilot.stratospace.fun/voice/session/6996ae012835b2811da9b9ca` | overflow | overflow | ok (`14` tasks) | successful `gpt-5.4` path reached `312794` input tokens |
| `69942fc3f4275d74287986db` | `https://copilot.stratospace.fun/voice/session/69942fc3f4275d74287986db` | overflow | overflow | overflow | explicit full-session recheck on dedicated `gpt-5.4` runtime still hit `context_length_exceeded` |
| `69944cf9f4275d7428798716` | `https://copilot.stratospace.fun/voice/session/69944cf9f4275d7428798716` | overflow | overflow | not yet profiled | |
| `699573005d85620dd7ebb434` | `https://copilot.stratospace.fun/voice/session/699573005d85620dd7ebb434` | overflow | overflow | not yet profiled | |
| `69a50eb64b07162c36957e08` | `https://copilot.stratospace.fun/voice/session/69a50eb64b07162c36957e08` | overflow | overflow | not yet profiled | |
| `69a7cb2002566a3e76d2dc11` | `https://copilot.stratospace.fun/voice/session/69a7cb2002566a3e76d2dc11` | overflow | overflow | not yet profiled | |
| `699ec60739cbeaee2a40c8c7` | `https://copilot.stratospace.fun/voice/session/699ec60739cbeaee2a40c8c7` | overflow | overflow | ok (`12` tasks) | successful `gpt-5.4` path reached `320029` input tokens |

### Additional payload-size failure class discovered during oldest-first recount

The background recount surfaced another failure class distinct from `context_length_exceeded`:

- session `68a56dc04260b6250f6cbb66`
- error: `string_above_max_length`
- concrete message: one injected `input[14].output` exceeded `10485760` chars and reached `11282207`

Implication:

- profiling must track not only token growth toward model context limits
- it must also track oversized individual MCP/tool-result blobs that violate request field length limits before the model even gets a fair turn

## Immediate Profiling Requirements

We need to measure each MCP response, not just final LLM token totals.

### Required metrics per MCP tool call

For every tool call inside `create_tasks`, collect:

- `session_id`
- `model`
- `tool_name`
- `tool_args_mode`
- `response_bytes`
- `response_chars`
- `response_json_bytes`
- `response_text_bytes`
- `estimated_tokens`
- `tool_started_at`
- `tool_finished_at`
- `duration_ms`
- `llm_turn_index_after_injection`
- `llm_input_tokens_after_injection`
- `llm_output_tokens_after_injection`

### Required cumulative metrics

For each session run:

- total MCP payload bytes across the whole run
- total MCP payload bytes up to first overflow
- cumulative token estimate before each LLM turn
- largest single MCP response
- largest cumulative pair/triple of MCP responses

## Instrumentation Points

Profiling should be added at these boundaries.

### 1. Backend outer-run correlation

File:

- [createTasksAgent.ts](/home/strato-space/copilot/backend/src/services/voicebot/createTasksAgent.ts)

Needed:

- generate `profile_run_id` for each `runCreateTasksAgent(...)`
- log:
  - `profile_run_id`
  - `session_id`
  - `mcp_server`
  - `mode`
  - `envelope_chars`
  - `envelope_bytes`
  - `reduced_context_chars`
  - `started_at`
  - `finished_at`

Purpose:

- this is the outer correlation layer for one full `create_tasks` run
- it gives a stable bridge between backend logs and fast-agent logs

### 2. Backend MCP boundary

File:

- [proxyClient.ts](/home/strato-space/copilot/backend/src/services/mcp/proxyClient.ts)

Needed:

- log raw serialized `result` size from `client.callTool(...)`
- log per-tool `JSON.stringify(result).length`
- optionally log compressed and uncompressed byte counts if response bodies are captured lower in the stack

Important boundary:

- this only measures the **outer** MCP call `backend -> local fast-agent create_tasks`
- it does **not** tell us how much each inner `voice.*` tool returned inside the agent
- so this layer is useful but insufficient on its own

### 3. Canonical per-tool inner MCP profiling

File:

- [mcp_aggregator.py](/home/strato-space/copilot/agents/.venv/lib/python3.13/site-packages/fast_agent/mcp/mcp_aggregator.py)

Exact boundary:

- right after `result = await self._execute_on_server(...)`
- before the existing `Tool call completed` log

Needed:

- log structured fields:
  - `tool_name`
  - `server_name`
  - `tool_use_id`
  - `tool_call_id`
  - `tool_result_json_chars`
  - `tool_result_json_bytes`
  - `tool_content_text_chars`
  - `tool_content_text_bytes`
  - `tool_content_block_count`
  - `tool_result_token_estimate`
  - `tool_is_error`
  - `duration_ms`

Purpose:

- this is the canonical truth for “which inner MCP call blew up the context”
- without this, profiling remains guesswork based on timestamps

### 4. `create_tasks` orchestration boundary

File:

- [createTasksAgent.ts](/home/strato-space/copilot/backend/src/services/voicebot/createTasksAgent.ts)

Needed:

- log envelope size sent to MCP
- log parsed result size after each tool-influenced stage if available
- log reduced-context fallback payload size
- correlate session/model/tool-sequence to backend-side run id

### 5. Fast-agent / model boundary

Primary log:

- `/home/strato-space/copilot/agents/logs/fastagent-execution.jsonl`

Known useful events:

- `Model started streaming tool call`
- `Model finished streaming tool call`
- `Streaming complete - Model: ... Input tokens: ... Output tokens: ...`
- `Tool call completed`
- `Streaming APIError during Responses completion`

Needed addition:

- per-tool payload size before tool result is appended back into model context

### 6. Structured LLM turn token landmarks

Files:

- [responses.py](/home/strato-space/copilot/agents/.venv/lib/python3.13/site-packages/fast_agent/llm/provider/openai/responses.py)
- [responses_streaming.py](/home/strato-space/copilot/agents/.venv/lib/python3.13/site-packages/fast_agent/llm/provider/openai/responses_streaming.py)
- [streaming_utils.py](/home/strato-space/copilot/agents/.venv/lib/python3.13/site-packages/fast_agent/llm/provider/openai/streaming_utils.py)

Needed:

- in addition to the human-readable string log, emit structured fields:
  - `agent_name`
  - `model`
  - `chat_turn`
  - `input_tokens`
  - `output_tokens`
  - `turn_finished_at`

Purpose:

- allows stable machine correlation `tool payload growth -> next LLM turn token totals`

### 7. `model_context_window` diagnostics

Current conclusion:

- for this path, `model_context_window` is **not directly observable today** inside fast-agent
- Codex upstream has it as a runtime event field
- current fast-agent/OpenAI Responses path does not surface an equivalent event

Practical rule:

- until an exact provider event is captured, log:
  - `configured_context_window`
  - `observed_model_context_window = null`
- do **not** claim exact runtime `model_context_window` as a known fact unless it is actually captured from a raw event/path

## Session Worksheet Template

Use this block for each session once instrumentation is in place.

```md
### Session: <session_id>

URL: <canonical voice session URL>
Model: <model>
Outcome: ok | overflow | timeout | other

| Step | Tool | Response bytes | Response chars | Estimated tokens | Duration ms | Cumulative input before next turn | Notes |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | voice.fetch |  |  |  |  |  |  |
| 2 | voice.session_task_counts |  |  |  |  |  |  |
| 3 | voice.session_tasks |  |  |  |  |  |  |
| 4 | voice.crm_tickets(session) |  |  |  |  |  |  |
| 5 | voice.project |  |  |  |  |  |  |
| 6 | voice.crm_tickets(project) |  |  |  |  |  |  |

Turn token landmarks:

- Turn 1 input tokens:
- Turn 2 input tokens:
- Turn 3 input tokens:

Largest contributors:

- 1.
- 2.
- 3.

Candidate reductions:

- 
- 
- 
```

## Current Working Conclusions

Established:

- `gpt-5.3-codex-spark` is not sufficient for this overflow bucket.
- `gpt-5.3-codex` also overflows on the same bucket.
- `gpt-5.4` is accepted by the current runtime and can successfully complete at least some of these sessions.
- `gpt-5.4` is **not** a universal fix; at least one tracked session still overflowed on it.
- one additional failure class now exists in the same family of problems: oversized single tool-result blobs (`string_above_max_length`), not only cumulative context overflow.
- exact runtime `model_context_window` is currently not surfaced by fast-agent for this path; without instrumentation it remains inferred rather than observed.
- current mitigation priority is now explicit: move `voice.crm_tickets(project)` from unbounded project-wide enrichment to a bounded session-centered time window whenever session timing can be resolved.

Not yet established:

- exact byte/token contribution of each MCP tool response;
- whether `voice.project` or `voice.crm_tickets(project)` is the dominant offender in all cases or only in some;
- whether the primary offender in some sessions is cumulative growth or one single oversized tool blob;
- whether a stable reduced-context profile can preserve output quality while cutting the overflow set down to zero.

## Historical Draft Digitization / Backfill Summary

This same investigation also accumulated historical recount results for voice-linked `DRAFT_10` tasks.

### Initial queue

- first non-zero historical queue: `287` sessions
- first session in that queue: `689d3c45b6506f6e8cd10836`
- last session in that initial queue: `69bd1f3832f810ec615bc11a`

### Final historical tail

- final non-zero tail queue before exhaustion: `1` session
- tail session: `69be9224a123bbddf9dbb280`

### Aggregate recount outcomes

- unique session results recorded: `289`
- status breakdown:
  - `ok`: `141`
  - `error`: `142`
  - `timed_out`: `6`

### Aggregate task materialization totals

- generated total: `1053`
- persisted total: `1060`
- visible draft count before recount over successful runs: `939`
- visible draft count after recount over successful runs: `1040`
- net visible draft delta: `+101`

### Latest successful sessions

- `69bce3dcb82ad88929c51a0d` -> `3`
- `69bcffcc32f810ec615bc0fd` -> `12`
- `69bd1f3832f810ec615bc11a` -> `7`
- `69be49ea4ad7c397307d2d6f` -> `3`
- `69be9224a123bbddf9dbb280` (`Стратегия автономной оркестрации задач`) -> `12`

### Latest failures

- `69b8ee938a877bdbe0263879` -> `string_above_max_length`
- `69ba998acac66986aaff683d` -> `timeout_after_180000ms`
- `69bb7519e492c93c4a8c5f93` -> `context_length_exceeded`
- `69bbc59ae492c93c4a8c5ff7` -> `timeout_after_180000ms`
- `69bcc6c9b82ad88929c519e7` -> `context_length_exceeded`

### Operational note

- historical backfill continuation eventually reached an empty queue and was stopped intentionally to avoid PM2 restart loops;
- the current historical queue is therefore considered exhausted under the active contract;
- the canonical raw registry remains:
  - `/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.state.json`
  - `/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.report.jsonl`
  - `/home/strato-space/copilot/backend/logs/recount-draft-sessions-oldest-first.registry.md`

## Stop Rule

Do **not** optimize prompt structure, remove tool calls, or rewrite enrichment logic until per-tool profiling exists for this bucket.

Optimization without profiling here is guesswork.
