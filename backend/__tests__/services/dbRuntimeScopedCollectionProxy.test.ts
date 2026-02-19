import { describe, expect, it, jest } from '@jest/globals';

import {
  createRuntimeScopedCollectionProxy,
} from '../../src/services/db.js';
import {
  buildRuntimeFilter,
  buildRuntimeFilterExpression,
  IS_PROD_RUNTIME,
  RUNTIME_FAMILY,
  RUNTIME_TAG,
  mergeWithRuntimeFilter,
} from '../../src/services/runtimeScope.js';

const expectedRuntimeFilter = buildRuntimeFilter({
  field: 'runtime_tag',
  familyMatch: IS_PROD_RUNTIME,
  includeLegacyInProd: IS_PROD_RUNTIME,
  runtimeTag: RUNTIME_TAG,
  prodRuntime: IS_PROD_RUNTIME,
});

describe('db runtime-scoped collection proxy', () => {
  it('applies runtime filter for find() on runtime-scoped CRM collections', () => {
    const find = jest.fn(() => ({ toArray: async () => [] }));
    const collection = {
      collectionName: 'automation_tasks',
      find,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);

    (proxy as unknown as { find: (query: Record<string, unknown>) => unknown }).find({
      is_deleted: { $ne: true },
    });

    expect(find).toHaveBeenCalledTimes(1);
    const [query] = find.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual(
      mergeWithRuntimeFilter(
        { is_deleted: { $ne: true } },
        {
          field: 'runtime_tag',
          familyMatch: IS_PROD_RUNTIME,
          includeLegacyInProd: IS_PROD_RUNTIME,
          runtimeTag: RUNTIME_TAG,
          prodRuntime: IS_PROD_RUNTIME,
        }
      )
    );
  });

  it('does not alter find() query for shared collections', () => {
    const find = jest.fn(() => ({ toArray: async () => [] }));
    const collection = {
      collectionName: 'automation_projects',
      find,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);
    (proxy as unknown as { find: (query: Record<string, unknown>) => unknown }).find({
      is_deleted: { $ne: true },
    });

    expect(find).toHaveBeenCalledTimes(1);
    const [query] = find.mock.calls[0] as [Record<string, unknown>];
    expect(query).toEqual({ is_deleted: { $ne: true } });
  });

  it('prepends runtime $match and scopes runtime lookups in aggregate()', () => {
    const aggregate = jest.fn(() => ({ toArray: async () => [] }));
    const collection = {
      collectionName: 'automation_tasks',
      aggregate,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);
    const pipeline = [
      {
        $lookup: {
          from: 'automation_work_hours',
          localField: 'id',
          foreignField: 'ticket_id',
          as: 'work_data',
        },
      },
      {
        $lookup: {
          from: 'automation_projects',
          localField: 'project_id',
          foreignField: '_id',
          as: 'project_data',
        },
      },
    ];

    (proxy as unknown as { aggregate: (p: Array<Record<string, unknown>>) => unknown }).aggregate(
      pipeline
    );

    expect(aggregate).toHaveBeenCalledTimes(1);
    const [scopedPipeline] = aggregate.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(Array.isArray(scopedPipeline)).toBe(true);
    expect(scopedPipeline[0]).toEqual({ $match: expectedRuntimeFilter });

    const runtimeLookup = scopedPipeline[1]?.$lookup as Record<string, unknown>;
    expect(runtimeLookup?.from).toBe('automation_work_hours');
    expect(Array.isArray(runtimeLookup?.pipeline)).toBe(true);
    expect((runtimeLookup.pipeline as Array<Record<string, unknown>>)[0]).toEqual({
      $match: {
        $expr: buildRuntimeFilterExpression({
          fieldExpr: '$runtime_tag',
          strict: false,
          familyMatch: IS_PROD_RUNTIME,
          includeLegacyInProd: IS_PROD_RUNTIME,
          runtimeTag: RUNTIME_TAG,
          runtimeFamily: RUNTIME_FAMILY,
          prodRuntime: IS_PROD_RUNTIME,
        }),
      },
    });

    const sharedLookup = scopedPipeline[2]?.$lookup as Record<string, unknown>;
    expect(sharedLookup?.from).toBe('automation_projects');
    expect(sharedLookup?.localField).toBe('project_id');
    expect(sharedLookup?.foreignField).toBe('_id');
  });

  it('patches upsert update with runtime_tag for runtime-scoped collections', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const collection = {
      collectionName: 'automation_tasks',
      updateOne,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);
    await (
      proxy as unknown as {
        updateOne: (
          filter: Record<string, unknown>,
          update: Record<string, unknown>,
          options: Record<string, unknown>
        ) => Promise<unknown>;
      }
    ).updateOne(
      { _id: 'task-id' },
      { $set: { task_status: 'READY_10' } },
      { upsert: true }
    );

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(filter).toEqual(
      mergeWithRuntimeFilter(
        { _id: 'task-id' },
        {
          field: 'runtime_tag',
          familyMatch: IS_PROD_RUNTIME,
          includeLegacyInProd: IS_PROD_RUNTIME,
          runtimeTag: RUNTIME_TAG,
          prodRuntime: IS_PROD_RUNTIME,
        }
      )
    );
    expect(update).toEqual({
      $set: { task_status: 'READY_10' },
      $setOnInsert: { runtime_tag: RUNTIME_TAG },
    });
  });
});
