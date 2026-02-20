# Plan: migrate diarization to gpt-4o-transcribe-diarize (OpenAI Audio API)

## Scope
- This plan applies **only** to `/home/strato-space/voicebot`.
- Any references to `/home/tools/voice` are out of scope and intentionally omitted.

## Product decisions (locked 2026-02-12)
- Приоритет релиза: сначала `plan/edit-event-log-plan.md` (event log + edit/delete/rollback UI), затем diarization.
- В UI показываем человеко-понятные speaker labels по дефолту (см. ниже), но raw-лейблы сохраняются в `transcription_raw`.
- Версии транскрипта хранятся на уровне объекта сессии; session API возвращает финальный effective transcript с примененными правками.

### Full-track policy (temporary)
- `full-track` запись нужна как технический артефакт для будущей диаризации по непрерывной дорожке:
  - удержание непрерывного speaker context между отдельными webm-чанками;
  - восстановление корректных границ говорящих после `Cut/Pause/Rec` и смены микрофонов;
  - offline re-processing исторических сессий новым diarization-моделем без потери исходного аудио-контекста;
  - диагностика спорных кейсов, когда сегментная транскрипция выглядит неконсистентной.
- До включения серверной диаризации `full-track` не отправляем на backend:
  - в WebRTC он отображается в Monitor как локальный контрольный артефакт;
  - upload на backend отключен, чтобы не создавать дубли и лишнюю нагрузку хранения/обработки.

## Target state
Primary diarization via OpenAI **`gpt-4o-transcribe-diarize`** for production speech-to-text (with speaker labels), with a controlled fallback to Whisper when diarized output is unavailable.

Canonical storage contract:
- `transcription_raw` (provider-native immutable payload)
- `-> transcription` (model-agnostic immutable canonical object)

### Engineering principles (Marz-style)
- **Immutable facts first**: raw transcription response is stored once and never mutated.
- **Append-only history**: all user/system changes are recorded as events, not destructive rewrites.
- **Materialized views are disposable**: UI-facing projections can be rebuilt from raw facts + event log.
- **Deterministic processing**: equal input should produce equal projection.
- **Idempotent writes**: pipeline/event handlers must tolerate retries via idempotency keys.
- **Separation of stages**: transcription/diarization output and categorization output are different artifacts.

## API notes (gpt-4o-transcribe-diarize vs whisper-1)
- Endpoint: `POST /v1/audio/transcriptions`
- Model: `gpt-4o-transcribe-diarize`
- `response_format`: **`diarized_json`** (to get speaker labels)
- `prompt`: **not supported** for diarize model.
- `whisper-1` has no server-side diarization and fewer options.

## Current prompt-based speaker handling (voicebot only)
This repo already tries to **infer or normalize speaker labels via LLM prompts** (post‑STT):
- `voicebot/voicebot/prompts/voice_bot_categorization.js`
  - Explicitly asks to **detect speaker changes** and fill `speaker` per segment.
  - Used by `voicebot/voicebot/voice_jobs/categorize.js` (OpenAI `responses.create`).
  - If `message.speaker` exists (e.g., text/voice-mcp with author), categorization overrides to that speaker.
- `voicebot/voicebot/prompts/voice_bot_daily_processing.js`
  - Contains rules to **normalize speaker names/roles** across segments.
  - Currently **not referenced by any job** in `voicebot/voicebot/voice_jobs/` (only defined in `prompts/manifest.js`).

### Why this matters for diarization
- For **voice‑mcp text ingestion** (messages already tagged by author), prompt‑based speaker labeling remains useful.
- For **audio transcription**, diarized ASR should supply speakers **before** categorization to avoid guessing from text.

## Current data model (MongoDB)
Collections are defined in `constants.js` and used directly (no ODM schema).
- Sessions: `automation_voice_bot_sessions`
- Messages: `automation_voice_bot_messages`

### Identity contract alignment (cross-spec consistency)
This diarization plan is aligned with `plan/edit-event-log-plan.md`:
- Top-level docs keep only native Mongo `_id: ObjectId` as stored identity.
- External `oid` is virtual/derived at API boundary from `_id`:
  - session: `se_<hex24>`
  - message: `msg_<hex24>`
- Canonical `transcription.segments[]` items use stable `id` in format `ch_<hex24>`.
- Any index fields are ordering metadata only and must not be used as object identity.

### Session document (automation_voice_bot_sessions)
Created in `voicebot/voicebot/bot_utils.js` and updated across:
`voicebot/voicebot/common_jobs/handle_voice.js`,
`voicebot/voicebot/common_jobs/processing_loop.js`,
`voicebot/voicebot/common_jobs/done_multiprompt.js`.

Common fields (observed in prod + code paths):
- `_id` (ObjectId)
- `chat_id` (number)
- `user_id` (ObjectId|string, web UI sessions)
- `session_name` (string)
- `session_type` (string, e.g. `multiprompt_voice_session`)
- `session_source` (string, e.g. `telegram`)
- `is_active` (bool)
- `is_waiting` (bool; waiting for next voice/text)
- `is_messages_processed` (bool)
- `is_finalized` (bool)
- `is_postprocessing` (bool; post‑processors running)
- `to_finalize` (bool)
- `is_corrupted` (bool)
- `processors` (array of processor names)
- `session_processors` (array of post‑processors, e.g. `CREATE_TASKS`)
- `processors_data` (object keyed by processor name, with state flags)
- `last_message_id` (telegram/web id)
- `last_message_timestamp` (unix seconds)
- `last_voice_timestamp` (ms)
- `created_at`, `updated_at`, `finished_at` (Date)

### Message document (automation_voice_bot_messages)
Created in `voicebot/voicebot/common_jobs/handle_voice.js` and
`voicebot/voicebot/common_jobs/handle_text.js`, updated in
`voicebot/voicebot/voice_jobs/transcribe.js` and `voicebot/voicebot/voice_jobs/categorize.js`.

Common fields (observed in prod + code paths):
- `_id` (ObjectId)
- `session_id` (ObjectId)
- `session_type` (string)
- `source_type` (`telegram` | `web` | `api`)
- `message_id` (telegram/web id or UUID)
- `chat_id` (number)
- `message_timestamp` (unix seconds)
- `timestamp` (ms)
- `created_at` (Date|ms)
- `duration` (seconds)
- `file_id` (telegram), `file_unique_id` (telegram or file hash)
- `file_path`, `original_filename`, `uploaded_by` (web)
- `file_metadata` (object, when available)
- `is_transcribed`, `transcribe_timestamp`, `transcribe_attempts`
- `transcription_text` (string)
- `task` (string; top-level transcription task, e.g. `transcribe`)
- `text` (string; top-level transcription text, same content as `transcription_text`)
- `usage` (object; top-level transcription usage)
- `transcription_raw` (object; full immutable provider payload, e.g. OpenAI `diarized_json`)
- `transcription` (object; canonical model-agnostic transcript)
- `transcription_method` (`segmented`, `direct`, `segmented_fallback`, `ready_text`)
- `transcription_completed_at`, `transcription_error`, `error_message`
- `to_transcribe` (bool; requeue flag)
- `categorization` (array of categorized segments)
- `processors_data` (object keyed by processor name, state flags)

### Immutable transcription contract
- Provider-native source fact: `transcription_raw` (full API response object).
- Canonical model-agnostic fact: `transcription` (normalized schema, stable across ASR providers/models).
- `transcription_raw` and `transcription` are write-once per transcription version and must not be mutated by later stages.
- Any UI list representation is derived at read-time from `transcription.segments` and is not a stored source fact.
- `categorization` must not edit `transcription_raw` or overwrite transcription facts in place.
- Transcript edits (if enabled) are separate events/versions handled by the dedicated event-log specification.

### Model-agnostic `transcription` shape (canonical)
```json
{
  "schema_version": 1,
  "provider": "openai",
  "model": "gpt-4o-transcribe-diarize",
  "task": "transcribe",
  "duration_seconds": 42.7,
  "text": "Agent: Thanks for calling OpenAI support.\nCustomer: Hi, I need help with diarization.",
  "segments": [
    {
      "id": "ch_<generated_hex24>",
      "source_segment_id": "seg_001",
      "start": 0.0,
      "end": 5.2,
      "speaker": "agent",
      "text": "Thanks for calling OpenAI support."
    }
  ],
  "usage": {
    "type": "duration",
    "seconds": 43
  }
}
```
Notes:
- `transcription.segments[].id` is stable segment identity (`ch_*`) used by API/UI/event paths.
- `source_segment_id` is provider segment identity (if present); for models without segment IDs set `null`.
- For non-diarized models, keep schema; UI applies `speaker_display = "Спикер 1"` by default (or explicit inferred policy if enabled later).

### The transcription object (Diarized JSON) Sample
For `gpt-4o-transcribe-diarize` with `response_format=diarized_json`, the API returns:
```json
{
  "task": "transcribe",
  "duration": 42.7,
  "text": "Agent: Thanks for calling OpenAI support.\nCustomer: Hi, I need help with diarization.",
  "segments": [
    {
      "type": "transcript.text.segment",
      "id": "seg_001",
      "start": 0.0,
      "end": 5.2,
      "text": "Thanks for calling OpenAI support.",
      "speaker": "agent"
    },
    {
      "type": "transcript.text.segment",
      "id": "seg_002",
      "start": 5.2,
      "end": 12.8,
      "text": "Hi, I need help with diarization.",
      "speaker": "A"
    }
  ],
  "usage": {
    "type": "duration",
    "seconds": 43
  }
}
```

OpenAI spec reference (audio transcriptions, diarized_json fields):
```text
https://platform.openai.com/docs/api-reference/audio/transcriptions
```

### Legacy compatibility note
- Existing `transcription_chunks` in old records are treated as legacy compatibility data.
- Target state does not require persisting `transcription_chunks`; canonical contract is only `transcription_raw -> transcription`.
- If needed during migration, legacy arrays are built on read from `transcription.segments`.
- New writes should not persist `transcription_chunks`.
- Backfill scope for migration: all historical messages with transcription data.

### Message-level transcription fields (messages_objectId)
Store the **top-level transcription object attributes** on the message document
(alongside existing fields) for compatibility and easier access:
- `task` (e.g., `transcribe`)
- `duration` (transcription duration from the API; should match the audio duration already stored on the message)
- `text` (full diarized transcription text)
- `usage` (duration usage object)
- `transcription_raw` (full immutable API response; canonical fact)
- `transcription` (full immutable model-agnostic canonical object)

Existing fields like `transcription_text` remain and should stay aligned with `text`.

## UI behavior (Transcription vs Categorization)
- **Transcription tab** should render from canonical `transcription`:
  - primary: `transcription.segments[]` (speaker + text),
  - fallback: `transcription.text` / `transcription_text`.
- **Categorization tab** should use speaker-aware `transcription.segments[]` when present. The existing categorization prompt already attempts diarization; if ASR provides diarization, it can simply reuse it without changes.  
  If needed, pass `transcription.segments[]` (speaker + text) into the prompt input instead of raw text.

### Default speaker label policy (v1)
- Храним в `transcription.segments[].speaker` исходный label от ASR (без потери данных).
- В UI используем детерминированный `speaker_display`:
  - если label уже человеко-понятный (`agent`, `customer`, `doctor`, `patient`) — показываем его;
  - если label технический/краткий (`A`, `B`, `spk_0`, число) — маппим по первому появлению в `Спикер 1`, `Спикер 2`, ...
- Для non-diarized fallback (`whisper-1`) дефолт `speaker_display = "Спикер 1"` (single-speaker assumption), пока не включена явная multi-speaker эвристика.

### Example (prod session)
Session `697b75eabebd2e48576bc6ed` (prod DB):
- `session_type`: `multiprompt_voice_session`
- `is_active`: false
- `is_messages_processed`: true
- `is_finalized`: false
- `processors`: `transcription`, `categorization`, `finalization`
- `session_processors`: `CREATE_TASKS`

The message document includes `transcription_raw`, canonical `transcription`,
`transcription_method`, `categorization`, and `processors_data`.

Pretty‑printed snapshot:
- `plan/session-697b75eabebd2e48576bc6ed.pretty.json`

## Implementation plan (voicebot repo)
0. **Release order gate (required)**
   - Start diarization implementation only after Phase 1 from `plan/edit-event-log-plan.md` is in dev-ready state.
   - Gate criteria: edit/delete/rollback/retry/resend flow operational in API + minimal UI `Log`.

1. **Config toggle**
   - Add env flags in voicebot to control model selection:
     - `OPENAI_TRANSCRIBE_MODEL` (default `whisper-1`)
     - `OPENAI_DIARIZE_MODEL` (default `gpt-4o-transcribe-diarize`)
     - `VOICEBOT_DIARIZE=1` to enable diarized flow (default value)
   - Keep fallback to `whisper-1` on error.

2. **Transcribe pipeline update**
   - File: `voicebot/voicebot/voice_jobs/transcribe.js`
   - Places using Whisper now:
     - segmented path: `openaiClient.audio.transcriptions.create({ model: 'whisper-1' })`
     - direct path: same call in “small file” branch
   - Exact replacement sites:
     - `transcribeSegmentAsync()` (segmented flow)
     - "direct processing for small file" block
   - Update:
     - When `VOICEBOT_DIARIZE=1`, call with:
       - `model: process.env.OPENAI_DIARIZE_MODEL || 'gpt-4o-transcribe-diarize'`
       - `response_format: 'diarized_json'`
     - Persist raw API payload to `transcription_raw` as immutable fact (write-once for version).
     - Normalize provider payload into immutable canonical `transcription` object.
     - Store top-level transcription attributes on the message document:
       - `task`, `text`, `usage`, and align `transcription_text` with `text` from canonical `transcription`.
     - On error or missing diarized fields -> fallback to `whisper-1`.
   - Keep `transcription_method` values explicit:
     - `diarized` (direct path)
     - `segmented_diarized` (segmented path)

3. **Schema & UI compatibility**
   - Confirm UI accepts `speaker` in `transcription.segments` (if not, extend UI to display).
   - Preserve `transcription_text` only as compatibility mirror of `transcription.text`.
   - UI source to check: `app/src/components/voicebot/`.
   - Categorization: pass diarized segments (speaker + text) instead of raw text when available (reduce prompt guessing).
   - On transcript segment edit, retry categorization for the edited `segment_oid` only (chunk-scoped retry contract from event-log spec).
   - Legacy `transcription_chunks` support must be adapter-based and read-only during migration.

4. **Observability**
   - Log diarized segment count and speaker set.
   - Add lightweight metrics (counts per speaker, segment length histograms).
   - Mask any API keys in logs.
   - Add log lines that include `response_format` and model name to simplify support.

5. **Testing**
   - Unit test normalizer for provider payload -> canonical `transcription` (same schema for OpenAI/Whisper/fallback).
   - Integration test on dev with a known sample file:
     - Validate segment count, speaker labels, and deterministic fallback.
   - Edge cases:
     - diarized_json missing `segments` (fallback)
     - empty transcription text
     - long audio segmentation + diarized mapping

6. **Rollout**
   - Allow short read-only maintenance window for full historical backfill.
   - Enable `VOICEBOT_DIARIZE=1` in dev only.
   - Monitor latency/cost and segment structure.
   - Gradual enable in prod with quick fallback to whisper-1.

## Definition of Done
- Unit + integration tests are green.
- Dev smoke is passed with real sample audio: diarized segments, speaker display mapping, fallback behavior.

## Risks & mitigations
- **Higher latency** on diarized model → keep fallback to whisper-1 for long files.
- **Speaker label variance** → map speaker IDs to stable labels in UI.
- **No prompt support** → remove any prompt-based assumptions.

## What changes after diarization (data model + pipeline)
Planned updates once `gpt-4o-transcribe-diarize` is enabled:
- `transcription_raw` (full `diarized_json`) becomes immutable source-of-truth for transcription stage.
- `transcription` (model-agnostic canonical object) becomes primary cross-model contract for downstream processing.
- message-level transcription attributes (`task`, `text`, `usage`) are stored on the message document.
- `transcription_method` values extended with:
  - `diarized` (direct)
  - `segmented_diarized` (segmented flow)
- Categorization input should switch to diarized segments (speaker‑aware)
  when present; prompt‑based speaker inference remains for text‑only inputs.
- After manual transcript edit, categorization retry is chunk-scoped (`segment_oid`) per event-log contract.
- Categorization output is a separate artifact/view and must not mutate transcription facts.
- UI rendering (transcription + categorization lists) should display
  speaker labels if present; otherwise fall back to existing behavior.
