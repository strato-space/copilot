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
- therefore the message is transcription-eligible even though the transport envelope is not `voice`.

Current AS-IS behavior intentionally treats such messages as attachment-only. This spec defines the target feature track that extends the pipeline to speech-bearing attachment media without collapsing ontology layers.

## Term Normalization

- `transport envelope` — ingress-side carrier kind such as Telegram `voice`, `document`, `photo`, or web upload route. It answers “how did the file arrive?”.
- `payload media` — the stored file payload itself: audio, video, image, binary document, or mixed media. It answers “what kind of file is this?”.
- `speech-bearing media` — payload media whose sound content factually contains human speech audio, rather than arbitrary non-speech audio.
- `transcribable media` — speech-bearing media for which transcription is allowed by current policy and runtime support.
- `audio-bearing video` — a video container whose payload includes an audio track suitable for ASR.
- `caption/source note` — human-authored sidecar text attached to the message by the sender. It is not identical to a transcript.
- `transcript fact` — the speech-to-text output produced from media payload and persisted in `transcription_raw` / `transcription`.
- `transport recovery anchors` — ingress-preserved identifiers needed to reacquire the original payload from upstream transport.
- `runtime staging artifact` — execution-local working file such as extracted audio or downloaded payload path. It is not a transport fact.
- `attachment-only message` — a message that carries a file but is not transcription-eligible under the current feature boundary.
- `speech-bearing classifier` — the runtime mechanism that determines whether a payload with audio factually contains human speech audio.

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

Required message-level fields or their exact semantic equivalent:

- `payload_media_kind`: `audio | video | image | binary_document | mixed | unknown`
- `transcription_eligibility`: `eligible | ineligible | ambiguous`
- `transcription_skip_reason`: nullable code when the message does not proceed to ASR
- `transcription_eligibility_basis`: compact explanation of why the message is eligible or ineligible
- `source_note_text`: optional sender note/caption, distinct from transcript

These are attributes/markers on `voice_message`, not new entity kinds.

### 2a. Classification epistemics

The ontology distinguishes payload class, speech-bearing status, and transcription eligibility. The runtime therefore needs an explicit classifier path rather than treating those values as self-evident.

First-wave rule:

1. ingress may classify `payload_media_kind` from attachment metadata, MIME, extension, and container probing where available;
2. `speech-bearing classifier` may use deterministic heuristics or probe-based media inspection, but must not pretend certainty when certainty is absent;
3. when the runtime cannot soundly determine speech-bearing status at ingress time, the message may be persisted with:
   - `transcription_eligibility=ambiguous`, plus an explicit uncertainty basis, or
   - an implementation-equivalent transitional state such as `pending_classification`;
4. if the implementation chooses the second path, retry/worker semantics must treat `pending_classification` as neither success nor skip.

This keeps the epistemic layer explicit:

- ontology says what kinds exist;
- classifier path says how the runtime comes to know which kind applies.

### 3. Canonical transport recovery anchors

If a message is `transcription_eligibility=eligible`, the worker-critical transport fields must be available at the message top level, not only nested inside `attachments[]`.

Required top-level fields or exact semantic equivalents:

- `file_id`
- `file_unique_id`
- `file_name`
- `file_size`
- `mime_type`

`attachments[]` remains the source-preserving ingress record, but it must not be the only place where retry-critical transport identifiers live.

Execution-local artifacts such as `file_path` remain valid and useful, but they belong to runtime staging state, not to transport ontology.

This top-level promotion is a denormalization contract for worker/retry determinism, not a second source-of-truth ontology.

### 4. Caption is not transcript

For media-bearing attachments:

- caption/source note must not be written into `transcription_text` as if it were speech transcript;
- caption/source note must remain available as auxiliary evidence/context;
- actual transcript fact must come from ASR over the payload media.

For non-transcribable attachments:

- caption/source note may still be the only analyzable text for categorization or task extraction;
- this does not convert the attachment itself into a transcript-bearing message.

### 5. Audio-bearing video is transcription-eligible

If the payload is video and has an audio track, the message is a transcription candidate only when it is also classified as speech-bearing.

Canonical examples:

- Telemost `.webm`
- screen recording with spoken microphone audio
- meeting export delivered by Telegram as `document`

If the payload is video but no audio track exists, the message is not a transcription failure. It is a classified skip with reason `no_audio_track`.

If the payload has audio but the classifier/probe finds no human speech audio, the message is also a classified skip rather than a transcription error, with reason `no_speech_audio`.

## Classification Matrix

### Envelope `voice`

- Payload audio
- Speech-bearing
- `transcription_eligibility=eligible`
- Current voice ingress semantics remain valid

### Envelope `document` with audio file

- Payload audio
- Speech-bearing
- `transcription_eligibility=eligible`
- Must enter the same transcription pipeline as voice-origin media

### Envelope `document` with video file and audio track

- Payload video
- Speech-bearing
- `transcription_eligibility=eligible`
- Must stage audio extraction or equivalent ASR-ready preparation before transcription if the worker cannot safely transcribe the raw container directly

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
- eligibility must therefore be evaluated per attachment first
- first-wave canonicalization chooses one `primary_transcription_attachment_index`
- message-level fields such as `payload_media_kind` and `transcription_eligibility` describe that primary attachment
- if multiple attachments are eligible and no deterministic primary can be chosen, classify the message as `ambiguous` with skip reason `multi_attachment_ambiguity` rather than silently picking an arbitrary payload

This first-wave ambiguity policy is an operational hypothesis, not an ontology law:

- hypothesis: multi-attachment messages with more than one speech-bearing candidate are rare enough that ambiguity-skip is acceptable;
- review trigger: if production traffic shows this pattern is common, the ambiguity-skip policy must be replaced by per-attachment transcription handling rather than defended as a permanent invariant.

## Media Staging Contract

The transcription worker is audio-oriented. Therefore target behavior must define a staging boundary for attachment-origin media.

For `payload_media_kind=video` and `transcription_eligibility=eligible`:

- the worker may transcribe the original file only if the provider/runtime explicitly supports that container safely;
- otherwise the worker must extract or normalize an audio-only working file before ASR;
- the produced working file is an execution aid, not a new first-class domain object.

The message remains the canonical persistence anchor. Staged files are runtime artifacts.

## Processing Contract

### Attachment ingress

When an attachment-origin message is received:

1. Preserve the transport envelope fact.
2. Classify payload media.
3. Persist worker-critical transport fields at top level for eligible media.
4. Persist `source_note_text` separately from transcript fields.
5. If `transcription_eligibility=eligible`:
   - set `is_transcribed=false`
   - set `to_transcribe` according to the existing queue/no-queue pattern
   - enqueue transcribe job when queue exists
6. If `transcription_eligibility=ineligible`:
   - do not enqueue ASR
   - persist `transcription_skip_reason`
   - do not create a fake empty transcript to mimic success

### Transcribe worker

The worker must operate by eligibility, not by original envelope kind.

Worker obligations:

- resolve file from `file_path` first when available;
- if local file is absent and message is Telegram-origin, recover transport from top-level `file_id`;
- if top-level transport fields are absent but canonical attachment metadata exists, worker may use attachment metadata fallback during transition only, but top-level parity remains the target contract;
- if top-level fields and attachment metadata disagree, the worker must record a transport-metadata conflict diagnostic instead of silently choosing different sources on different retries;
- if Telegram transport recovery fails because upstream file identifiers have expired or become unavailable, the worker must record a transport-expired diagnostic inside `transcription_error_context` rather than reclassifying the message as ineligible;
- if payload is eligible but media staging fails, emit `transcription_error`;
- if payload is ineligible, emit `transcription_skip_reason` and no error.

### Retry path

`POST /api/voicebot/transcription/retry` must re-arm all non-transcribed messages whose `transcription_eligibility=eligible`, regardless of whether they originated from `voice` or `document`.

Retry must not:

- silently no-op because the message arrived as attachment;
- reinterpret caption as transcript;
- turn unsupported binary documents into false ASR failures.

## Persistence Consequences

This feature does not introduce new entity kinds. It specializes `voice_message` attributes and worker semantics.

Persistence-bearing consequences:

- `voice_message` must preserve enough transport recovery data for eligible attachment-origin media;
- `voice_message` must distinguish sender note from transcript fact;
- `voice_message` must distinguish classified skip from processing error.

Recommended message-level fields:

- `source_note_text`
- `payload_media_kind`
- `transcription_eligibility`
- `transcription_eligibility_basis`
- `transcription_skip_reason`
- `primary_transcription_attachment_index`
- `audio_track_state` when payload is video and probe result is known

If naming differs in implementation, the semantic split above is mandatory.

## Failure Semantics

### Classified skip

Use classified skip, not error, for:

- unsupported binary document
- image-only attachment
- video without audio track
- audio payload with `no_speech_audio`
- explicitly disabled media class by policy

These messages may still carry `source_note_text`, but they are not ASR failures.

If `source_note_text` later participates in categorization or task extraction, that downstream path must remain note-based and must not set `is_transcribed=true` by proxy.

### Ambiguity

Use ambiguity state, not ineligibility, for:

- multi-attachment messages with more than one eligible candidate and no deterministic primary attachment
- runtime states where eligibility cannot yet be resolved soundly but the message also cannot be declared ineligible

First-wave operational consequence:

- ambiguous messages do not proceed to ASR automatically;
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

## UI / Operator Contract

Voice session UI should be able to distinguish:

- `pending transcription`
- `transcribed`
- `classified skip`
- `transcription error`

For eligible attachment-origin media, the operator should see the item in the transcription workflow the same way they see voice-origin media.

For ineligible attachments, the operator should see a clear skip reason instead of an empty transcript row that looks broken.

## Rollout Shape

### Phase 1

- enable attachment-origin media eligibility classification
- top-level transport parity for eligible attachment messages
- queue/retry parity with voice-origin media
- keep caption separate from transcript
- retire the empty `legacy_attachment` placeholder pattern for eligible media

### Phase 2

- add media staging for video containers where direct ASR is unsafe
- expose skip vs error distinction clearly in UI

### Phase 3

- optional repair/backfill script for historical `legacy_attachment` records whose payload is now eligible media

Backfill is not mandatory for first-wave correctness.

## Validation Matrix

Mandatory cases:

1. Telegram `document` with Telemost `.webm`, no caption
   - must enqueue transcription
   - must produce transcript or explicit transcription error
2. Telegram `document` with Telemost `.webm` and caption
   - caption stored as `source_note_text`
   - media still transcribed
3. Telegram `document` with PDF and caption
   - no ASR
   - classified skip
   - caption remains available
4. Telegram `document` with audio payload that contains no human speech
   - classified skip `no_speech_audio`
   - no transcript fields fabricated
5. Telegram `document` with video but no audio track
   - classified skip `no_audio_track`
6. Multi-attachment Telegram message with one speech-bearing media payload and one non-transcribable attachment
   - primary attachment chosen deterministically
   - message-level eligibility reflects the chosen primary payload
7. Retry on eligible attachment after local file loss
   - worker restores from Telegram transport and transcribes
8. Retry on ineligible attachment
   - no ASR job side effects
   - skip state remains sound
9. Retry on eligible attachment after Telegram `file_id` expiry
   - worker records transport-expired diagnostic
   - message remains eligible-but-failed, not reclassified as ineligible

## Non-Goals Clarified

This document does not claim:

- every attachment must become transcribable;
- every caption must become a task;
- video understanding and speech transcription are the same pipeline;
- Telegram `document` is a semantic `document artifact`.

## Decision Summary

- Keep `message_type` as transport-envelope fact.
- Classify payload media independently.
- Treat speech-bearing attachment media, including Telemost `.webm`, as transcription-eligible.
- Treat caption as sidecar note, not transcript.
- Preserve retry-critical transport fields at top level for eligible attachment-origin media.
- Distinguish `classified skip` from `transcription error`.
