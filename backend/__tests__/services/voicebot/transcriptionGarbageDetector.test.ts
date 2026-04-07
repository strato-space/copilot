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

  it('classifies repeated ordinal counter hallucination locally before model call', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"model_clean"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        '1st. 2nd. 3rd. 4th. 5th. 6th. 7th. 8th. 9th. 10th. 11th. 12th. 1st. 2nd. 3rd. 4th. 5th. 6th. 7th. 8th. 9th. 10th. 11th. 12th. 1st. 2nd. 3rd. 4th. 5th. 6th. 7th. 8th. 9th. 10th. 11th. 12th.',
      timeoutMs: 1000,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('repeated_ngram_loop');
  });

  it('keeps single-pass ordinal list on model path', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"clear_speech"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        '1st item is onboarding, 2nd is metrics, 3rd is QA, 4th is rollout, 5th is monitoring, 6th is handoff.',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.is_garbage).toBe(false);
    expect(result.code).toBe('ok');
  });

  it('classifies repeated recipe filler hallucination locally before model call', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"model_clean"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        '1TBSP Sesame Oil 1TBSP Sesame Oil 1TBSP Sesame Oil 1TBSP Sesame Oil 1TBSP Sesame Oil',
      timeoutMs: 1000,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('repeated_ngram_loop');
  });

  it('classifies repeated Ukrainian CTA hallucination locally before model call', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"model_clean"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        'Якщо вам подобається їжа, підписуйтесь. Якщо вам подобається їжа, ставте лайк. Якщо вам подобається їжа, тисніть дзвіночок.',
      timeoutMs: 1000,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('repeated_ngram_loop');
  });

  it('classifies repeated Japanese power-button hallucination locally before model call', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"model_clean"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        '電源ボタンを押してください。電源ボタンを押してください。電源ボタンを押してください。',
      timeoutMs: 1000,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('repeated_segment_loop');
  });

  it('classifies repeated Chinese board phrase locally before model call', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"model_clean"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        '请按电源键请按电源键请按电源键请按电源键请按电源键',
      timeoutMs: 1000,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('repeated_compact_loop');
  });

  it('keeps repeated CTA in normal speech on model path when it appears only twice', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"clear_speech"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        'Якщо вам подобається їжа, не забудьте поставити лайк. І ще раз: якщо вам подобається їжа, напишіть, що приготувати наступним.',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.is_garbage).toBe(false);
    expect(result.code).toBe('ok');
  });

  it('reconciles contradictory repetitive code from model as garbage', async () => {
    const create = jest.fn(async () => ({
      output_text:
        '{"is_garbage":false,"code":"repetitive_chinese_speech","reason":"repeated phrase"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText: 'Короткий рабочий комментарий для проверки противоречивого ответа модели.',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.is_garbage).toBe(true);
    expect(result.code).toBe('repetitive_chinese_speech');
    expect(result.reason).toBe('reconciled_from_code_repetitive_chinese_speech');
  });

  it('keeps a structured ordinal list with one back-reference on model path', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"clear_speech"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        '1st is onboarding, 2nd is support, 3rd is rollout, 4th is monitoring, 5th is QA, 6th is handoff, then back to 1st for recap.',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.is_garbage).toBe(false);
    expect(result.code).toBe('ok');
  });

  it('keeps short repeated recipe guidance on model path', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"clear_speech"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        'Добавь 1TBSP Sesame Oil в соус, а потом еще 1TBSP Sesame Oil в заправку для второго блюда.',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.is_garbage).toBe(false);
    expect(result.code).toBe('ok');
  });

  it('keeps normal speech on model path', async () => {
    const create = jest.fn(async () => ({
      output_text: '{"is_garbage":false,"code":"ok","reason":"clear_speech"}',
    }));
    const result = await detectGarbageTranscription({
      openaiClient: {
        responses: { create },
      },
      transcriptionText:
        'Давай синхронизируем статус по задаче: сегодня закрываем детектор и запускаем регрессионные тесты.',
      timeoutMs: 1000,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.is_garbage).toBe(false);
    expect(result.code).toBe('ok');
  });
});
