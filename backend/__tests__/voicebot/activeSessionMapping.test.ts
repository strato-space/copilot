import { describe, expect, it, jest } from '@jest/globals';
import { ObjectId, type Db } from 'mongodb';

import { RUNTIME_TAG, VOICEBOT_COLLECTIONS } from '../../src/constants.js';
import { setActiveVoiceSession } from '../../src/voicebot_tgbot/activeSessionMapping.js';

describe('activeSessionMapping', () => {
  it('stores runtime_tag only in $setOnInsert for upsert mapping', async () => {
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const collection = { updateOne };
    const db = {
      collection: jest.fn().mockReturnValue(collection),
    } as unknown as Db;

    await setActiveVoiceSession({
      db,
      telegram_user_id: '3045664',
      chat_id: '3045664',
      session_id: new ObjectId().toHexString(),
      username: 'Valeriy_Pavlovich',
    });

    expect((db.collection as unknown as jest.Mock)).toHaveBeenCalledWith(VOICEBOT_COLLECTIONS.TG_VOICE_SESSIONS);
    expect(updateOne).toHaveBeenCalledTimes(1);

    const [_query, update, options] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
      { upsert: boolean },
    ];

    expect(options).toEqual({ upsert: true });
    expect(update.$set.runtime_tag).toBeUndefined();
    expect(update.$setOnInsert.runtime_tag).toBe(RUNTIME_TAG);
    expect(update.$set.active_session_id).toBeInstanceOf(ObjectId);
  });

  it('does not call updateOne for invalid input ids', async () => {
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const db = {
      collection: jest.fn().mockReturnValue({ updateOne }),
    } as unknown as Db;

    const result = await setActiveVoiceSession({
      db,
      telegram_user_id: '3045664',
      session_id: 'not-an-object-id',
    });

    expect(result).toBeNull();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
