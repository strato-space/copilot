import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { enrichPersonsWithTelegramAndProjectLinks } from '../../src/services/telegramKnowledge.js';

describe('telegramKnowledge', () => {
  it('deduplicates project_performer_links when person_id and performer_id point to the same link row', async () => {
    const personId = new ObjectId();
    const performerId = new ObjectId();
    const projectId = new ObjectId();
    const linkId = new ObjectId();

    const makeCursor = (rows: unknown[]) => ({
      toArray: async () => rows,
    });

    const dbStub = {
      collection: (name: string) => {
        if (name === 'automation_telegram_users') {
          return { find: () => makeCursor([]) };
        }
        if (name === 'automation_project_performer_links') {
          return {
            find: () =>
              makeCursor([
                {
                  _id: linkId,
                  project_id: projectId,
                  performer_id: performerId,
                  person_id: personId,
                  role: 'designer',
                  source: 'manual',
                  confidence: 'high',
                  is_active: true,
                },
              ]),
          };
        }
        if (name === 'automation_telegram_chat_memberships' || name === 'automation_telegram_chats') {
          return { find: () => makeCursor([]) };
        }
        return { find: () => makeCursor([]) };
      },
    } as any;

    const result = await enrichPersonsWithTelegramAndProjectLinks(dbStub, [
      {
        _id: personId,
        performer_id: performerId,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.project_performer_links).toHaveLength(1);
    expect(result[0]?.project_performer_links[0]).toEqual(
      expect.objectContaining({
        id: linkId.toHexString(),
        project_id: projectId.toHexString(),
        performer_id: performerId.toHexString(),
        person_id: personId.toHexString(),
      })
    );
  });

  it('does not import id helpers from route-layer files', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/services/telegramKnowledge.ts'),
      'utf8',
    );
    expect(source).toContain("../utils/mongoIds.js");
    expect(source).not.toContain("../api/routes/voicebot/sessionsSharedUtils.js");
  });
});
