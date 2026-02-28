import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { COLLECTIONS } from '../../src/constants.js';

const getDbMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

const { handleCodexDeferredReviewJob } = await import(
  '../../src/workers/voicebot/handlers/codexDeferredReview.js'
);

describe('handleCodexDeferredReviewJob', () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it('claims deferred codex task and persists generated summary', async () => {
    const taskId = new ObjectId();
    const updateOne = jest
      .fn()
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
    const findOne = jest.fn(async () => ({
      _id: taskId,
      id: 'copilot-ab12',
      name: 'Собрать релизную заметку',
      description: 'Подготовить и проверить финальный текст клиентского релиза.',
      codex_review_state: 'deferred',
    }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            updateOne,
            findOne,
          };
        }
        return {};
      },
    });

    const runReview = jest.fn(async () => ({
      summary: 'Короткое резюме для клиента по задаче релиза.',
      source: 'codex_cli',
    }));
    const loadIssue = jest.fn(async () => ({ id: 'copilot-ab12', title: 'Issue' }));
    const appendIssueSummaryNote = jest.fn(async () => ({
      appended: true,
      marker: `[codex-deferred-review:${taskId.toHexString()}]`,
      note: 'review note',
    }));
    const sendTelegramApprovalCard = jest.fn(async () => ({
      chat_id: '-1002820582847',
      thread_id: 11091,
      message_id: 557,
      callback_start: `cdr:start:${taskId.toHexString()}`,
      callback_cancel: `cdr:cancel:${taskId.toHexString()}`,
    }));

    const result = await handleCodexDeferredReviewJob(
      {
        task_id: taskId.toHexString(),
        job_id: 'task-review-job',
      },
      {
        runReview,
        loadIssue,
        loadPromptCard: async () => ({
          text: 'review prompt card',
          path: '/tmp/card.md',
        }),
        appendIssueSummaryNote,
        sendTelegramApprovalCard,
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        task_id: taskId.toHexString(),
        issue_id: 'copilot-ab12',
        source: 'codex_cli',
      })
    );

    expect(loadIssue).toHaveBeenCalledWith('copilot-ab12');
    expect(runReview).toHaveBeenCalledTimes(1);
    expect(appendIssueSummaryNote).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'copilot-ab12',
        summary: 'Короткое резюме для клиента по задаче релиза.',
      })
    );
    expect(sendTelegramApprovalCard).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 'copilot-ab12',
        summary: 'Короткое резюме для клиента по задаче релиза.',
      })
    );

    const completionCall = updateOne.mock.calls[1];
    expect(completionCall).toBeDefined();
    const completionUpdate = completionCall?.[1] as Record<string, unknown>;
    const setPayload = completionUpdate.$set as Record<string, unknown>;
    expect(setPayload.codex_review_summary).toBe('Короткое резюме для клиента по задаче релиза.');
    expect(setPayload.codex_review_summary_source).toBe('codex_cli');
    expect(setPayload.codex_review_summary_processing).toBe(false);
    expect(setPayload.codex_review_summary_note_marker).toBe(`[codex-deferred-review:${taskId.toHexString()}]`);
    expect(setPayload.codex_review_approval_card_chat_id).toBe('-1002820582847');
    expect(setPayload.codex_review_approval_card_message_id).toBe(557);
  });

  it('falls back to task fields when codex runner fails', async () => {
    const taskId = new ObjectId();
    const updateOne = jest
      .fn()
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
    const findOne = jest.fn(async () => ({
      _id: taskId,
      id: 'codex-1234',
      name: 'Prepare onboarding flow',
      description: 'Align docs and UI steps for the new onboarding rollout.',
      codex_review_state: 'deferred',
    }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            updateOne,
            findOne,
          };
        }
        return {};
      },
    });

    const result = await handleCodexDeferredReviewJob(
      {
        task_id: taskId.toHexString(),
      },
      {
        runReview: async () => {
          throw new Error('codex runner unavailable');
        },
        loadPromptCard: async () => ({
          text: 'review prompt card',
          path: '/tmp/card.md',
        }),
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        task_id: taskId.toHexString(),
        source: 'fallback_task_fields',
      })
    );
    expect(typeof result.summary).toBe('string');
    expect((result.summary || '').length).toBeGreaterThan(10);

    const completionCall = updateOne.mock.calls[1];
    const completionUpdate = completionCall?.[1] as Record<string, unknown>;
    const setPayload = completionUpdate.$set as Record<string, unknown>;
    expect(setPayload.codex_review_summary_source).toBe('fallback_task_fields');
    expect(setPayload.codex_review_summary_processing).toBe(false);
  });

  it('returns error for invalid task id', async () => {
    const result = await handleCodexDeferredReviewJob({ task_id: 'not-an-object-id' });
    expect(result).toEqual({ ok: false, error: 'invalid_task_id' });
  });

  it('skips when task cannot be claimed for review', async () => {
    const taskId = new ObjectId();
    const updateOne = jest.fn().mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === COLLECTIONS.TASKS) {
          return {
            updateOne,
            findOne: jest.fn(),
          };
        }
        return {};
      },
    });

    const result = await handleCodexDeferredReviewJob({ task_id: taskId.toHexString() });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        task_id: taskId.toHexString(),
        skipped: true,
        reason: 'not_due_or_already_processed',
      })
    );
  });
});
