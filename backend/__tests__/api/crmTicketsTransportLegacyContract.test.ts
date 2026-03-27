import { describe, expect, it } from '@jest/globals';

import {
  parseTicketsResponseMode,
  resolveCrmTicketsTransportPayload,
} from '../../src/api/routes/crm/tickets.js';

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
    });

    expect(resolved.statuses).toEqual(['READY_10']);
    expect(resolved.project).toBe('proj-canonical');
    expect(resolved.response_mode).toBe('summary');
    expect(resolved.from_date).toBe('2026-03-01');
    expect(resolved.to_date).toBe('2026-03-20');
    expect(resolved.axis_date).toBe('2026-03-10');
    expect(resolved.range_mode).toBe('entity_temporal_any');
    expect(resolved.draft_horizon_days).toBe(14);

    const warningsByLegacyParam = new Map(
      resolved.legacy_warnings.map((warning) => [warning.legacy_param, warning])
    );
    expect(warningsByLegacyParam.get('task_statuses')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('project_id')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('mode')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('from')?.conflict).toBe(true);
    expect(warningsByLegacyParam.get('to')?.conflict).toBe(true);
    expect(warningsByLegacyParam.has('include_older_drafts')).toBe(false);
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

  it('enforces response_mode > responseMode > mode precedence', () => {
    const resolved = resolveCrmTicketsTransportPayload({
      responseMode: 'table',
      mode: 'detail',
    });

    expect(resolved.response_mode).toBe('table');
    expect(parseTicketsResponseMode(resolved.response_mode)).toBe('summary');
  });

  it('keeps canonical response_mode in triple-conflict payloads and emits both alias warnings', () => {
    const resolved = resolveCrmTicketsTransportPayload({
      response_mode: 'detail',
      responseMode: 'summary',
      mode: 'list',
    });

    expect(resolved.response_mode).toBe('detail');
    expect(parseTicketsResponseMode(resolved.response_mode)).toBe('detail');

    const warningsByLegacyParam = new Map(
      resolved.legacy_warnings.map((warning) => [warning.legacy_param, warning])
    );
    expect(warningsByLegacyParam.get('responseMode')).toEqual(
      expect.objectContaining({
        canonical_param: 'response_mode',
        conflict: true,
        canonical_present: true,
        legacy_present: true,
      })
    );
    expect(warningsByLegacyParam.get('mode')).toEqual(
      expect.objectContaining({
        canonical_param: 'response_mode',
        conflict: true,
        canonical_present: true,
        legacy_present: true,
      })
    );
  });

  it('keeps response mode normalization matrix and invalid mode handling unchanged', () => {
    expect(parseTicketsResponseMode(undefined)).toBe('detail');
    expect(parseTicketsResponseMode(null)).toBe('detail');
    expect(parseTicketsResponseMode('')).toBe('detail');
    expect(parseTicketsResponseMode('detail')).toBe('detail');
    expect(parseTicketsResponseMode('full')).toBe('detail');

    expect(parseTicketsResponseMode('summary')).toBe('summary');
    expect(parseTicketsResponseMode('list')).toBe('summary');
    expect(parseTicketsResponseMode('compact')).toBe('summary');
    expect(parseTicketsResponseMode('table')).toBe('summary');

    expect(parseTicketsResponseMode('unsupported')).toBeNull();
    expect(parseTicketsResponseMode(123)).toBeNull();
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
