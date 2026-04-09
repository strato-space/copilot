import { describe, expect, it } from '@jest/globals';

import {
  hasUsableVoiceSessionTitle,
  isInvalidVoiceSessionTitle,
  normalizeGeneratedVoiceSessionTitle,
} from '../../../src/services/voicebot/sessionTitleValidation.js';

describe('sessionTitleValidation', () => {
  it('rejects generic fallback analyzer titles', () => {
    expect(isInvalidVoiceSessionTitle('Fallback analyzer для voice taskflow')).toBe(true);
    expect(hasUsableVoiceSessionTitle('fallback analyzer: website positioning and AI MVP offer')).toBe(false);
    expect(
      normalizeGeneratedVoiceSessionTitle({
        value: 'fallback analyzer: website positioning and AI MVP offer',
        minWords: 5,
        maxWords: 12,
      })
    ).toBe('');
  });

  it('keeps transcript-grounded titles', () => {
    expect(isInvalidVoiceSessionTitle('Позиционирование сайта и AI MVP оффер')).toBe(false);
    expect(hasUsableVoiceSessionTitle('Позиционирование сайта и AI MVP оффер')).toBe(true);
    expect(
      normalizeGeneratedVoiceSessionTitle({
        value: 'Позиционирование сайта и AI MVP оффер',
        minWords: 5,
        maxWords: 12,
      })
    ).toBe('Позиционирование сайта и AI MVP оффер');
  });
});
