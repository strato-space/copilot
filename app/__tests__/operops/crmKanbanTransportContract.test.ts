import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('CRM kanban transport contract', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/store/kanbanStore.ts'), 'utf8');

  it('emits canonical summary payload fields for tickets fetch', () => {
    expect(source).toContain("response_mode: 'summary'");
    expect(source).toContain('requestPayload.draft_horizon_days = resolvedDraftHorizonDays;');
  });

  it('does not emit deprecated include_older_drafts in request payloads', () => {
    expect(source).not.toContain('requestPayload.include_older_drafts');
    expect(source).toContain('legacy_include_older_drafts_requested');
  });
});
