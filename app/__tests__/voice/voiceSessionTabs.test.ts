import {
  countVisibleCategorizationGroups,
  countVisibleTranscriptionMessages,
  hasPendingCategorizationMessages,
  hasPendingPossibleTasksRefresh,
  hasPendingTranscriptionMessages,
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

  it('tracks pending possible-tasks refresh by CREATE_TASKS processing state or newer auto_requested_at', () => {
    const messages = [{ _id: '1', transcription_text: 'need a task' }] as VoiceBotMessage[];
    const processingSession = {
      processors_data: {
        CREATE_TASKS: {
          is_processing: true,
        },
      },
    } as VoiceBotSession;
    const staleSession = {
      processors_data: {
        CREATE_TASKS: {
          auto_requested_at: 200,
          job_finished_timestamp: 100,
        },
      },
    } as VoiceBotSession;
    const settledSession = {
      processors_data: {
        CREATE_TASKS: {
          auto_requested_at: 100,
          job_finished_timestamp: 200,
        },
      },
    } as VoiceBotSession;

    expect(hasPendingPossibleTasksRefresh(processingSession, messages)).toBe(true);
    expect(hasPendingPossibleTasksRefresh(staleSession, messages)).toBe(true);
    expect(hasPendingPossibleTasksRefresh(settledSession, messages)).toBe(false);
  });

  it('treats transcript presence without CREATE_TASKS processor snapshot as pending possible-tasks refresh', () => {
    const messages = [{ _id: '1', transcription_text: 'need a task' }] as VoiceBotMessage[];
    expect(hasPendingPossibleTasksRefresh(null, messages)).toBe(true);
  });
});
