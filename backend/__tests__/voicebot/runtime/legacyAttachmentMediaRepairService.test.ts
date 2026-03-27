import { describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';
import { repairLegacyAttachmentMediaProjection } from '../../../src/services/voicebot/legacyAttachmentMediaRepair.js';
import { VOICEBOT_COLLECTIONS } from '../../../src/constants.js';

type TestDoc = Record<string, unknown> & { _id: ObjectId };

const cloneDoc = (doc: TestDoc): TestDoc => {
  const serialized = JSON.stringify(doc, (_key, value) => {
    if (value instanceof ObjectId) return { __oid: value.toHexString() };
    return value;
  });
  return JSON.parse(serialized, (_key, value) => {
    if (value && typeof value === 'object' && '__oid' in value) {
      return new ObjectId(String((value as { __oid: string }).__oid));
    }
    return value;
  }) as TestDoc;
};

const normalizeObjectId = (value: unknown): ObjectId | null => {
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  if (value && typeof value === 'object' && typeof (value as { toHexString?: unknown }).toHexString === 'function') {
    const hex = String((value as { toHexString: () => string }).toHexString());
    if (ObjectId.isValid(hex)) return new ObjectId(hex);
  }
  if (!value || typeof value !== 'object') return null;
  const oid = (value as { __oid?: unknown }).__oid;
  if (typeof oid === 'string' && ObjectId.isValid(oid)) return new ObjectId(oid);
  return null;
};

const matchesObjectIdFilter = (docIdInput: unknown, clause: unknown): boolean => {
  const docId = normalizeObjectId(docIdInput);
  if (!docId) return false;
  if (clause instanceof ObjectId) {
    return docId.equals(clause);
  }
  if (!clause || typeof clause !== 'object') return true;
  const record = clause as Record<string, unknown>;
  if (Array.isArray(record.$in)) {
    const includes = record.$in.some((value) => {
      const candidate = normalizeObjectId(value);
      return candidate ? docId.equals(candidate) : false;
    });
    if (!includes) return false;
  }
  const gtObjectId = normalizeObjectId(record.$gt);
  if (gtObjectId) {
    if (!(docId.toHexString() > gtObjectId.toHexString())) return false;
  }
  return true;
};

const makeFakeDb = (seedDocs: TestDoc[]) => {
  const docs = seedDocs.map((doc) => cloneDoc(doc));
  const matchesTranscriptionTextClause = (
    value: unknown,
    clause: unknown
  ): boolean => {
    if (clause === null) return value == null;
    if (typeof clause === 'string') return String(value ?? '') === clause;
    if (!clause || typeof clause !== 'object') return true;
    const record = clause as Record<string, unknown>;
    if ('$in' in record && Array.isArray(record.$in)) {
      return record.$in.some((item) => matchesTranscriptionTextClause(value, item));
    }
    if ('$regex' in record && record.$regex instanceof RegExp) {
      return record.$regex.test(String(value ?? ''));
    }
    return true;
  };
  const collection = {
    find: (query: Record<string, unknown>) => {
      const filtered = docs.filter((doc) => {
        if (!matchesObjectIdFilter(doc._id, query._id)) return false;
        if (typeof query.transcription_method === 'string' && doc.transcription_method !== query.transcription_method) {
          return false;
        }
        if (query.session_id instanceof ObjectId && !(doc.session_id instanceof ObjectId && doc.session_id.equals(query.session_id))) {
          return false;
        }
        if ((query.is_deleted as { $ne?: unknown } | undefined)?.$ne === true && doc.is_deleted === true) {
          return false;
        }
        if (Array.isArray(query.$or)) {
          const matchesAnyOrClause = query.$or.some((clause) => {
            if (!clause || typeof clause !== 'object') return false;
            const record = clause as Record<string, unknown>;
            if (!Object.prototype.hasOwnProperty.call(record, 'transcription_text')) return false;
            return matchesTranscriptionTextClause(doc.transcription_text, record.transcription_text);
          });
          if (!matchesAnyOrClause) return false;
        }
        return true;
      });
      return {
        sort: () => ({
          limit: (count: number) => ({
            toArray: async () =>
              filtered
                .sort((a, b) => a._id.toHexString().localeCompare(b._id.toHexString()))
                .slice(0, count)
                .map((doc) => cloneDoc(doc)),
          }),
        }),
      };
    },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const target = docs.find((doc) => matchesObjectIdFilter(doc._id, filter._id));
      if (!target) return { modifiedCount: 0 };
      const setPatch = (update.$set && typeof update.$set === 'object') ? (update.$set as Record<string, unknown>) : {};
      const unsetPatch = (update.$unset && typeof update.$unset === 'object') ? (update.$unset as Record<string, unknown>) : {};
      Object.assign(target, setPatch);
      for (const key of Object.keys(unsetPatch)) {
        delete target[key];
      }
      return { modifiedCount: 1 };
    },
  };
  return {
    db: {
      collection: (name: string) => {
        if (name !== VOICEBOT_COLLECTIONS.MESSAGES) {
          throw new Error(`Unexpected collection: ${name}`);
        }
        return collection;
      },
    } as unknown,
    docs,
  };
};

describe('repairLegacyAttachmentMediaProjection', () => {
  it('scans and reports dry-run repairs without modifying records', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const { db, docs } = makeFakeDb([
      {
        _id: messageId,
        session_id: sessionId,
        message_type: 'document',
        source_type: 'telegram',
        attachments: [
          {
            kind: 'document',
            file_id: 'tg-file-1',
            file_unique_id: 'tg-uniq-1',
            name: 'recording.webm',
            mimeType: 'video/webm',
            size: 1234,
          },
        ],
        transcription_method: 'legacy_attachment',
        transcription_text: '',
        is_transcribed: false,
      },
    ]);

    const result = await repairLegacyAttachmentMediaProjection({
      db: db as never,
      apply: false,
      limit: 10,
      batchSize: 5,
      messageIds: [messageId.toHexString()],
      includeItems: false,
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('dry-run');
    expect(result.scanned_messages).toBe(1);
    expect(result.repair_candidates).toBe(1);
    expect(result.repaired).toBe(0);
    expect(docs[0]?.transcription_method).toBe('legacy_attachment');
    expect(Object.prototype.hasOwnProperty.call(docs[0] || {}, 'primary_payload_media_kind')).toBe(false);
  });

  it('applies repair and remains idempotent on repeated runs', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const { db, docs } = makeFakeDb([
      {
        _id: messageId,
        session_id: sessionId,
        message_type: 'document',
        source_type: 'telegram',
        attachments: [
          {
            kind: 'document',
            file_id: 'tg-file-2',
            file_unique_id: 'tg-uniq-2',
            name: 'meeting.webm',
            mimeType: 'audio/webm',
            size: 4567,
          },
        ],
        transcription_method: 'legacy_attachment',
        transcription_text: '',
        is_transcribed: false,
      },
    ]);

    const first = await repairLegacyAttachmentMediaProjection({
      db: db as never,
      apply: true,
      limit: 10,
      batchSize: 10,
      messageIds: [messageId.toHexString()],
      includeItems: false,
    });
    expect(first.repaired).toBe(1);
    expect(first.repair_candidates).toBe(1);
    expect(docs[0]?.primary_payload_media_kind).toBe('audio');
    expect(docs[0]?.classification_resolution_state).toBe('resolved');
    expect(docs[0]?.transcription_eligibility).toBe('eligible');
    expect(docs[0]?.transcription_processing_state).toBe('pending_transcription');
    expect(Object.prototype.hasOwnProperty.call(docs[0] || {}, 'transcription_method')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(docs[0] || {}, 'transcription_text')).toBe(false);

    const second = await repairLegacyAttachmentMediaProjection({
      db: db as never,
      apply: true,
      limit: 10,
      batchSize: 10,
      messageIds: [messageId.toHexString()],
      includeItems: false,
    });
    expect(second.repair_candidates).toBe(0);
    expect(second.repaired).toBe(0);
  });

  it('does not downgrade already-transcribed legacy attachment rows to pending classification', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const { db, docs } = makeFakeDb([
      {
        _id: messageId,
        session_id: sessionId,
        message_type: 'document',
        source_type: 'telegram',
        attachments: [
          {
            kind: 'document',
            payload_media_kind: 'audio',
            file_id: 'tg-file-3',
            file_unique_id: 'tg-uniq-3',
            name: 'already-transcribed.webm',
            mimeType: 'audio/webm',
            size: 6543,
          },
        ],
        transcription_method: 'legacy_attachment',
        transcription_text: 'existing transcript fact',
        is_transcribed: true,
        transcription_eligibility: 'eligible',
        classification_resolution_state: 'resolved',
        transcription_processing_state: 'transcribed',
      },
    ]);

    const result = await repairLegacyAttachmentMediaProjection({
      db: db as never,
      apply: true,
      limit: 10,
      batchSize: 10,
      messageIds: [messageId.toHexString()],
      includeItems: false,
    });

    expect(result.repaired).toBe(0);
    expect(result.repair_candidates).toBe(0);
    expect(docs[0]?.transcription_processing_state).toBe('transcribed');
    expect(docs[0]?.is_transcribed).toBe(true);
    expect(docs[0]?.transcription_text).toBe('existing transcript fact');
  });

  it('does not downgrade legacy attachment rows that already carry non-empty transcript text', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const { db, docs } = makeFakeDb([
      {
        _id: messageId,
        session_id: sessionId,
        message_type: 'document',
        source_type: 'telegram',
        attachments: [
          {
            kind: 'document',
            payload_media_kind: 'video',
            file_id: 'tg-file-4',
            file_unique_id: 'tg-uniq-4',
            name: 'legacy-transcript.webm',
            mimeType: 'video/webm',
            size: 7654,
          },
        ],
        transcription_method: 'legacy_attachment',
        transcription_text: 'already captured transcript',
        is_transcribed: false,
        transcription_eligibility: 'eligible',
        classification_resolution_state: 'resolved',
        transcription_processing_state: 'pending_transcription',
      },
    ]);

    const result = await repairLegacyAttachmentMediaProjection({
      db: db as never,
      apply: true,
      limit: 10,
      batchSize: 10,
      messageIds: [messageId.toHexString()],
      includeItems: false,
    });

    expect(result.repaired).toBe(0);
    expect(result.repair_candidates).toBe(0);
    expect(docs[0]?.transcription_processing_state).toBe('pending_transcription');
    expect(docs[0]?.transcription_text).toBe('already captured transcript');
    expect(docs[0]?.transcription_eligibility).toBe('eligible');
  });

  it('includes whitespace-only legacy transcription placeholders into repair scan', async () => {
    const sessionId = new ObjectId();
    const messageId = new ObjectId();
    const { db, docs } = makeFakeDb([
      {
        _id: messageId,
        session_id: sessionId,
        message_type: 'document',
        source_type: 'telegram',
        attachments: [
          {
            kind: 'document',
            file_id: 'tg-file-5',
            file_unique_id: 'tg-uniq-5',
            name: 'whitespace-placeholder.webm',
            mimeType: 'audio/webm',
            size: 9988,
          },
        ],
        transcription_method: 'legacy_attachment',
        transcription_text: '   ',
        is_transcribed: false,
      },
    ]);

    const result = await repairLegacyAttachmentMediaProjection({
      db: db as never,
      apply: true,
      limit: 10,
      batchSize: 10,
      messageIds: [messageId.toHexString()],
      includeItems: false,
    });

    expect(result.scanned_messages).toBe(1);
    expect(result.repair_candidates).toBe(1);
    expect(result.repaired).toBe(1);
    expect(docs[0]?.primary_payload_media_kind).toBe('audio');
    expect(Object.prototype.hasOwnProperty.call(docs[0] || {}, 'transcription_method')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(docs[0] || {}, 'transcription_text')).toBe(false);
  });
});
