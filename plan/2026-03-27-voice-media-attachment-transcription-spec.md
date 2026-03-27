# Voice Media-Bearing Attachment Transcription Spec

## Status

- Created: 2026-03-27
- Status: draft for discussion
- Role: feature spec for transcribable attachment media in Voice sessions
- Canonical driver case: Telegram-delivered Telemost recording `.webm` attached into an active Voice session as `message_type=document`

## Inputs

- `ontology/plan/voice-dual-stream-ontology.md`
- `ontology/plan/voice-ontology-persistence-alignment-spec.md`
- `plan/session-managment.md`
- `plan/gpt-4o-transcribe-diarize-plan.md`
- forensic case: session `69c60caf4926f6f263d066d6`

## Purpose

This document specifies how Voice must treat media-bearing attachments that arrive through attachment/document ingress, especially Telegram `document` payloads such as Yandex Telemost `.webm` recordings.

The purpose is not to redefine all attachment handling. The purpose is to remove one specific category mistake:

- transport envelope kind (`voice`, `document`, `photo`) must not be used as the sole proxy for transcription eligibility.

Concrete counterexample:

- a Telemost `.webm` recording may arrive from Telegram as `message_type=document`;
- the envelope says `document`;
- the payload is in fact audio-bearing media;
- therefore the message may be transcription-eligible even though the transport envelope is not `voice`, provided policy and runtime support allow it.

Current AS-IS behavior intentionally treats such messages as attachment-only. This spec defines the target feature track that extends the pipeline to speech-bearing attachment media without collapsing ontology layers.

## Term Normalization

- `transport envelope` — ingress-side carrier kind such as Telegram `voice`, `document`, `photo`, or web upload route. It answers “how did the file arrive?”.
- `payload media` — the stored file payload itself: audio, video, image, binary document, or mixed media. It answers “what kind of file is this?”.
- `speech-bearing media` — payload media whose sound content in fact contains human speech audio rather than arbitrary non-speech audio.
- `speech-bearing assessment` — the runtime's current epistemic judgment about whether a payload is speech-bearing: `speech | non_speech | unresolved`.
- `transcribable media` — speech-bearing media for which transcription is allowed by current policy and runtime support.
- `audio-bearing video` — a video container whose payload includes an audio track that can be extracted or prepared for ASR, without implying that the track contains speech.
- `caption/source note` — human-authored sidecar text attached to the message by the sender. It is not identical to a transcript.
- `transcript fact` — the speech-to-text output produced from media payload and persisted in the implementation's canonical transcript-bearing fields, such as raw provider output plus normalized transcript text.
- `transport recovery anchors` — ingress-preserved identifiers needed to reacquire the original payload from upstream transport.
- `runtime staging artifact` — execution-local working file such as extracted audio or downloaded payload path. It is not a transport fact.
- `attachment-only message` — a message that carries a file but is not transcription-eligible under the current feature boundary.
- `speech-bearing classifier` — the runtime mechanism that produces a `speech-bearing assessment` from currently available evidence.
- `transcription job key` — the canonical dedupe identity for ASR work on one attachment payload, derived from message identity plus attachment identity plus a stable payload/transport fingerprint.

Normalization rule:

- Telegram `document` is a transport envelope term, not a semantic claim that the payload is a product-side `document artifact`, and not a claim that ASR is inapplicable.

## Ontological Diagnosis

### Current failure

The current AS-IS handling commits a categorical collapse:

- `transport envelope kind` is treated as if it were identical to `payload media kind`;
- `caption text` is treated as if it were identical to `transcript fact`;
- `attachment metadata` is treated as sufficient archival evidence even when the payload is actually execution-relevant speech media.

This is a categorical failure, not just an implementation gap.

### Minimal repair

The minimal sound repair is:

1. keep `message_type` as the transport-envelope fact;
2. classify payload media independently;
3. decide `transcription_eligibility` as a relation over payload class, speech-bearing status, policy, and runtime support, not from envelope kind alone;
4. keep sender caption as sidecar note, not as substitute transcript.

No second message family is needed. The repair lives at the `voice_message` attribute/worker-contract layer.

## Scope

In scope:

- Telegram attachment ingress for `document`-delivered media files;
- transcribe-worker parity for media-bearing attachments;
- retry semantics for attachment-origin messages;
- persistence/read-model contract needed so attachment-origin media can be transcribed deterministically;
- Telemost `.webm` as the reference case.
- voice-origin media only insofar as its eligibility path must obey the same payload-first ontology and must not preserve an envelope-only exception.

Also in scope by parity:

- any attachment-origin audio/video payload that is transcription-eligible by the same capability rules.

Out of scope:

- OCR or text extraction for PDF / DOCX / spreadsheets;
- generic “understand the full video visually” workflows;
- semantic analysis of image-only attachments;
- redesign of diarization model choice;
- introduction of new Mongo collections or new first-class ontology entities;
- global migration of all historical attachments in the first wave.

## AS-IS Boundary

Current behavior is coherent as a feature boundary, but narrow:

- session routing accepts `document` into the active session;
- attachment ingress stores attachment metadata;
- if attachment ingress has no text/caption, it writes an empty `legacy_attachment` transcription placeholder;
- it does not enqueue transcription for that attachment-origin media;
- transcribe-worker Telegram transport recovery expects top-level `message.file_id` / `message.file_path`, while attachment ingress currently stores critical Telegram file identifiers inside `attachments[]`.

Observed effect in session `69c60caf4926f6f263d066d6`:

- a Telemost `.webm` file arrived successfully;
- the session contains the message and attachment metadata;
- no transcribe job was observed;
- `transcription_text` remained empty;
- there is no evidence of ASR failure, only absence of ASR invocation.

## Target Contract

### 1. Envelope and payload remain separate

For every message with file attachments, the system must preserve two different facts:

- `message_type` = transport envelope fact;
- payload media classification = capability fact.

The system must not infer “non-transcribable” from `message_type=document` alone.

### 2. Message-level payload classification

For attachment-origin media messages, the backend must derive and persist message-level classification sufficient for deterministic retry and UI rendering.

For single-attachment messages, the message-level classification describes the only attachment.

For multi-attachment messages, the message-level classification describes the chosen primary transcription attachment, not the attachment set as a whole.

Required message-level fields or their exact semantic equivalent:

- `primary_payload_media_kind`: `audio | video | image | binary_document | unknown`
- `primary_transcription_attachment_index`: `integer | null`; the attachment index from which message-level projection is derived; use `0` for single-attachment messages once the primary attachment projection has been resolved, and `null` only while the message remains pending and no primary attachment projection has yet been resolved
- `transcription_eligibility`: `eligible | ineligible | null`
- `classification_resolution_state`: `resolved | pending`
- `transcription_processing_state`: `pending_classification | pending_transcription | transcribed | classified_skip | transcription_error`, or an exact deterministic read-model equivalent
- `is_transcribed`: authoritative success flag; `true` iff transcript fact has been persisted successfully, otherwise `false`
- `transcription_skip_reason`: nullable code when the message does not proceed to ASR
- `transcription_eligibility_basis`: compact explanation of why the message is eligible, ineligible, or pending
- `classification_rule_ref`: nullable identifier of the classifier/policy/manual-review rule set or evidence source used to make the current classification decision
- `source_note_text`: optional sender note/caption, distinct from transcript

These are attributes/markers on `voice_message`, not new entity kinds. `transcription_processing_state` may be stored or deterministically derived, but it must not be left to ad hoc UI inference.

Required transcript/output fields or their exact semantic equivalent:

- normalized transcript text, such as `transcription_text`
- raw provider transcript payload or provider-result record sufficient to audit the transcript fact
- error-bearing fields for failed eligible attempts, such as `transcription_error` plus contextual diagnostics when present

### 2a. Classification epistemics

The ontology distinguishes payload class, speech-bearing status, and transcription eligibility. The runtime therefore needs an explicit classifier path rather than treating those values as self-evident.

First-wave rule:

1. ingress may classify `primary_payload_media_kind` from attachment metadata, MIME, extension, and container probing where available;
2. `speech-bearing classifier` may use deterministic heuristics or probe-based media inspection, but must not pretend certainty when certainty is absent;
3. first-wave positive-evidence policy is explicit:
   - `transcription_eligibility=eligible` may be persisted only when policy/runtime support allow transcription and one of the following is true:
     - a speech-bearing classifier produces positive evidence under the configured policy, or
     - an operator performs manual playback review and marks the payload speech-bearing, or
     - a transport-specific path such as Telegram `voice` uses a rule that is explicitly equivalent in evidence threshold and reviewability to the attachment-origin classifier path rather than envelope kind alone;
   - otherwise the message must remain pending rather than being optimistically classified as eligible by weak evidence alone;
4. first-wave negative-evidence policy is conservative and explicit:
   - heuristic probe evidence alone is not sufficient for `no_speech_audio`;
   - `no_speech_audio` may be persisted only after one of:
     - manual playback review by an operator, or
     - an implementation-defined deterministic classifier rule that is versioned, testable, and documented in code/config;
   - otherwise the message must remain pending rather than being hard-skipped by low-confidence inference;
5. when the runtime cannot soundly determine speech-bearing status at ingress time, the message must be persisted with:
   - `classification_resolution_state=pending`;
   - `transcription_eligibility=null`;
   - an explicit uncertainty basis;
   - `transcription_skip_reason=null`;
6. retry/worker semantics must treat `classification_resolution_state=pending` as neither success nor ineligible skip, and must resolve it through classification/probe or explicit operator action before ASR.
7. state invariant:
   - `classification_resolution_state=pending` requires `transcription_eligibility=null`;
   - `classification_resolution_state=resolved` requires `transcription_eligibility in {eligible, ineligible}`;
   - `primary_transcription_attachment_index=null` is valid only while `classification_resolution_state=pending` and no eligible primary attachment has yet been resolved;
   - `primary_transcription_attachment_index` must be non-null whenever message-level projection is claimed for an eligible or ineligible primary attachment;
   - `transcription_processing_state=pending_classification` iff `classification_resolution_state=pending`;
   - `transcription_processing_state=classified_skip` iff `classification_resolution_state=resolved` and `transcription_eligibility=ineligible`;
   - `transcription_processing_state=pending_transcription` iff `classification_resolution_state=resolved`, `transcription_eligibility=eligible`, no transcript fact has yet been persisted, and no active `transcription_error` is present;
   - `transcription_processing_state=transcription_error` iff the message is otherwise eligible for transcription but currently carries unresolved `transcription_error`;
   - `transcription_processing_state=transcribed` iff transcript fact has been persisted successfully;
   - `is_transcribed=true` iff `transcription_processing_state=transcribed`;
   - `is_transcribed=false` for all other processing states;
   - any other combination is a data-integrity error, not a semantic state.

This keeps the epistemic layer explicit:

- ontology says what kinds exist;
- classifier path says how the runtime comes to know which kind applies.

### 3. Canonical transport recovery anchors

If a message has a resolved primary attachment projection, the top-level primary-attachment transport fields must be available at the message top level, not only nested inside `attachments[]`. Eligible messages require this for worker/retry determinism; resolved-ineligible messages use the same projection contract so the read model and repair logic do not diverge.

Required top-level fields or exact semantic equivalents:

- `file_id`
- `file_unique_id`
- `file_name`
- `file_size`
- `mime_type`

Phase 1 is Telegram-first. Non-Telegram transports may bind semantic equivalents to the same contract, but this document does not require identical field names outside that binding.

For non-Telegram eligible media, parity means the implementation must preserve either transport-specific reacquisition anchors or another durable retry source that survives local file loss. If neither exists, file-loss retry parity is not satisfied and the message must surface an explicit transport-unrecoverable error rather than silently claiming equivalent retry support.

Transition-era worker repair must be gated by an explicit schema-version marker, deployment cutoff timestamp, or another deterministic rollout discriminator. Worker logic must not guess whether a message is pre-contract or merely malformed.

`attachments[]` remains the authoritative source-preserving ingress record, but it must not be the only place where retry-critical transport identifiers live.

Execution-local artifacts such as `file_path` remain valid and useful, but they belong to runtime staging state, not to transport ontology.

This top-level promotion is a denormalization contract for worker/retry determinism, not a second source-of-truth ontology.

Write/read primacy rule:

- top-level transport anchors are a write-time projection derived from the authoritative attachment record;
- ingress or any attachment mutation must populate or refresh that projection in the same write unit;
- they must not be independently mutated to carry different values from `attachments[]`;
- if projection and authoritative attachment metadata disagree, `attachments[]` wins and the top-level projection must be refreshed from it with a recorded diagnostic.
- for multi-attachment messages, the top-level projection is derived from the attachment at `primary_transcription_attachment_index`.

Message-level classification primacy rule:

- per-attachment classification inside `attachments[]` is authoritative;
- message-level classification fields are a write-time projection of the attachment at `primary_transcription_attachment_index`;
- any change to per-attachment classification that can affect primary selection must recompute `primary_transcription_attachment_index`, refresh message-level classification fields, and refresh the top-level transport projection in the same transition.

### 4. Caption is not transcript

For media-bearing attachments:

- caption/source note must not be written into `transcription_text` as if it were speech transcript;
- caption/source note must remain available as auxiliary evidence/context;
- actual transcript fact must come from ASR over the payload media.

For non-transcribable attachments:

- caption/source note may still be the only analyzable text for categorization or task extraction;
- this does not convert the attachment itself into a transcript-bearing message.

### 5. Audio-bearing video can be transcription-eligible

If the payload is video and has an audio track, the message is a transcription candidate only when it is also classified as speech-bearing.

Canonical examples:

- Telemost `.webm`
- screen recording with spoken microphone audio
- meeting export delivered by Telegram as `document`

If the payload is video but no audio track exists, the message is not a transcription failure. It is a classified skip with reason `no_audio_track`.

If the payload has audio but is resolved as non-speech under the configured negative-evidence policy, the message is also a classified skip rather than a transcription error, with reason `no_speech_audio`.

## Classification Matrix

### Envelope `voice`

- Transport strongly indicates payload audio
- `primary_payload_media_kind` may be seeded as `audio` from transport metadata for continuity with current voice ingress
- speech-bearing classification and `transcription_eligibility` still remain classifier/policy outputs, not envelope facts
- contrary probe, policy, or metadata evidence overrides the transport shorthand
- current voice ingress semantics remain operationally valid only if the voice path still runs through the same speech-bearing classifier or a transport-specific rule with the same evidence threshold and auditability before final eligibility is set

### Envelope `document` with audio file

- Payload audio
- if classified as speech-bearing and policy/runtime support allow, `transcription_eligibility=eligible`
- if classified as non-speech, `transcription_eligibility=ineligible` with `transcription_skip_reason=no_speech_audio`
- if speech-bearing status is unresolved, `classification_resolution_state=pending`
- Must enter the same transcription workflow as voice-origin media from the ASR-ready-input stage onward

### Envelope `document` with video file and audio track

- Payload video
- if classified as speech-bearing and policy/runtime support allow, `transcription_eligibility=eligible`
- if classified as non-speech, `transcription_eligibility=ineligible` with `transcription_skip_reason=no_speech_audio`
- if speech-bearing status is unresolved, `classification_resolution_state=pending`
- Must stage audio extraction or equivalent ASR-ready preparation before entering the ASR-ready-input stage if the worker cannot safely transcribe the raw container directly
- For canonical driver containers such as speech-bearing Telemost `.webm`, Phase 1 must therefore include either native ASR support or minimal staging; pending classification fallback applies only while speech-bearing status is unresolved, not after the driver case has been positively identified as speech-bearing
- If no automated positive-evidence rule exists yet for the first-wave driver container, explicit operator resolution remains sufficient for Phase 1; unresolved cases stay pending rather than being silently skipped or failed

### Envelope `document` with video file and no audio track

- Payload video
- `transcription_eligibility=ineligible`
- `transcription_skip_reason=no_audio_track`

### Envelope `document` with PDF / DOCX / XLSX / archive / binary artifact

- Payload binary document
- `transcription_eligibility=ineligible`
- skip reason reflects unsupported payload class, not error

### Multi-attachment message

- `attachments[]` may contain multiple payloads even though the stored object is one `voice_message`
- classification must therefore be performed per attachment first, and per-attachment classification inside `attachments[]` is authoritative
- first-wave canonicalization chooses one `primary_transcription_attachment_index` by stable rule: prefer the eligible attachment with the greatest known duration; attachments with unknown duration sort after those with known duration on that tier; if duration does not decide, prefer the greatest known file size; attachments with unknown size sort after those with known size on that tier; only then tie-break by lowest attachment index
- message-level fields such as `primary_payload_media_kind` and `transcription_eligibility` describe that primary attachment projection only, not the attachment set as a whole
- if no attachment is `eligible` but one or more attachments remain unresolved, the message remains `classification_resolution_state=pending`
- in that pending case, `primary_transcription_attachment_index=null` until an eligible primary is resolved
- in that pending case, automatic classification/probe work must target unresolved attachments individually inside `attachments[]`; after each per-attachment resolution event, the stable rule is re-run to determine whether message-level projection should remain null or switch to an eligible primary
- only once all unresolved attachments have become resolved and none is eligible may the message switch from pending to a resolved-ineligible primary projection
- if all attachments are `resolved` and none is `eligible`, the message is `transcription_eligibility=ineligible` and `primary_transcription_attachment_index` must still be chosen deterministically from the resolved attachments by the same duration-first, then size, then lowest-index rule
- if multiple attachments are `eligible`, the first-wave system still transcribes only the deterministic primary attachment chosen by the stable rule above
- if a pending attachment later resolves to `eligible`, the stable rule must be re-run and the primary projection may change accordingly
- if multiple attachments are eligible, non-primary eligible attachments must remain operator-visible and Phase 1 must allow an explicit operator override of `primary_transcription_attachment_index` before retry/ASR re-arm
- operator override is admissible only among attachments that are currently `eligible`; if the overridden attachment later becomes `pending` or `ineligible`, the override is cleared and the stable rule is re-applied before retry/worker execution
- if the primary attachment changes while ASR is already in flight for the previously primary attachment, message-level projection must follow the newly selected primary immediately; if cancellation is unavailable, the demoted job may complete only into per-attachment metadata and must not overwrite message-level transcript state unless that attachment becomes primary again

This first-wave primary-selection rule is an operational policy, not an ontology law:

- it exists to make message-level retry and UI projection deterministic without inventing a new entity family;
- if production traffic shows that multiple eligible attachments per message are common, later phases must add per-attachment transcription handling instead of treating the message-level projection as a permanent invariant.

## Media Staging Contract

The transcription worker is audio-oriented. Therefore target behavior must define a staging boundary for attachment-origin media.

For `primary_payload_media_kind=video` and `transcription_eligibility=eligible`:

- the worker may transcribe the original file only if the provider/runtime explicitly supports that container safely;
- otherwise the worker must extract or normalize an audio-only working file before ASR;
- the produced working file is an execution aid, not a new first-class domain object.

The message remains the canonical persistence anchor. Staged files are runtime artifacts.

## Processing Contract

### Attachment ingress

When an attachment-origin message is received:

1. Preserve the transport envelope fact.
2. Classify payload media.
3. Persist top-level primary-attachment transport projection whenever `primary_transcription_attachment_index` is non-null.
4. Persist `source_note_text` separately from transcript fields.
5. If `transcription_eligibility=eligible`:
   - set `is_transcribed=false`
   - set or derive `transcription_processing_state=pending_transcription`
   - arm transcription according to the deployment's execution mechanism
   - if a queue exists, enqueue a transcribe job
   - if a queue does not exist, trigger the equivalent direct worker path
6. If `classification_resolution_state=pending`:
   - set `is_transcribed=false`
   - set or derive `transcription_processing_state=pending_classification`
   - do not enqueue ASR
   - keep `transcription_skip_reason=null`
   - if an automatic classification/probe path exists, enqueue that path; otherwise persist the pending basis for explicit operator/manual resolution
7. If `transcription_eligibility=ineligible`:
   - set `is_transcribed=false`
   - set or derive `transcription_processing_state=classified_skip`
   - do not enqueue ASR
   - persist `transcription_skip_reason`
   - do not create a fake empty transcript to mimic success

### Transcribe worker

The worker must operate by eligibility, not by original envelope kind.

Worker obligations:

- resolve file from `file_path` first when available;
- if local file is absent and message is Telegram-origin, recover transport from top-level `file_id`;
- if top-level transport fields are absent but canonical attachment metadata exists, worker may rehydrate the top-level projection from the authoritative attachment metadata during transition only for messages written before the top-level-projection contract shipped or for explicit repair/backfill flows; new ingress writes must satisfy the projection contract without relying on worker-side repair;
- if top-level fields and attachment metadata disagree, the worker must treat authoritative attachment metadata as canonical, record a transport-metadata conflict diagnostic, and refresh the top-level projection before continuing;
- if Telegram transport recovery fails because upstream file identifiers have expired or become unavailable, the worker must record a transport-expired diagnostic inside `transcription_error_context` and surface `transcription_processing_state=transcription_error` rather than reclassifying the message as ineligible;
- if payload is eligible but media staging fails, emit `transcription_error` and surface `transcription_processing_state=transcription_error`;
- if payload is pending classification, do not emit ASR failure; keep the message pending resolution according to `transcription_eligibility_basis`;
- if ASR completes on an eligible message but returns no usable transcript, the system must not silently claim success; it must record `transcription_error=empty_result` and surface `transcription_processing_state=transcription_error`, after which a separate manual or deterministic non-ASR review path may later reclassify the payload if warranted; retry alone must not silently convert `empty_result` into `no_speech_audio`;
- if ASR completes successfully, persist transcript fact, clear unresolved `transcription_error`, set `is_transcribed=true`, and surface `transcription_processing_state=transcribed`;
- if payload is ineligible, emit `transcription_skip_reason`, surface `transcription_processing_state=classified_skip`, and no error.

### Retry path

`POST /api/voicebot/transcription/retry` must re-arm all non-transcribed messages whose `transcription_eligibility=eligible`, regardless of whether they originated from `voice` or `document`.

Authoritative retry selector:

- retry eligibility is `is_transcribed=false` and `transcription_eligibility=eligible`;
- `transcription_processing_state=transcribed` excludes the message from retry;
- `transcription_processing_state=transcription_error` keeps the eligible message retryable unless another policy explicitly suppresses retry.

Canonical payload identity for dedupe:

- implementations must define a `transcription job key` or exact semantic equivalent at least over `voice_message.id`, attachment identity (`primary_transcription_attachment_index` or authoritative attachment id), and a stable payload/transport fingerprint such as `file_unique_id` or equivalent;
- duplicate prevention and in-flight detection are with respect to that key, not merely the current message-level processing state text;
- if primary selection changes to a different attachment, the job key changes with it; duplicate suppression must still apply per key and stale completions from an old key must not overwrite the current primary projection.

`POST /api/voicebot/transcription/retry` must not arm `classification_resolution_state=pending` messages for ASR. Those messages must first become `eligible` through classifier/probe resolution or explicit operator action. The endpoint should report such messages separately rather than silently no-oping on them, and if a pending-classification probe queue exists it may enqueue or refresh that non-ASR path idempotently.

Retry must be idempotent with respect to in-flight transcription work:

- if an eligible message already has an active ASR job or equivalent in-flight execution, retry must not create duplicate work for the same payload.

Operator resolution contract for `classification_resolution_state=pending`:

- explicit operator action may transition a message from `pending` to `eligible` or `ineligible` only after one of: media-probe evidence, manual playback review, or another deterministic non-ASR evidence source documented by policy;
- explicit review/reclassification may also transition a message from `resolved` back to `pending` when prior evidence is invalidated or judged insufficient under policy; such a regression must clear message-level skip/error conclusions that depended on the invalidated evidence and refresh projection state in the same transition;
- the action must record the actor, evidence type, and the updated `transcription_eligibility_basis`;
- the action must also persist `classification_rule_ref`, such as classifier version, policy rule id, or manual-review evidence tag;
- if the transition changes eligibility or changes which attachment should be primary, the system must recompute `primary_transcription_attachment_index`, refresh message-level classification projection, and refresh top-level transport anchors in the same transition;
- explicit operator override of `primary_transcription_attachment_index` is distinct from eligibility classification and may choose only among currently eligible attachments;
- if a manual or deterministic review reclassifies `transcription_error=empty_result` into `classified_skip` or back into `pending classification`, the transition must clear `transcription_error`, update `transcription_processing_state`, and preserve an audit trail of the reclassification basis;
- in Phase 1, pending messages must surface in an operator-visible queue or list immediately through the normal read model; stronger timed alerting may be added later;
- once the message leaves `pending`, normal retry semantics apply.

Transport-expired recovery contract:

- when a message is eligible but transport-expired, the system must preserve that eligible-but-failed state and expose an operator action to resupply the payload, such as re-upload or re-send;
- once transport is resupplied, top-level transport anchors and the message-level projection must be refreshed before retry re-arms ASR.

Retry must not:

- silently no-op because the message arrived as attachment;
- reinterpret caption as transcript;
- turn unsupported binary documents into false ASR failures.

## Persistence Consequences

This feature does not introduce new entity kinds. It specializes `voice_message` attributes and worker semantics.

Persistence-bearing consequences:

- `voice_message` must preserve top-level primary-attachment transport projection for any resolved primary attachment, with retry/recovery-critical coverage guaranteed for eligible attachment-origin media;
- `voice_message` must distinguish sender note from transcript fact;
- `voice_message` must distinguish classified skip from processing error.
- `voice_message` must use one canonical transcript-bearing field family consistently across diagnosis, storage, and prohibition rules, such as raw provider output plus normalized transcript text.
- `voice_message` must keep `is_transcribed` and `transcription_processing_state` semantically aligned with the transcript-bearing field family, not as loose UI conveniences.

Recommended message-level fields:

- `source_note_text`
- `primary_payload_media_kind`
- `audio_track_state` when payload is video and probe result is known
- operator override metadata for `primary_transcription_attachment_index` when manual primary selection is used

Required per-attachment classification fields inside `attachments[]` whenever message-level projection is persisted:

- `payload_media_kind`
- `speech_bearing_assessment`
- `classification_resolution_state`
- `transcription_eligibility`
- `transcription_eligibility_basis`
- `classification_rule_ref`

Recommended per-attachment fields inside `attachments[]`:

- `audio_track_state`
- `duration_ms` or exact semantic equivalent when known
- explicit speech-bearing assessment when the implementation persists it directly

If naming differs in implementation, the semantic split above is mandatory.

## Failure Semantics

### Classified skip

Use classified skip, not error, for:

- unsupported binary document
- image-only attachment
- video without audio track
- audio payload with `no_speech_audio` after sufficiently strong negative evidence
- explicitly disabled media class by policy

These messages may still carry `source_note_text`, but they are not ASR failures.

If `source_note_text` later participates in categorization or task extraction, that downstream path must remain note-based and must not set `is_transcribed=true` by proxy.

### Pending classification

Use pending classification, not ineligibility, for:

- runtime states where speech-bearing status cannot yet be resolved soundly and the message therefore cannot yet be declared eligible or ineligible

First-wave operational consequence:

- pending-classification messages do not proceed to ASR automatically;
- they remain semantically distinct from true ineligibility and from transcription error.

### Transcription error

Use transcription error for:

- eligible media whose local/Telegram transport cannot be resolved
- media staging failure
- provider/API failure
- file corruption on a media class that is otherwise eligible

### No fake success

An empty `legacy_attachment` transcript must not be used as a stand-in for either:

- successful transcription;
- classified skip;
- pending transcription.

Those are three different states.

This prohibition is universal for new behavior. Rollout phasing may limit how quickly historical placeholder records are repaired, but it must not continue creating new fake-empty transcript rows for attachment-origin messages.

## UI / Operator Contract

Voice session UI should be able to distinguish:

- `pending classification`
- `pending transcription`
- `transcribed`
- `classified skip`
- `transcription error`

Canonical UI/read-model mapping:

- `pending classification` = `transcription_processing_state=pending_classification`
- `pending transcription` = `transcription_processing_state=pending_transcription`
- `transcribed` = `transcription_processing_state=transcribed`
- `classified skip` = `transcription_processing_state=classified_skip`
- `transcription error` = `transcription_processing_state=transcription_error`

For eligible attachment-origin media, the operator should see the item in the transcription workflow the same way they see voice-origin media.

For ineligible attachments, the operator should see a clear skip reason instead of an empty transcript row that looks broken.

For pending-classification attachments, the operator should see `pending classification` rather than `classified skip` or `transcription error`.

## Rollout Shape

### Phase 1

- enable attachment-origin media eligibility classification
- top-level primary-attachment projection parity for any resolved primary attachment, with retry/recovery-critical coverage for eligible attachment messages
- queue/retry parity with voice-origin media for eligible messages
- audit and, if needed, align the existing voice-origin eligibility path so it satisfies the same classifier-parity standard rather than preserving an envelope-only shortcut
- minimal operator-visible distinction between `pending classification`, `pending transcription`, `classified skip`, and `transcription error`
- include whatever is minimally required for the canonical driver case, including either native raw-container support or minimal staging for Telemost `.webm` and equivalent first-wave video containers
- use the stable duration-first, then size, then lowest-index rule for multi-attachment primary selection so message-level projection remains deterministic in the first wave
- include the operator-visible pending-resolution path and operator primary-attachment override required by the first-wave multi-attachment contract
- keep caption separate from transcript
- stop creating new empty `legacy_attachment` placeholder rows for attachment-origin messages; if broader historical cleanup must be phased, forward correctness for newly arriving eligible media remains the minimum first-wave requirement

### Phase 2

- broaden and harden media staging for video containers beyond the first-wave driver set where direct ASR is unsafe
- polish and broaden UI exposure of skip vs error distinction beyond the minimum first-wave operator-visible statuses

### Phase 3

- optional repair/backfill script for historical `legacy_attachment` records whose payload is now eligible media

Backfill is not mandatory for first-wave correctness.

## Validation Matrix

Mandatory cases:

1. Telegram `document` with Telemost `.webm`, no caption
   - classifier or operator has resolved the payload as speech-bearing
   - must arm transcription
   - must produce transcript or explicit transcription error
2. Telegram `document` with Telemost `.webm` and caption
   - classifier or operator has resolved the payload as speech-bearing
   - caption stored as `source_note_text`
   - media still transcribed
3. Telegram `document` with PDF and caption
   - no ASR
   - classified skip
   - caption remains available
4. Telegram `document` with audio payload that contains no human speech
   - classified skip `no_speech_audio` only when negative evidence is sufficiently strong
   - otherwise remains `classification_resolution_state=pending`
   - no transcript fields fabricated
5. Telegram `document` with video but no audio track
   - classified skip `no_audio_track`
6. Multi-attachment Telegram message with one speech-bearing media payload and one non-transcribable attachment
   - primary attachment chosen deterministically
   - message-level eligibility reflects the chosen primary payload
7. Multi-attachment Telegram message with more than one eligible candidate
   - primary attachment chosen by duration-first, then size, then lowest-index rule
   - message-level eligibility reflects that primary payload
   - non-primary eligible attachments remain recorded in per-attachment metadata
8. Multi-attachment Telegram message with all attachments resolved ineligible
   - primary attachment still chosen deterministically
   - message-level projection reflects that ineligible primary payload
9. Multi-attachment Telegram message with multiple eligible candidates and explicit operator override
   - overridden eligible attachment becomes primary before retry/ASR re-arm
   - if that attachment later ceases to be eligible, override is cleared and the stable rule is re-applied
10. Attachment whose speech-bearing status cannot yet be resolved soundly at ingress
   - `classification_resolution_state=pending`
   - `transcription_eligibility=null`
   - `transcription_skip_reason=null`
   - no ASR starts automatically
   - classifier/probe or operator path is explicit
11. Retry on eligible attachment after local file loss
   - worker restores from Telegram transport and transcribes
12. Retry on ineligible attachment
   - no ASR job side effects
   - skip state remains sound
13. Retry on pending-classification attachment
   - no ASR starts automatically
   - message remains pending resolution according to basis
14. Telegram `document` with silent or purely non-speech Telemost `.webm`
   - classified skip `no_speech_audio` only when negative evidence is sufficiently strong
   - otherwise remains `classification_resolution_state=pending`
15. Retry on eligible attachment after Telegram `file_id` expiry
   - worker records transport-expired diagnostic
   - message remains eligible-but-failed, not reclassified as ineligible
   - operator can resupply transport and retry afterward

## Non-Goals Clarified

This document does not claim:

- every attachment must become transcribable;
- every caption must become a task;
- video understanding and speech transcription are the same pipeline;
- Telegram `document` is a semantic `document artifact`.

## Decision Summary

- Keep `message_type` as transport-envelope fact.
- Classify payload media independently.
- Treat speech-bearing attachment media, including Telemost `.webm`, as eligible for transcription when policy and runtime support allow it.
- Treat caption as sidecar note, not transcript.
- Preserve top-level primary-attachment transport projection for any resolved primary attachment, with retry-critical recovery guaranteed for eligible attachment-origin media.
- Distinguish `classified skip` from `transcription error`.
