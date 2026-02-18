import { describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { upsertObjectLocator, findObjectLocatorByOid } from '../../src/services/voicebotObjectLocator.js';
import { RUNTIME_TAG } from '../../src/services/runtimeScope.js';

describe('voicebotObjectLocator runtime scoping', () => {
  it('upsertObjectLocator scopes query by runtime and persists runtime_tag', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const db = {
      collection: jest.fn(() => ({ updateOne })),
    } as unknown as Parameters<typeof upsertObjectLocator>[0]['db'];

    await upsertObjectLocator({
      db,
      oid: 'msg_123',
      entity_type: 'message',
      parent_collection: 'automation_voice_bot_messages',
      parent_id: new ObjectId(),
    });

    const [query, update] = updateOne.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(query).toHaveProperty('$and');
    expect(update.$set).toMatchObject({
      oid: 'msg_123',
      runtime_tag: RUNTIME_TAG,
    });
  });

  it('findObjectLocatorByOid scopes lookup by runtime', async () => {
    const findOne = jest.fn(async () => null);
    const db = {
      collection: jest.fn(() => ({ findOne })),
    } as unknown as Parameters<typeof findObjectLocatorByOid>[0]['db'];

    await findObjectLocatorByOid({ db, oid: 'msg_123' });

    const [query] = findOne.mock.calls[0] as [Record<string, unknown>];
    expect(query).toHaveProperty('$and');
  });
});
