import { describe, expect, it, jest } from '@jest/globals';
import {
  DEFAULT_GARBAGE_DETECTOR_MODEL,
  detectGarbageTranscription,
  parseGarbageDetectorResponse,
  shouldSkipDetector,
} from '../../../src/services/voicebot/transcriptionGarbageDetector.js';

describe('transcriptionGarbageDetector', () => {
  it('parses strict JSON response', () => {
    const result = parseGarbageDetectorResponse(
      JSON.stringify({ is_garbage: true, code: 'noise', reason: 'music_only' })
    );

    expect(result).toEqual({
      is_garbage: true,
      code: 'noise',
      reason: 'music_only',
    });
  });

  it('parses fenced JSON response', () => {
    const result = parseGarbageDetectorResponse(
      '```json\n{"is_garbage":false,"code":"ok","reason":"clear_speech"}\n```'
    );
    expect(result).toEqual({
      is_garbage: false,
      code: 'ok',
      reason: 'clear_speech',
    });
  });

  it('parses key-value fallback response', () => {
    const result = parseGarbageDetectorResponse(
      'is_garbage: yes, code: repetitive_noise, reason: repeated phrase'
    );
    expect(result).toEqual({
      is_garbage: true,
      code: 'repetitive_noise',
      reason: 'repeated phrase',
    });
  });

  it('skips tiny punctuation-only artifacts', () => {
    expect(shouldSkipDetector('...')).toEqual({ skip: true, reason: 'short_system_artifact' });
  });

  it('calls responses API with gpt-5.4-nano by default', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":true,"code":"noise_or_garbage","reason":"junk"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText: 'repeated repeated repeated',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_GARBAGE_DETECTOR_MODEL,
        store: false,
      })
    );
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('noise_or_garbage');
  });
});
