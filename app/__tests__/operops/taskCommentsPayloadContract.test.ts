import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('OperOps task comment payload contract', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/store/kanbanStore.ts'),
    'utf8'
  );

  it('sends normalized add-comment payload to backend', () => {
    expect(source).toContain("api_request('tickets/add-comment', {");
    expect(source).toContain('ticket_id: ticket._id');
    expect(source).toContain('comment: {');
    expect(source).toContain("comment_kind: 'manual'");
  });
});
