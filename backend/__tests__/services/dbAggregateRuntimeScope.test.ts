import { describe, expect, it } from '@jest/globals';

import { IS_PROD_RUNTIME, RUNTIME_FAMILY, RUNTIME_TAG } from '../../src/services/runtimeScope.js';
import { applyRuntimeScopeToAggregatePipeline } from '../../src/services/db.js';

describe('db aggregate runtime scope', () => {
  const expectedRuntimeFilterExpr = {
    $expr: IS_PROD_RUNTIME
      ? {
          $or: [
            {
              $regexMatch: {
                input: '$runtime_tag',
                regex: new RegExp(`^${RUNTIME_FAMILY}(?:-|$)`),
              },
            },
            { $eq: ['$runtime_tag', null] },
            { $eq: ['$runtime_tag', ''] },
          ],
        }
      : {
          $eq: ['$runtime_tag', RUNTIME_TAG],
        },
  };

  it('adds runtime filter to lookup stage with explicit pipeline', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'automation_tasks_histrory',
          let: { sessionId: '$_id' },
          pipeline: [{ $match: { is_deleted: { $ne: true } } }],
          as: 'tasks',
        },
      },
    ];

    const [scoped] = applyRuntimeScopeToAggregatePipeline(pipeline as Array<Record<string, unknown>>);

    expect((scoped as { $lookup: Record<string, unknown> }).$lookup.from).toBe('automation_tasks_histrory');
    expect(Array.isArray((scoped as { $lookup: { pipeline: Array<Record<string, unknown>> } }).$lookup.pipeline)).toBe(true);

    const lookupPipeline = (scoped as { $lookup: { pipeline: Array<Record<string, unknown>> } }).$lookup.pipeline;

    expect(lookupPipeline).toHaveLength(2);
    expect(lookupPipeline[0]).toEqual({ $match: expectedRuntimeFilterExpr });
    expect(lookupPipeline[1]).toEqual({ $match: { is_deleted: { $ne: true } } });
  });

  it('converts localField/foreignField lookup to runtime-scoped pipeline form', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'automation_tasks',
          localField: 'task_id',
          foreignField: '_id',
          as: 'task',
        },
      },
    ];

    const [scoped] = applyRuntimeScopeToAggregatePipeline(pipeline as Array<Record<string, unknown>>);
    const lookup = (scoped as { $lookup: Record<string, unknown> }).$lookup;

    expect(lookup.from).toBe('automation_tasks');
    expect(lookup).not.toHaveProperty('localField');
    expect(lookup).not.toHaveProperty('foreignField');

    const lookupPipeline = (lookup as { pipeline: Array<Record<string, unknown>> }).pipeline;
    expect(Array.isArray(lookupPipeline)).toBe(true);
    expect(lookupPipeline).toHaveLength(2);

    expect(lookupPipeline[0]).toEqual({ $match: expectedRuntimeFilterExpr });
    expect(lookupPipeline[1]).toEqual({
      $match: {
        $expr: {
          $or: [
            { $eq: ['$$__runtime_lookup_local', '$_id'] },
            {
              $and: [
                { $isArray: '$$__runtime_lookup_local' },
                { $in: ['$_id', '$$__runtime_lookup_local'] },
              ],
            },
          ],
        },
      },
    });
  });

  it('does not touch non-runtime lookup stages', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'automation_performers',
          localField: 'performer_id',
          foreignField: '_id',
          as: 'performer',
        },
      },
    ];

    const scoped = applyRuntimeScopeToAggregatePipeline(pipeline as Array<Record<string, unknown>>);

    expect(scoped).toEqual(pipeline as Array<Record<string, unknown>>);
  });
});
