import { describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../src/constants.js';
import {
  buildDoneNotifyPreview,
  writeDoneNotifyRequestedLog,
} from '../../src/services/voicebotDoneNotify.js';

describe('voicebotDoneNotify service', () => {
  it('builds telegram preview with 4-line message', async () => {
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

    const preview = await buildDoneNotifyPreview({
      db,
      session: {
        _id: new ObjectId(),
        session_name: 'Session A',
        project_id: projectId,
      },
      eventName: 'Сессия завершена',
    });

    expect(preview.event_name).toBe('Сессия завершена');
    expect(preview.telegram_message.split('\n')).toHaveLength(4);
  });

  it('writes notify_requested session log with session_done metadata', async () => {
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { insertOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    await writeDoneNotifyRequestedLog({
      db,
      session_id: new ObjectId(),
      session: { _id: new ObjectId(), session_name: 'S' },
      actor: { type: 'performer', performer_id: 'u1' },
      source: { type: 'socket' },
      preview: {
        event_name: 'Сессия завершена',
        telegram_message: 'line1\nline2\nline3\nline4',
      },
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const [doc] = insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(doc.event_name).toBe('notify_requested');
    const metadata = doc.metadata as Record<string, unknown>;
    expect(metadata.notify_event).toBe(VOICEBOT_JOBS.notifies.SESSION_DONE);
    expect(metadata.telegram_message).toBe('line1\nline2\nline3\nline4');
  });
});
