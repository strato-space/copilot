import { describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../../src/constants.js';
import {
  buildDoneNotifyPreview,
  writeSummaryAuditLog,
  writeDoneNotifyRequestedLog,
} from '../../../src/services/voicebot/voicebotDoneNotify.js';

describe('voicebotDoneNotify service', () => {
  it('builds telegram preview with 4-line message', async () => {
    const projectId = new ObjectId();
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.PROJECTS) {
          return {
            findOne: async () => ({ _id: projectId, name: 'PMO' }),
          };
        }
        return { findOne: async () => null };
      },
    } as any;

    const preview = await buildDoneNotifyPreview({
      db,
      session: {
        _id: new ObjectId(),
        session_name: 'Session A',
        project_id: projectId,
      },
      eventName: 'Сессия завершена',
    });

    expect(preview.event_name).toBe('Сессия завершена');
    expect(preview.telegram_message.split('\n')).toHaveLength(4);
  });

  it('writes notify_requested session log with source-derived rest metadata', async () => {
    const findOne = jest.fn(async () => null);
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    await writeDoneNotifyRequestedLog({
      db,
      session_id: new ObjectId(),
      session: { _id: new ObjectId(), session_name: 'S' },
      actor: { type: 'performer', performer_id: 'u1' },
      source: { type: 'rest', route: '/api/voicebot/session_done', method: 'POST' },
      preview: {
        event_name: 'Сессия завершена',
        telegram_message: 'line1\nline2\nline3\nline4',
      },
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const [doc] = insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(doc.event_name).toBe('notify_requested');
    const metadata = doc.metadata as Record<string, unknown>;
    expect(metadata.notify_event).toBe(VOICEBOT_JOBS.notifies.SESSION_DONE);
    expect(metadata.telegram_message).toBe('line1\nline2\nline3\nline4');
    expect(metadata.source).toBe('rest_session_done');
  });

  it('writes notify_requested session log with queue metadata for done_multiprompt worker', async () => {
    const findOne = jest.fn(async () => null);
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    await writeDoneNotifyRequestedLog({
      db,
      session_id: new ObjectId(),
      session: { _id: new ObjectId(), session_name: 'S' },
      actor: { type: 'worker', worker: 'done_multiprompt' },
      source: { type: 'queue', queue: 'voicebot--common', job: 'DONE_MULTIPROMPT' },
      preview: {
        event_name: 'Сессия завершена',
        telegram_message: 'line1\nline2\nline3\nline4',
      },
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    const [doc] = insertOne.mock.calls[0] as [Record<string, unknown>];
    const metadata = doc.metadata as Record<string, unknown>;
    expect(metadata.source).toBe('queue_done_multiprompt');
  });

  it('writes summary_telegram_send audit record with correlation id and idempotency key', async () => {
    const sessionId = new ObjectId();
    const findOne = jest.fn(async () => null);
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    await writeSummaryAuditLog({
      db,
      session_id: sessionId,
      session: { _id: sessionId },
      event_name: 'summary_telegram_send',
      status: 'queued',
      correlation_id: 'corr-1',
      idempotency_key: 'idem-1',
      metadata: { source: 'done_multiprompt_auto' },
    });

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: sessionId,
        event_name: 'summary_telegram_send',
        correlation_id: 'corr-1',
        'metadata.idempotency_key': 'idem-1',
      }),
      expect.any(Object)
    );
    expect(insertOne).toHaveBeenCalledTimes(1);
    const [doc] = insertOne.mock.calls[0] as [Record<string, unknown>];
    expect(doc.event_name).toBe('summary_telegram_send');
    expect(doc.correlation_id).toBe('corr-1');
    expect(doc.status).toBe('queued');
    expect((doc.metadata as Record<string, unknown>).idempotency_key).toBe('idem-1');
  });

  it('keeps summary audit writes idempotent by correlation_id + idempotency_key', async () => {
    const sessionId = new ObjectId();
    const existingId = new ObjectId();
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: existingId, status: 'pending' });
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 0 }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne, updateOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    await writeSummaryAuditLog({
      db,
      session_id: sessionId,
      session: { _id: sessionId },
      event_name: 'summary_save',
      status: 'pending',
      correlation_id: 'corr-2',
      idempotency_key: 'idem-2',
      metadata: { source: 'done_multiprompt_auto' },
    });
    await writeSummaryAuditLog({
      db,
      session_id: sessionId,
      session: { _id: sessionId },
      event_name: 'summary_save',
      status: 'pending',
      correlation_id: 'corr-2',
      idempotency_key: 'idem-2',
      metadata: { source: 'done_multiprompt_auto' },
    });

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('upgrades existing summary_save audit status from pending to done for the same idempotency key', async () => {
    const sessionId = new ObjectId();
    const existingId = new ObjectId();
    const findOne = jest.fn(async () => ({
      _id: existingId,
      status: 'pending',
      metadata: { idempotency_key: 'idem-3', source: 'done_multiprompt_auto' },
    }));
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne, updateOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    await writeSummaryAuditLog({
      db,
      session_id: sessionId,
      session: { _id: sessionId },
      event_name: 'summary_save',
      status: 'done',
      correlation_id: 'corr-3',
      idempotency_key: 'idem-3',
      metadata: { source: 'voicebot_save_summary_route', summary_chars: 10 },
    });

    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).toHaveBeenCalledWith(
      { _id: existingId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'done',
          metadata: expect.objectContaining({
            idempotency_key: 'idem-3',
            source: 'voicebot_save_summary_route',
            summary_chars: 10,
          }),
        }),
      })
    );
  });

  it('does not downgrade existing failed summary_telegram_send audit to done for the same idempotency key', async () => {
    const sessionId = new ObjectId();
    const existingId = new ObjectId();
    const findOne = jest.fn(async () => ({
      _id: existingId,
      status: 'failed',
      metadata: { idempotency_key: 'idem-4', source: 'notify_worker', reason: 'notify_hook_exit_non_zero' },
    }));
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne, updateOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    const result = await writeSummaryAuditLog({
      db,
      session_id: sessionId,
      session: { _id: sessionId },
      event_name: 'summary_telegram_send',
      status: 'done',
      correlation_id: 'corr-4',
      idempotency_key: 'idem-4',
      metadata: { source: 'notify_worker', semantic_ack_reason: 'json_ack' },
    });

    expect(result.status).toBe('failed');
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('does not downgrade existing done summary_save audit to pending for the same idempotency key', async () => {
    const sessionId = new ObjectId();
    const existingId = new ObjectId();
    const findOne = jest.fn(async () => ({
      _id: existingId,
      status: 'done',
      metadata: { idempotency_key: 'idem-5', source: 'voicebot_save_summary_route' },
    }));
    const insertOne = jest.fn(async () => ({ insertedId: new ObjectId() }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const db = {
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSION_LOG) {
          return { findOne, insertOne, updateOne };
        }
        return { findOne: async () => null };
      },
    } as any;

    const result = await writeSummaryAuditLog({
      db,
      session_id: sessionId,
      session: { _id: sessionId },
      event_name: 'summary_save',
      status: 'pending',
      correlation_id: 'corr-5',
      idempotency_key: 'idem-5',
      metadata: { source: 'project_update_after_done' },
    });

    expect(result.status).toBe('done');
    expect(insertOne).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });
});
