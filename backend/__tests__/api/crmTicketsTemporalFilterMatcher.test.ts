import { describe, expect, it } from '@jest/globals';

import {
  normalizeCrmTicketsTemporalFilter,
  taskMatchesCrmTemporalFilter,
} from '../../src/api/routes/crm/tickets.js';

describe('CRM tickets temporal filter matcher', () => {
  it('keeps default entity_temporal_any behavior (mutation OR linkage)', () => {
    const filter = normalizeCrmTicketsTemporalFilter({
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      axis_date: undefined,
      range_mode: undefined,
      draft_horizon_days: undefined,
    });

    const linkageOnlyTask = {
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-10T00:00:00.000Z',
      discussion_window_start_at: '2026-03-10T00:00:00.000Z',
      discussion_window_end_at: '2026-03-12T00:00:00.000Z',
    };

    const mutationOnlyTask = {
      created_at: '2026-03-05T00:00:00.000Z',
      updated_at: '2026-03-06T00:00:00.000Z',
    };

    expect(taskMatchesCrmTemporalFilter(linkageOnlyTask, filter)).toBe(true);
    expect(taskMatchesCrmTemporalFilter(mutationOnlyTask, filter)).toBe(true);
  });

  it('switches behavior between entity_primary and session_linkage_only', () => {
    const mutationInsideLinkageOutside = {
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
      discussion_window_start_at: '2026-01-01T00:00:00.000Z',
      discussion_window_end_at: '2026-01-02T00:00:00.000Z',
    };
    const mutationOutsideLinkageInside = {
      created_at: '2026-01-03T00:00:00.000Z',
      updated_at: '2026-01-04T00:00:00.000Z',
      discussion_window_start_at: '2026-03-08T00:00:00.000Z',
      discussion_window_end_at: '2026-03-10T00:00:00.000Z',
    };

    const entityPrimaryFilter = normalizeCrmTicketsTemporalFilter({
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      axis_date: undefined,
      range_mode: 'entity_primary',
      draft_horizon_days: undefined,
    });
    const linkageOnlyFilter = normalizeCrmTicketsTemporalFilter({
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      axis_date: undefined,
      range_mode: 'session_linkage_only',
      draft_horizon_days: undefined,
    });

    expect(taskMatchesCrmTemporalFilter(mutationInsideLinkageOutside, entityPrimaryFilter)).toBe(true);
    expect(taskMatchesCrmTemporalFilter(mutationOutsideLinkageInside, entityPrimaryFilter)).toBe(false);

    expect(taskMatchesCrmTemporalFilter(mutationInsideLinkageOutside, linkageOnlyFilter)).toBe(false);
    expect(taskMatchesCrmTemporalFilter(mutationOutsideLinkageInside, linkageOnlyFilter)).toBe(true);
  });

  it('supports one-sided intervals (from-only and to-only) with inclusive boundaries', () => {
    const fromOnlyFilter = normalizeCrmTicketsTemporalFilter({
      from_date: '2026-03-10',
      to_date: undefined,
      axis_date: undefined,
      range_mode: 'entity_primary',
      draft_horizon_days: undefined,
    });
    const toOnlyFilter = normalizeCrmTicketsTemporalFilter({
      from_date: undefined,
      to_date: '2026-03-10',
      axis_date: undefined,
      range_mode: 'entity_primary',
      draft_horizon_days: undefined,
    });

    const beforeFrom = {
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-09T00:00:00.000Z',
    };
    const touchingFromBoundary = {
      created_at: '2026-03-09T00:00:00.000Z',
      updated_at: '2026-03-10T00:00:00.000Z',
    };
    const afterTo = {
      created_at: '2026-03-11T00:00:00.000Z',
      updated_at: '2026-03-12T00:00:00.000Z',
    };
    const touchingToBoundary = {
      created_at: '2026-03-10T23:59:59.999Z',
      updated_at: '2026-03-10T23:59:59.999Z',
    };

    expect(taskMatchesCrmTemporalFilter(beforeFrom, fromOnlyFilter)).toBe(false);
    expect(taskMatchesCrmTemporalFilter(touchingFromBoundary, fromOnlyFilter)).toBe(true);
    expect(taskMatchesCrmTemporalFilter(afterTo, toOnlyFilter)).toBe(false);
    expect(taskMatchesCrmTemporalFilter(touchingToBoundary, toOnlyFilter)).toBe(true);
  });

  it('keeps draft_horizon_days + axis_date equivalent to the same explicit interval', () => {
    const horizonFilter = normalizeCrmTicketsTemporalFilter({
      from_date: undefined,
      to_date: undefined,
      axis_date: '2026-03-10T12:00:00.000Z',
      range_mode: undefined,
      draft_horizon_days: 5,
    });
    const explicitFilter = normalizeCrmTicketsTemporalFilter({
      from_date: horizonFilter.from?.toISOString(),
      to_date: horizonFilter.to?.toISOString(),
      axis_date: undefined,
      range_mode: undefined,
      draft_horizon_days: undefined,
    });

    const tasks = [
      {
        id: 'inside-window',
        created_at: '2026-03-08T00:00:00.000Z',
        updated_at: '2026-03-09T00:00:00.000Z',
      },
      {
        id: 'outside-window',
        created_at: '2026-03-20T00:00:00.000Z',
        updated_at: '2026-03-21T00:00:00.000Z',
      },
      {
        id: 'linkage-only-inside',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        discussion_window_start_at: '2026-03-10T12:00:00.000Z',
        discussion_window_end_at: '2026-03-10T12:00:00.000Z',
      },
    ];

    const horizonSelection = tasks
      .filter((task) => taskMatchesCrmTemporalFilter(task, horizonFilter))
      .map((task) => task.id);
    const explicitSelection = tasks
      .filter((task) => taskMatchesCrmTemporalFilter(task, explicitFilter))
      .map((task) => task.id);

    expect(explicitSelection).toEqual(horizonSelection);
  });

  it('supports mixed timestamp formats on mutation and linkage temporal axes', () => {
    const filter = normalizeCrmTicketsTemporalFilter({
      from_date: '2026-03-01',
      to_date: '2026-03-31',
      axis_date: undefined,
      range_mode: 'entity_temporal_any',
      draft_horizon_days: undefined,
    });

    const mutationAxisMixedTask = {
      created_at: Math.trunc(Date.parse('2026-03-05T00:00:00.000Z') / 1000),
      updated_at: String(Date.parse('2026-03-06T00:00:00.000Z')),
    };
    const linkageAxisMixedTask = {
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      discussion_window_start_at: Math.trunc(Date.parse('2026-03-10T00:00:00.000Z') / 1000),
      discussion_window_end_at: new Date('2026-03-12T00:00:00.000Z'),
    };

    expect(taskMatchesCrmTemporalFilter(mutationAxisMixedTask, filter)).toBe(true);
    expect(taskMatchesCrmTemporalFilter(linkageAxisMixedTask, filter)).toBe(true);
  });

  it('normalizes draft_horizon_days around numeric axis_date deterministically', () => {
    const axisSec = Math.trunc(Date.parse('2026-03-10T12:00:00.000Z') / 1000);
    const filter = normalizeCrmTicketsTemporalFilter({
      from_date: undefined,
      to_date: undefined,
      axis_date: String(axisSec),
      range_mode: undefined,
      draft_horizon_days: 2,
      now: new Date('2020-01-01T00:00:00.000Z'),
    });

    expect(filter.axis_date?.toISOString()).toBe('2026-03-10T12:00:00.000Z');
    expect(filter.from?.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(filter.to?.toISOString()).toBe('2026-03-12T12:00:00.000Z');
  });
});
