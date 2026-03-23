import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { COLLECTIONS, TASK_STATUSES } from '../../../src/constants.js';

const appendBdIssueNotesMock = jest.fn();

jest.unstable_mockModule('../../../src/services/bdClient.js', () => ({
  appendBdIssueNotes: appendBdIssueNotesMock,
}));

const {
  applyCreateTasksCompositeCommentSideEffects,
  READY_ENRICHMENT_COMMENT_KIND,
} = await import('../../../src/services/voicebot/createTasksCompositeCommentSideEffects.js');

type QueryRecord = Record<string, unknown>;

const buildDbStub = ({
  acceptedTasks,
  codexTasks,
}: {
  acceptedTasks: Array<Record<string, unknown>>;
  codexTasks: Array<Record<string, unknown>>;
}) => {
  const commentDocs: Array<Record<string, unknown>> = [];
  const commentsInsertMany = jest.fn(async (docs: Array<Record<string, unknown>>) => {
    docs.forEach((doc) => commentDocs.push({ ...doc }));
    return { insertedCount: docs.length };
  });
  const commentsFind = jest.fn((query: QueryRecord) => ({
    toArray: async () => {
      const kinds = String(query.comment_kind || '');
      if (kinds !== READY_ENRICHMENT_COMMENT_KIND) return [];
      return commentDocs;
    },
  }));

  const tasksUpdateOne = jest.fn(async (filter: QueryRecord, update: QueryRecord) => {
    const id = filter._id instanceof ObjectId ? filter._id.toHexString() : '';
    const target = codexTasks.find((task) => {
      const taskId = task._id instanceof ObjectId ? task._id.toHexString() : '';
      return taskId === id;
    });
    if (target && update.$set && typeof update.$set === 'object') {
      Object.assign(target, update.$set as Record<string, unknown>);
    }
    return { matchedCount: target ? 1 : 0, modifiedCount: target ? 1 : 0 };
  });
  const tasksFind = jest.fn((query: QueryRecord) => ({
    toArray: async () => {
      if (query.codex_task === true) return codexTasks;
      return acceptedTasks;
    },
  }));

  return {
    db: {
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            find: tasksFind,
            updateOne: tasksUpdateOne,
          };
        }
        if (name === COLLECTIONS.COMMENTS) {
          return {
            find: commentsFind,
            insertMany: commentsInsertMany,
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    },
    commentDocs,
    codexTasks,
    tasksFind,
    tasksUpdateOne,
    commentsInsertMany,
  };
};

describe('applyCreateTasksCompositeCommentSideEffects', () => {
  beforeEach(() => {
    appendBdIssueNotesMock.mockReset();
    appendBdIssueNotesMock.mockResolvedValue(undefined);
  });

  it('writes Ready comments and Codex notes once, then dedupes identical reruns', async () => {
    const sessionId = new ObjectId().toHexString();
    const readyTaskId = new ObjectId();
    const codexTaskId = new ObjectId();
    const session = {
      _id: sessionId,
      external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
    };
    const acceptedTasks = [
      {
        _id: readyTaskId,
        id: 'READY-1',
        task_status: TASK_STATUSES.READY_10,
        codex_task: false,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
      },
    ];
    const codexTasks = [
      {
        _id: codexTaskId,
        id: 'copilot-123',
        codex_task: true,
        external_ref: `https://copilot.stratospace.fun/voice/session/${sessionId}`,
        notes: '',
      },
    ];
    const { db, commentDocs, codexTasks: liveCodexTasks, commentsInsertMany, tasksUpdateOne } = buildDbStub({
      acceptedTasks,
      codexTasks,
    });

    const drafts = [
      {
        lookup_id: 'READY-1',
        comment: 'Add release checklist before launch.',
        dialogue_reference: 'voice/session/x#ready',
      },
      {
        lookup_id: 'copilot-123',
        comment: 'Investigate dependent runtime tasks before coding.',
        dialogue_reference: 'voice/session/x#codex',
      },
    ];

    const first = await applyCreateTasksCompositeCommentSideEffects({
      db: db as never,
      sessionId,
      session,
      drafts,
      actorId: 'user-1',
      actorName: 'Valery',
    });

    expect(first).toEqual({
      insertedEnrichmentComments: 1,
      dedupedEnrichmentComments: 0,
      insertedCodexEnrichmentNotes: 1,
      dedupedCodexEnrichmentNotes: 0,
      unresolvedEnrichmentLookupIds: [],
    });
    expect(commentsInsertMany).toHaveBeenCalledTimes(1);
    expect(commentDocs).toHaveLength(1);
    expect(commentDocs[0]).toEqual(
      expect.objectContaining({
        ticket_db_id: readyTaskId.toHexString(),
        ticket_public_id: 'READY-1',
        comment_kind: READY_ENRICHMENT_COMMENT_KIND,
        source_session_id: sessionId,
      })
    );
    expect(appendBdIssueNotesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'copilot-123',
        notes: expect.stringContaining('voice-ready-enrichment'),
      })
    );
    expect(tasksUpdateOne).toHaveBeenCalledTimes(1);
    expect(String(liveCodexTasks[0].notes || '')).toContain('voice-ready-enrichment');

    const second = await applyCreateTasksCompositeCommentSideEffects({
      db: db as never,
      sessionId,
      session,
      drafts,
      actorId: 'user-1',
      actorName: 'Valery',
    });

    expect(second).toEqual({
      insertedEnrichmentComments: 0,
      dedupedEnrichmentComments: 1,
      insertedCodexEnrichmentNotes: 0,
      dedupedCodexEnrichmentNotes: 1,
      unresolvedEnrichmentLookupIds: [],
    });
    expect(commentsInsertMany).toHaveBeenCalledTimes(1);
    expect(appendBdIssueNotesMock).toHaveBeenCalledTimes(1);
    expect(tasksUpdateOne).toHaveBeenCalledTimes(1);
  });
});
