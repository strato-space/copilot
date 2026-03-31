# Videoparser: short spec for video input and the `40 chunks` failure mode

## Problem
For video-bearing inputs, one source file can currently fan out into dozens of ASR chunks (for example, `40`), which:
- increases latency and cost;
- complicates retry/resume behavior;
- raises the risk of noisy downstream artifacts.

## Goal
For video inputs, always extract audio first and only then run ASR, with a hard upper bound on chunk count.

## Required behavior (MUST)
1. If `media = video`:
- run `ffmpeg` audio extraction first (`mono`, `16kHz`, `opus|m4a`);
- ASR must operate only on the extracted audio, never on the raw video container.

2. If `media = audio`:
- use the file directly, without the video staging path.

3. Single-file first:
- first attempt ASR with one audio file;
- enable chunking only when file size or duration exceeds the provider limit.

4. Chunk upper bound:
- `MAX_ASR_CHUNKS = 8` by default;
- if the estimate is greater than `8`, first lower the bitrate / re-encode the audio and recalculate;
- only then allow segmentation, still with a hard cap `<= 8`.

5. Forensic trace:
- persist `source_media_type`, `audio_extracted=true/false`, `asr_chunk_count`, and `chunk_policy`;
- when the hard cap path is activated, also record `chunk_cap_applied=true`.

## Algorithm (short form)
1. Detect media type (`video|audio`).
2. For `video`: call `extract_audio()`.
3. Run `probe_audio(size,duration)`.
4. If the media fits the single-shot limit: call `transcribe_one()`.
5. If the media does not fit:
- call `plan_chunks(target_duration, max_chunks=8)`;
- when the estimate is too high, call `reencode_lower_bitrate()` and then `plan_chunks()` again;
- call `transcribe_chunks()` and merge by timecodes.

## Acceptance criteria
- A single input video no longer produces a `40`-chunk fan-out.
- In the typical long-input case, chunk count remains `<= 8`.
- Every processed file logs `asr_chunk_count` and whether video-audio extraction happened.
- Transcription quality does not degrade materially versus the current baseline.

## Out of scope
- OCR / vision optimization.
- complex frame-level ontologies.
- downstream summary/task rules.
