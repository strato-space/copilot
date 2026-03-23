import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

describe('CRM tickets draft horizon summary contract', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/api/routes/crm/tickets.ts'),
    'utf8'
  );

  it('keeps voice linkage fields in summary projection for draft horizon filtering', () => {
    expect(source).toContain('const SUMMARY_DRAFT_RECENCY_TRANSIENT_FIELDS = [');
    expect(source).toContain('source_data: 1,');
    expect(source).toContain('source_ref: 1,');
    expect(source).toContain('external_ref: 1,');
  });

  it('strips only transient source metadata while keeping source refs for session-linked list filtering', () => {
    expect(source).toContain("'source',");
    expect(source).toContain("'source_kind',");
    expect(source).toContain("'source_data',");
    expect(source).not.toContain("'source_ref',");
    expect(source).not.toContain("'external_ref',");
    expect(source).toContain('for (const field of SUMMARY_DRAFT_RECENCY_TRANSIENT_FIELDS) {');
    expect(source).toContain('delete normalizedTicket[field];');
  });

  it('prefilters draft-only summary horizon queries using lightweight candidate projection', () => {
    expect(source).toContain('const DRAFT_RECENCY_PREFILTER_PROJECTION = {');
    expect(source).toContain('const shouldUseDraftSummaryPrefilter =');
    expect(source).toContain("statusKeys.length === 1 && statusKeys[0] === 'DRAFT_10'");
    expect(source).toContain('projection: DRAFT_RECENCY_PREFILTER_PROJECTION,');
    expect(source).toContain('const prefilteredVisibleIds = prefilteredDraftVisibleIds ?? prefilteredArchiveVisibleIds;');
    expect(source).toContain('...(prefilteredVisibleIds');
    expect(source).toContain('_id: { $in: prefilteredVisibleIds },');
    expect(source).toContain('if (draftHorizonDays) {');
    expect(source).toContain('if (!prefilteredDraftVisibleIds) {');
  });

  it('applies the same depth control to archive list and status counts', () => {
    expect(source).toContain('const ARCHIVE_RECENCY_PREFILTER_PROJECTION = {');
    expect(source).toContain('const shouldUseArchiveSummaryPrefilter =');
    expect(source).toContain("statusKeys.length === 1 && statusKeys[0] === 'ARCHIVE'");
    expect(source).toContain('const filterArchivedTasksByRecency = ({');
    expect(source).toContain('resolveDateLikeTimestamp(task.updated_at) ?? resolveDateLikeTimestamp(task.created_at)');
    expect(source).toContain('if (!prefilteredArchiveVisibleIds) {');
    expect(source).toContain("counts.set('ARCHIVE', visibleArchive.length);");
  });
});
