import {
  countVisibleCategorizationGroups,
  countVisibleTranscriptionMessages,
  hasPendingCategorizationMessages,
  hasPendingPossibleTasksRefresh,
  hasPendingTranscriptionMessages,
  isSessionRuntimeActive,
} from '../../src/utils/voiceSessionTabs';
import type { VoiceBotMessage, VoiceBotSession, VoiceMessageGroup } from '../../src/types/voice';

describe('voiceSessionTabs utilities', () => {
  it('counts only visible transcription messages and categorization groups', () => {
    const messages = [
      { _id: '1', transcription_text: 'hello' },
      { _id: '2', is_deleted: true, transcription_text: 'hidden' },
      { _id: '3', file_name: 'chunk.webm', to_transcribe: true },
    ] as VoiceBotMessage[];
    const groups = [
      { rows: [{ text: 'row text' }], materials: [] },
      { rows: [], materials: [{ imageUrl: 'https://example.com/1.png' }] },
      { rows: [{ text: '   ' }], materials: [] },
    ] as VoiceMessageGroup[];

    expect(countVisibleTranscriptionMessages(messages)).toBe(2);
    expect(countVisibleCategorizationGroups(groups)).toBe(2);
  });

  it('tracks pending transcription and categorization by message stage', () => {
    const messages = [
      { _id: '1', file_name: 'chunk.webm', to_transcribe: true },
      { _id: '2', transcription_text: 'ready for categorization' },
      {
        _id: '3',
        transcription_text: 'already categorized',
        categorization: [],
      },
    ] as VoiceBotMessage[];

    expect(hasPendingTranscriptionMessages(messages)).toBe(true);
    expect(hasPendingCategorizationMessages(messages)).toBe(true);
  });

  it('tracks pending possible-tasks refresh by CREATE_TASKS processing state or newer fresh auto_requested_at', () => {
    const now = Date.now();
    const messages = [{ _id: '1', transcription_text: 'need a task' }] as VoiceBotMessage[];
    const processingSession = {
      processors_data: {
        CREATE_TASKS: {
          is_processing: true,
        },
      },
    } as VoiceBotSession;
    const freshPendingSession = {
      processors_data: {
        CREATE_TASKS: {
          auto_requested_at: now - 5 * 60 * 1000,
          job_finished_timestamp: now - 10 * 60 * 1000,
        },
      },
    } as VoiceBotSession;
    const stalePendingSession = {
      processors_data: {
        CREATE_TASKS: {
          auto_requested_at: now - 40 * 60 * 1000,
          job_finished_timestamp: now - 50 * 60 * 1000,
        },
      },
    } as VoiceBotSession;
    const settledSession = {
      processors_data: {
        CREATE_TASKS: {
          auto_requested_at: now - 10 * 60 * 1000,
          job_finished_timestamp: now - 5 * 60 * 1000,
        },
      },
    } as VoiceBotSession;

    expect(hasPendingPossibleTasksRefresh(processingSession, messages)).toBe(true);
    expect(hasPendingPossibleTasksRefresh(freshPendingSession, messages)).toBe(true);
    expect(hasPendingPossibleTasksRefresh(stalePendingSession, messages)).toBe(false);
    expect(hasPendingPossibleTasksRefresh(settledSession, messages)).toBe(false);
  });

  it('keeps possible-tasks pending when CREATE_TASKS is processing even before transcript rows hydrate locally', () => {
    const messages = [] as VoiceBotMessage[];
    const processingSession = {
      processors_data: {
        CREATE_TASKS: {
          is_processing: true,
        },
      },
    } as VoiceBotSession;

    expect(hasPendingPossibleTasksRefresh(processingSession, messages)).toBe(true);
  });

  it('does not keep possible-tasks pending forever when transcript exists but CREATE_TASKS snapshot is absent', () => {
    const messages = [{ _id: '1', transcription_text: 'need a task' }] as VoiceBotMessage[];
    expect(hasPendingPossibleTasksRefresh(null, messages)).toBe(false);
  });

  it('turns off pending indicators for closed or inactive sessions even with historical incomplete payload', () => {
    const messages = [
      { _id: '1', file_name: 'chunk.webm', to_transcribe: true },
      { _id: '2', transcription_text: 'text without categorization' },
    ] as VoiceBotMessage[];
    const inactiveSession = {
      _id: 's-1',
      is_active: false,
      done_at: '2026-03-22T10:00:00.000Z',
    } as VoiceBotSession;

    expect(isSessionRuntimeActive(inactiveSession)).toBe(false);
    expect(hasPendingTranscriptionMessages(messages, inactiveSession)).toBe(false);
    expect(hasPendingCategorizationMessages(messages, inactiveSession)).toBe(false);
    expect(hasPendingPossibleTasksRefresh(inactiveSession, messages)).toBe(false);
  });

  it('keeps pending indicators for active runtime sessions', () => {
    const messages = [{ _id: '1', file_name: 'chunk.webm', to_transcribe: true }] as VoiceBotMessage[];
    const activeSession = {
      _id: 's-2',
      is_active: true,
    } as VoiceBotSession;

    expect(isSessionRuntimeActive(activeSession)).toBe(true);
    expect(hasPendingTranscriptionMessages(messages, activeSession)).toBe(true);
    expect(hasPendingCategorizationMessages(messages, activeSession)).toBe(true);
    expect(hasPendingPossibleTasksRefresh(activeSession, messages)).toBe(true);
  });
});
