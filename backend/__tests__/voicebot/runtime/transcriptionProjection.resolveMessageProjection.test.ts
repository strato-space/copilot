import { describe, expect, it } from '@jest/globals';
import {
  resolveMessageProjection,
  resolveTranscriptionEligibilityState,
} from '../../../src/workers/voicebot/handlers/shared/transcriptionProjection.js';

describe('resolveMessageProjection deterministic eligible primary selection', () => {
  it('prefers eligible attachment with the longest duration', () => {
    const projection = resolveMessageProjection({
      attachments: [
        {
          file_id: 'eligible-short',
          file_unique_id: 'eligible-short-uniq',
          file_name: 'short.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 12_000,
          size: 9_000,
        },
        {
          file_id: 'eligible-long',
          file_unique_id: 'eligible-long-uniq',
          file_name: 'long.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 33_000,
          size: 1_000,
        },
        {
          file_id: 'ineligible-longest',
          file_unique_id: 'ineligible-longest-uniq',
          file_name: 'not-eligible.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'ineligible',
          classification_resolution_state: 'resolved',
          duration_ms: 80_000,
          size: 99_000,
        },
      ],
    });

    expect(projection.primaryAttachmentIndex).toBe(1);
    expect(projection.canonicalTransport.file_id).toBe('eligible-long');
  });

  it('breaks eligible duration ties by larger file size', () => {
    const projection = resolveMessageProjection({
      attachments: [
        {
          file_id: 'eligible-smaller',
          file_unique_id: 'eligible-smaller-uniq',
          file_name: 'smaller.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 40_000,
          size: 1_500,
        },
        {
          file_id: 'eligible-larger',
          file_unique_id: 'eligible-larger-uniq',
          file_name: 'larger.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 40_000,
          size: 2_500,
        },
      ],
    });

    expect(projection.primaryAttachmentIndex).toBe(1);
    expect(projection.canonicalTransport.file_id).toBe('eligible-larger');
  });

  it('breaks eligible duration and size ties by lowest attachment index', () => {
    const projection = resolveMessageProjection({
      attachments: [
        {
          file_id: 'eligible-first',
          file_unique_id: 'eligible-first-uniq',
          file_name: 'first.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 22_000,
          size: 1_200,
        },
        {
          file_id: 'eligible-second',
          file_unique_id: 'eligible-second-uniq',
          file_name: 'second.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 22_000,
          size: 1_200,
        },
      ],
    });

    expect(projection.primaryAttachmentIndex).toBe(0);
    expect(projection.canonicalTransport.file_id).toBe('eligible-first');
  });

  it('does not keep explicit index when it points to ineligible attachment under classification signals', () => {
    const projection = resolveMessageProjection({
      primary_transcription_attachment_index: 0,
      attachments: [
        {
          file_id: 'ineligible-explicit',
          file_unique_id: 'ineligible-explicit-uniq',
          file_name: 'noaudio.webm',
          mimeType: 'video/webm',
          transcription_eligibility: 'ineligible',
          classification_resolution_state: 'resolved',
          transcription_skip_reason: 'no_audio_track',
          duration_ms: 99_000,
          size: 99_000,
        },
        {
          file_id: 'eligible-target',
          file_unique_id: 'eligible-target-uniq',
          file_name: 'valid.webm',
          mimeType: 'audio/webm',
          transcription_eligibility: 'eligible',
          classification_resolution_state: 'resolved',
          duration_ms: 10_000,
          size: 1_000,
        },
      ],
    });

    expect(projection.primaryAttachmentIndex).toBe(1);
    expect(projection.canonicalTransport.file_id).toBe('eligible-target');
  });

  it('resolves attachment-level no_audio_track as ineligible instead of media-kind fallback eligible', () => {
    const message = {
      attachments: [
        {
          file_id: 'video-no-audio',
          file_unique_id: 'video-no-audio-uniq',
          file_name: 'silent.webm',
          mimeType: 'video/webm',
          payload_media_kind: 'video',
          transcription_eligibility: 'ineligible',
          classification_resolution_state: 'resolved',
          transcription_skip_reason: 'no_audio_track',
        },
      ],
    };
    const projection = resolveMessageProjection(message);
    const eligibility = resolveTranscriptionEligibilityState({ message, projection });

    expect(eligibility.state).toBe('ineligible');
    expect(eligibility.skipReason).toBe('no_audio_track');
    expect(eligibility.classificationResolutionState).toBe('resolved');
  });
});
