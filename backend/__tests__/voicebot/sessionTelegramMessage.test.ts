import { describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { buildSessionLink, formatTelegramSessionEventMessage } from '../../src/voicebot_tgbot/sessionTelegramMessage.js';
import { VOICEBOT_COLLECTIONS } from '../../src/constants.js';

describe('sessionTelegramMessage', () => {
  it('formats 4-line telegram session event payload', async () => {
    const sessionId = new ObjectId();
    const projectId = new ObjectId();
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            findOne: async () => ({ _id: projectId, name: 'PMO' }),
          };
        }
        return { findOne: async () => null };
      },
    } as any;

    const text = await formatTelegramSessionEventMessage({
      db,
      session: {
        _id: sessionId,
        session_name: 'Test Session',
        project_id: projectId,
      },
      eventName: 'Сессия завершена',
    });

    const lines = text.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Сессия завершена');
    expect(lines[1]).toMatch(/^https?:\/\/\S+\/session\/[a-f\d]{24}$/i);
    expect(lines[2]).toBe('Test Session');
    expect(lines[3]).toBe('PMO');
  });

  it('falls back to canonical domain when VOICE_WEB_INTERFACE_URL points to legacy host', () => {
    const previous = process.env.VOICE_WEB_INTERFACE_URL;
    process.env.VOICE_WEB_INTERFACE_URL = 'http://176.124.201.53:8083';
    try {
      const link = buildSessionLink('6994ae109d4d36a850c87809');
      expect(link).toBe('https://voice.stratospace.fun/session/6994ae109d4d36a850c87809');
    } finally {
      if (previous === undefined) {
        delete process.env.VOICE_WEB_INTERFACE_URL;
      } else {
        process.env.VOICE_WEB_INTERFACE_URL = previous;
      }
    }
  });
});
