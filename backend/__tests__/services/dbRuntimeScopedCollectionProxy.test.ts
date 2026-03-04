import { describe, expect, it, jest } from '@jest/globals';

import { createRuntimeScopedCollectionProxy } from '../../src/services/db.js';

describe('db runtime-scoped collection proxy', () => {
  it('keeps find() query unchanged for runtime-scoped collections', () => {
    const find = jest.fn(() => ({ toArray: async () => [] }));
    const collection = {
      collectionName: 'automation_tasks',
      find,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);
    const query = { is_deleted: { $ne: true } };

    (proxy as unknown as { find: (filter: Record<string, unknown>) => unknown }).find(query);

    expect(find).toHaveBeenCalledTimes(1);
    const [calledQuery] = find.mock.calls[0] as [Record<string, unknown>];
    expect(calledQuery).toEqual(query);
  });

  it('keeps aggregate() pipeline unchanged for runtime-scoped collections', () => {
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

    (proxy as unknown as { aggregate: (stages: Array<Record<string, unknown>>) => unknown }).aggregate(
      pipeline
    );

    expect(aggregate).toHaveBeenCalledTimes(1);
    const [calledPipeline] = aggregate.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(calledPipeline).toEqual(pipeline);
  });

  it('does not patch updateOne() filters or update payloads', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const collection = {
      collectionName: 'automation_tasks',
      updateOne,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);
    const filter = { _id: 'task-id' };
    const update = { $set: { task_status: 'READY_10' } };
    const options = { upsert: true };

    await (
      proxy as unknown as {
        updateOne: (
          query: Record<string, unknown>,
          payload: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => Promise<unknown>;
      }
    ).updateOne(filter, update, options);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [calledFilter, calledUpdate, calledOptions] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>
    ];
    expect(calledFilter).toEqual(filter);
    expect(calledUpdate).toEqual(update);
    expect(calledOptions).toEqual(options);
  });

  it('does not inject runtime_tag into insertOne()', () => {
    const insertOne = jest.fn(async () => ({ acknowledged: true }));
    const collection = {
      collectionName: 'automation_tasks',
      insertOne,
    };

    const proxy = createRuntimeScopedCollectionProxy(collection as never);
    const doc = { title: 'task without runtime tag' };

    (proxy as unknown as { insertOne: (payload: Record<string, unknown>) => unknown }).insertOne(doc);

    expect(insertOne).toHaveBeenCalledTimes(1);
    const [calledDoc] = insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(calledDoc).toEqual(doc);
    expect(calledDoc).not.toHaveProperty('runtime_tag');
  });
});
