import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('CRM ticket comments contract', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/api/routes/crm/tickets.ts'),
    'utf8'
  );

  it('joins automation_comments into comments_list on ticket reads', () => {
    expect(source).toContain('buildCommentsLookupByTicket');
    expect(source).toContain("from: COLLECTIONS.COMMENTS");
    expect(source).toContain("as: 'comments_list'");
  });

  it('supports session-aware comment metadata on add-comment writes', () => {
    expect(source).toContain('source_session_id');
    expect(source).toContain('discussion_session_id');
    expect(source).toContain('dialogue_reference');
    expect(source).toContain("comment_kind: toNonEmptyString(rawCommentPayload?.comment_kind) ?? 'manual'");
    expect(source).toContain('ticket_db_id');
    expect(source).toContain('ticket_public_id');
  });
});
