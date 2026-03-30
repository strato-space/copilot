import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import TranscriptionTableRow from '../../src/components/voice/TranscriptionTableRow';
import type { VoiceBotMessage } from '../../src/types/voice';
import { formatVoiceMetadataSignature } from '../../src/utils/voiceMetadataSignature';

const mockVoiceBotStoreState = {
  voiceBotSession: { _id: 'session-1' },
  fetchVoiceBotSession: jest.fn(async () => undefined),
  fetchSessionLog: jest.fn(async () => undefined),
  editTranscriptChunk: jest.fn(async () => undefined),
  deleteTranscriptChunk: jest.fn(async () => undefined),
};

const mockSessionsUiStoreState = {
  materialTargetMessageId: null as string | null,
  setMaterialTargetMessageId: jest.fn(),
};

jest.mock('../../src/store/voiceBotStore', () => ({
  useVoiceBotStore: (selector: (state: typeof mockVoiceBotStoreState) => unknown) => selector(mockVoiceBotStoreState),
}));

jest.mock('../../src/store/sessionsUIStore', () => ({
  useSessionsUIStore: (selector: (state: typeof mockSessionsUiStoreState) => unknown) =>
    selector(mockSessionsUiStoreState),
}));

type RenderHandle = {
  container: HTMLDivElement;
  rerender: (nextNode: ReactElement) => void;
  unmount: () => void;
};

const renderIntoDom = (node: ReactElement): RenderHandle => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    rerender: (nextNode: ReactElement) => {
      act(() => {
        root.render(nextNode);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const asVoiceMessage = (patch: Partial<VoiceBotMessage>): VoiceBotMessage =>
  ({
    _id: 'msg-1',
    message_id: 'msg-1',
    ...patch,
  }) as VoiceBotMessage;

describe('Transcription fallback error signature contract', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      writable: true,
      value: true,
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });

    class ResizeObserverMock {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      writable: true,
      value: ResizeObserverMock,
    });
  });

  afterEach(() => {
    mockVoiceBotStoreState.fetchVoiceBotSession.mockClear();
    mockVoiceBotStoreState.fetchSessionLog.mockClear();
    mockVoiceBotStoreState.editTranscriptChunk.mockClear();
    mockVoiceBotStoreState.deleteTranscriptChunk.mockClear();
    mockSessionsUiStoreState.setMaterialTargetMessageId.mockClear();
  });

  it('shows fallback error text and metadata signature for transcription errors without plain text/transcription text', () => {
    const messageTimestampMs = 1710000015000;
    const sessionBaseTimestampMs = 1710000000000;
    const row = asVoiceMessage({
      file_name: 'call-42.mp3',
      message_timestamp: messageTimestampMs,
      transcription_error: 'insufficient_quota',
      text: '',
      transcription_text: '',
    });

    const expectedSignature = formatVoiceMetadataSignature({
      startSeconds: (messageTimestampMs - sessionBaseTimestampMs) / 1000,
      endSeconds: (messageTimestampMs - sessionBaseTimestampMs) / 1000,
      sourceFileName: 'call-42.mp3',
      absoluteTimestampMs: messageTimestampMs,
      omitZeroRange: false,
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs,
      })
    );

    try {
      expect(view.container.textContent).toContain('⚠ Недостаточно квоты OpenAI');
      expect(expectedSignature).not.toBeNull();
      expect(view.container.textContent).toContain(expectedSignature as string);
    } finally {
      view.unmount();
    }
  });

  it('short-circuits to plain text and hides fallback error signature when row.text is present', () => {
    const row = asVoiceMessage({
      file_name: 'call-43.mp3',
      message_timestamp: 1710000055000,
      transcription_error: 'insufficient_quota',
      text: 'Текст оператора важнее fallback',
      transcription_text: '',
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs: 1710000000000,
      })
    );

    try {
      expect(view.container.textContent).toContain('Текст оператора важнее fallback');
      expect(view.container.textContent).not.toContain('⚠ Недостаточно квоты OpenAI');
      expect(view.container.textContent).not.toContain('call-43.mp3');
    } finally {
      view.unmount();
    }
  });

  it('prioritizes transcription_text over plain text/error placeholders for in-place websocket updates', () => {
    const row = asVoiceMessage({
      transcription_text: 'Готовая транскрипция из websocket',
      text: 'Старый placeholder',
      transcription_error: 'insufficient_quota',
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs: null,
      })
    );

    try {
      expect(view.container.textContent).toContain('Готовая транскрипция из websocket');
      expect(view.container.textContent).not.toContain('Старый placeholder');
      expect(view.container.textContent).not.toContain('⚠ Недостаточно квоты OpenAI');
    } finally {
      view.unmount();
    }
  });

  it('keeps non-error fallback states user-visible for processing/transcribed/waiting paths', () => {
    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row: asVoiceMessage({ to_transcribe: true }),
        isLast: false,
        sessionBaseTimestampMs: null,
      })
    );

    try {
      expect(view.container.textContent).toContain('⏳ Обработка аудио...');

      view.rerender(
        React.createElement(TranscriptionTableRow, {
          row: asVoiceMessage({ is_transcribed: true, to_transcribe: false }),
          isLast: false,
          sessionBaseTimestampMs: null,
        })
      );
      expect(view.container.textContent).toContain('—');

      view.rerender(
        React.createElement(TranscriptionTableRow, {
          row: asVoiceMessage({ is_transcribed: false, to_transcribe: false }),
          isLast: false,
          sessionBaseTimestampMs: null,
        })
      );
      expect(view.container.textContent).toContain('⏳ Ожидание транскрибации...');
    } finally {
      view.unmount();
    }
  });

  it('keeps operator-visible rows free from projection/debug metadata clutter', () => {
    const row = asVoiceMessage({
      transcription: {
        segments: [{ id: 'ch_1', text: 'Основной текст транскрипта', is_deleted: false }],
      } as VoiceBotMessage['transcription'],
      transcription_processing_state: 'transcribed',
      primary_payload_media_kind: 'binary_document',
      classification_resolution_state: 'classified_skip',
      transcription_eligibility: 'eligible',
      transcription_eligibility_basis: 'legacy_transport_presence',
      classification_rule_ref: 'rule://test',
      source_note_text: 'debug-note',
      primary_transcription_attachment_index: 0,
      attachments: [
        {
          attachment_index: 0,
          payload_media_kind: 'binary_document',
          transcription_processing_state: 'transcribed',
          classification_resolution_state: 'classified_skip',
          transcription_eligibility: 'eligible',
        },
      ],
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs: null,
      })
    );

    try {
      expect(view.container.textContent).toContain('Основной текст транскрипта');
      expect(view.container.textContent).not.toContain('State:');
      expect(view.container.textContent).not.toContain('classification:');
      expect(view.container.textContent).not.toContain('primary attachment:');
      expect(view.container.textContent).not.toContain('Eligibility basis:');
      expect(view.container.textContent).not.toContain('Rule ref:');
      expect(view.container.textContent).not.toContain('Source note:');
      expect(view.container.textContent).not.toContain('Attachments (');
      expect(view.container.textContent).not.toContain('legacy_transport_presence');
    } finally {
      view.unmount();
    }
  });

  it('keeps actionable skip/error information visible when present', () => {
    const row = asVoiceMessage({
      transcription: {
        segments: [{ id: 'ch_1', text: 'Текст с проблемой', is_deleted: false }],
      } as VoiceBotMessage['transcription'],
      transcription_skip_reason: 'unsupported_payload_class',
      transcription_error: 'insufficient_quota',
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs: null,
      })
    );

    try {
      expect(view.container.textContent).toContain('Skip reason:');
      expect(view.container.textContent).toContain('Unsupported payload class');
      expect(view.container.textContent).toContain('Error:');
      expect(view.container.textContent).toContain('Недостаточно квоты OpenAI');
    } finally {
      view.unmount();
    }
  });

  it('keeps attachment-only transcription errors visible when transcript body is otherwise empty', () => {
    const row = asVoiceMessage({
      transcription: { segments: [] } as VoiceBotMessage['transcription'],
      attachments: [
        {
          attachment_index: 0,
          transcription_error: 'invalid_api_key',
        },
      ],
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs: null,
      })
    );

    try {
      expect(view.container.textContent).toContain('Неверный OpenAI API key');
      expect(view.container.textContent).not.toContain('State:');
      expect(view.container.textContent).not.toContain('Eligibility basis:');
    } finally {
      view.unmount();
    }
  });

  it('keeps attachment-only skip reasons visible when transcript body is otherwise empty', () => {
    const row = asVoiceMessage({
      transcription: { segments: [] } as VoiceBotMessage['transcription'],
      attachments: [
        {
          attachment_index: 0,
          transcription_skip_reason: 'unsupported_payload_class',
        },
      ],
    });

    const view = renderIntoDom(
      React.createElement(TranscriptionTableRow, {
        row,
        isLast: false,
        sessionBaseTimestampMs: null,
      })
    );

    try {
      expect(view.container.textContent).toContain('Skip reason:');
      expect(view.container.textContent).toContain('Unsupported payload class');
    } finally {
      view.unmount();
    }
  });
});
