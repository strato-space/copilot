import { describe, expect, it } from '@jest/globals';
import { extractSessionIdFromText, getSessionIdFromCommand } from '../../src/voicebot_tgbot/sessionRef.js';

describe('tg session ref parser', () => {
  it('extracts session id from canonical URL', () => {
    const text = 'https://voice.stratospace.fun/session/6994ae109d4d36a850c87809';
    expect(extractSessionIdFromText(text)).toBe('6994ae109d4d36a850c87809');
  });

  it('extracts session id from command argument', () => {
    const text = '/session 6994ae109d4d36a850c87809';
    expect(getSessionIdFromCommand(text)).toBe('6994ae109d4d36a850c87809');
  });

  it('returns null for invalid payload', () => {
    expect(extractSessionIdFromText('no session here')).toBeNull();
    expect(getSessionIdFromCommand('/session')).toBeNull();
  });
});

