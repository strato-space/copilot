import { describe, expect, it, jest } from '@jest/globals';
import { ObjectId, type Db } from 'mongodb';

import { COLLECTIONS } from '../../src/constants.js';
import {
  handleCodexReviewCallback,
  parseCodexReviewCallbackData,
} from '../../src/voicebot_tgbot/codexReviewCallbacks.js';

type TaskRecord = {
  _id: ObjectId;
  id?: unknown;
  issue_id?: unknown;
  codex_issue_id?: unknown;
  codex_review_state?: unknown;
};

const createDb = (task: TaskRecord | null, matchedCount = 1) => {
  const findOne = jest.fn(async () => task);
  const updateOne = jest.fn(async () => ({ matchedCount, modifiedCount: matchedCount }));
  const db = {
    collection: (name: string) => {
      if (name === COLLECTIONS.TASKS) {
        return {
          findOne,
          updateOne,
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  } as unknown as Db;
  return { db, findOne, updateOne };
};

describe('codexReviewCallbacks', () => {
  it('parses callback payload with action and task id', () => {
    expect(parseCodexReviewCallbackData('cdr:start:65f5f87cfb4b31f8f6e09f1a')).toEqual({
      action: 'start',
      taskId: '65f5f87cfb4b31f8f6e09f1a',
    });
    expect(parseCodexReviewCallbackData('unknown:data')).toBeNull();
  });

  it('opens issue and clears deferred review state for Start action', async () => {
    const taskId = new ObjectId();
    const now = new Date('2026-02-28T01:00:00.000Z');
    const { db, updateOne } = createDb({
      _id: taskId,
      id: 'copilot-a1b2',
      codex_review_state: 'deferred',
    });
    const runBdUpdate = jest.fn(async () => undefined);

    const result = await handleCodexReviewCallback({
      db,
      callbackData: `cdr:start:${taskId.toHexString()}`,
      telegramUserId: '555777',
      now: () => now,
      runBdUpdate,
    });

    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        ok: true,
        action: 'start',
        task_id: taskId.toHexString(),
        removeKeyboard: true,
      })
    );
    expect(runBdUpdate).toHaveBeenCalledWith({
      issueId: 'copilot-a1b2',
      status: 'open',
    });

    const updateDoc = updateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = updateDoc.$set as Record<string, unknown>;
    const unsetPayload = updateDoc.$unset as Record<string, unknown>;
    expect(setPayload.codex_review_state).toBe('done');
    expect(setPayload.codex_review_decision).toBe('start');
    expect(setPayload.codex_review_decided_by_telegram_id).toBe('555777');
    expect(unsetPayload.codex_review_due_at).toBe(1);
  });

  it('closes issue with canceled note for Cancel action', async () => {
    const taskId = new ObjectId();
    const { db, updateOne } = createDb({
      _id: taskId,
      issue_id: 'copilot-z9x8',
      codex_review_state: 'deferred',
    });
    const runBdUpdate = jest.fn(async () => undefined);

    const result = await handleCodexReviewCallback({
      db,
      callbackData: `cdr:cancel:${taskId.toHexString()}`,
      runBdUpdate,
    });

    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        ok: true,
        action: 'cancel',
        task_id: taskId.toHexString(),
        removeKeyboard: true,
      })
    );
    expect(runBdUpdate).toHaveBeenCalledWith({
      issueId: 'copilot-z9x8',
      status: 'closed',
      appendNotes: 'canceled by user',
    });

    const updateDoc = updateOne.mock.calls[0]?.[1] as Record<string, unknown>;
    const setPayload = updateDoc.$set as Record<string, unknown>;
    expect(setPayload.codex_review_state).toBe('canceled');
    expect(setPayload.codex_review_decision).toBe('cancel');
  });

  it('returns not handled for callback payload that does not belong to deferred review', async () => {
    const { db, updateOne } = createDb(null);
    const runBdUpdate = jest.fn(async () => undefined);

    const result = await handleCodexReviewCallback({
      db,
      callbackData: 'not-supported',
      runBdUpdate,
    });

    expect(result).toEqual({
      handled: false,
      ok: false,
      text: '',
    });
    expect(runBdUpdate).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
