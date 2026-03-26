import { describe, expect, it } from '@jest/globals';

import { resolveCrmTicketsTransportPayload } from '../../src/api/routes/crm/tickets.js';

describe('CRM tickets transport canonicalization contract', () => {
  it('prefers canonical fields over legacy aliases and records conflict warnings', () => {
    const resolved = resolveCrmTicketsTransportPayload({
      statuses: ['READY_10'],
      task_statuses: ['DRAFT_10'],
      project: 'proj-canonical',
      project_id: 'proj-legacy',
      response_mode: 'summary',
      mode: 'detail',
      from_date: '2026-03-01',
      from: '2026-02-01',
      to_date: '2026-03-20',
      to: '2026-02-20',
      axis_date: '2026-03-10',
      range_mode: 'entity_temporal_any',
      draft_horizon_days: 14,
      include_older_drafts: true,
    });

    expect(resolved.statuses).toEqual(['READY_10']);
    expect(resolved.project).toBe('proj-canonical');
    expect(resolved.response_mode).toBe('summary');
    expect(resolved.from_date).toBe('2026-03-01');
    expect(resolved.to_date).toBe('2026-03-20');
    expect(resolved.axis_date).toBe('2026-03-10');
    expect(resolved.range_mode).toBe('entity_temporal_any');
    expect(resolved.draft_horizon_days).toBe(14);
    expect(resolved.include_older_drafts).toBe(true);

    const warningsByLegacyParam = new Map(
      resolved.legacy_warnings.map((warning) => [warning.legacy_param, warning])
    );
    expect(warningsByLegacyParam.get('task_statuses')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('project_id')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('mode')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('from')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('to')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('include_older_drafts')?.legacy_present).toBe(true);
  });

  it('falls back to legacy aliases when canonical fields are absent', () => {
    const resolved = resolveCrmTicketsTransportPayload({
      task_statuses: ['READY_10', 'REVIEW_10'],
      project_id: 'proj-legacy',
      mode: 'summary',
      from: '2026-03-01',
      to: '2026-03-20',
    });

    expect(resolved.statuses).toEqual(['READY_10', 'REVIEW_10']);
    expect(resolved.project).toBe('proj-legacy');
    expect(resolved.response_mode).toBe('summary');
    expect(resolved.from_date).toBe('2026-03-01');
    expect(resolved.to_date).toBe('2026-03-20');

    const legacyParams = resolved.legacy_warnings.map((warning) => warning.legacy_param);
    expect(legacyParams).toEqual(
      expect.arrayContaining(['task_statuses', 'project_id', 'mode', 'from', 'to'])
    );
  });

  it('does not emit legacy warnings when only canonical fields are used', () => {
    const resolved = resolveCrmTicketsTransportPayload({
      statuses: ['READY_10'],
      project: ['proj-1', 'proj-2'],
      response_mode: 'detail',
      from_date: '2026-03-01',
      to_date: '2026-03-20',
      axis_date: '2026-03-10',
      range_mode: 'entity_temporal_any',
      draft_horizon_days: 30,
    });

    expect(resolved.statuses).toEqual(['READY_10']);
    expect(resolved.project).toEqual(['proj-1', 'proj-2']);
    expect(resolved.legacy_warnings).toEqual([]);
  });
});
