import { describe, expect, it } from '@jest/globals';

import { applyRuntimeScopeToAggregatePipeline, patchRuntimeTagIntoSetOnInsert } from '../../src/services/db.js';

describe('db aggregate runtime scope', () => {
  it('keeps lookup stages unchanged', () => {
    const pipeline = [
      {
        $lookup: {
          from: 'automation_tasks_histrory',
          let: { sessionId: '$_id' },
          pipeline: [{ $match: { is_deleted: { $ne: true } } }],
          as: 'tasks',
        },
      },
      {
        $lookup: {
          from: 'automation_tasks',
          localField: 'task_id',
          foreignField: '_id',
          as: 'task',
        },
      },
    ];

    const scoped = applyRuntimeScopeToAggregatePipeline(pipeline as Array<Record<string, unknown>>);

    expect(scoped).toEqual(pipeline as Array<Record<string, unknown>>);
  });

  it('keeps update payload unchanged for upsert patch helper', () => {
    const update = {
      $set: {
        active_session_id: 'abc',
      },
    };

    const patched = patchRuntimeTagIntoSetOnInsert(update);

    expect(Array.isArray(patched)).toBe(false);
    expect(patched).toEqual(update);
  });

  it('returns shallow copy for aggregate pipeline arrays', () => {
    const pipeline = [{ $match: { is_deleted: { $ne: true } } }];

    const scoped = applyRuntimeScopeToAggregatePipeline(pipeline as Array<Record<string, unknown>>);

    expect(scoped).toEqual(pipeline as Array<Record<string, unknown>>);
    expect(scoped).not.toBe(pipeline);
  });
});
