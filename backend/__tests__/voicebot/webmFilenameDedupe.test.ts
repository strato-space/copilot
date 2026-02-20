import { describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';
import {
  buildSessionWebmDedupePlan,
  selectRelevantMessage,
  type VoicebotMessageDoc,
} from '../../src/services/voicebotWebmDedup.js';

const buildMessage = (overrides: Partial<VoicebotMessageDoc> = {}): VoicebotMessageDoc => {
  const now = new Date('2026-02-19T10:00:00.000Z');
  return {
    _id: new ObjectId(),
    session_id: new ObjectId('6996dacdff0189e621a4cc13'),
    source_type: 'web',
    file_name: '012-2.webm',
    transcription_text: '',
    categorization: [],
    is_transcribed: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
};

describe('voicebotWebmDedup', () => {
  it('selects message with real transcription and categorization over empty retries', () => {
    const rich = buildMessage({
      _id: new ObjectId('6996e0000000000000000001'),
      transcription_text: 'Привет, это валидная транскрибация',
      categorization: [{ text: 'категория 1' }],
      is_transcribed: true,
      created_at: new Date('2026-02-19T10:00:00.000Z'),
      updated_at: new Date('2026-02-19T10:05:00.000Z'),
    });
    const emptyRetry = buildMessage({
      _id: new ObjectId('6996e0000000000000000002'),
      transcription_text: '',
      categorization: [],
      is_transcribed: false,
      created_at: new Date('2026-02-19T10:10:00.000Z'),
      updated_at: new Date('2026-02-19T10:12:00.000Z'),
    });

    const winner = selectRelevantMessage([emptyRetry, rich]);
    expect(winner?._id.toString()).toBe(rich._id.toString());
  });

  it('builds dedupe plan by webm file_name and skips telegram messages', () => {
    const sessionId = new ObjectId('6996dacdff0189e621a4cc13');
    const winner = buildMessage({
      _id: new ObjectId('6996e0000000000000000011'),
      file_name: '012-2.webm',
      transcription_text: 'Primary transcript',
      is_transcribed: true,
    });
    const duplicate = buildMessage({
      _id: new ObjectId('6996e0000000000000000012'),
      file_name: '012-2.webm',
      transcription_text: '',
      is_transcribed: false,
    });
    const telegramSameName = buildMessage({
      _id: new ObjectId('6996e0000000000000000013'),
      source_type: 'telegram',
      file_name: '012-2.webm',
      transcription_text: 'Telegram chunk',
      is_transcribed: true,
    });
    const otherFile = buildMessage({
      _id: new ObjectId('6996e0000000000000000014'),
      file_name: '013-1.webm',
      transcription_text: 'Other file',
      is_transcribed: true,
    });
    const nonWebm = buildMessage({
      _id: new ObjectId('6996e0000000000000000015'),
      file_name: 'note.txt',
      transcription_text: 'Not webm',
      is_transcribed: true,
    });

    const plan = buildSessionWebmDedupePlan(sessionId, [
      winner,
      duplicate,
      telegramSameName,
      otherFile,
      nonWebm,
    ]);

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({
      session_id: sessionId.toString(),
      file_name: '012-2.webm',
      winner_id: winner._id.toString(),
      duplicate_ids: [duplicate._id.toString()],
    });
    expect(plan.scanned_messages).toBe(5);
    expect(plan.candidate_messages).toBe(3);
  });
});
