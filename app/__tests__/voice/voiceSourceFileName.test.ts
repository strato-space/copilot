import type { VoiceBotMessage } from '../../src/types/voice';
import {
    extractVoiceSourceFileName,
    normalizeUtf8AsLatin1Mojibake,
    normalizeVoiceSourceFileName,
} from '../../src/utils/voiceSourceFileName';

describe('voice source filename normalizer', () => {
    it('normalizes utf8-as-latin1 mojibake filenames', () => {
        const original = 'Запись встречи 15-43-11.webm';
        const mojibake = Buffer.from(original, 'utf8').toString('latin1');
        expect(normalizeUtf8AsLatin1Mojibake(mojibake)).toBe(original);
    });

    it('keeps already-correct filenames unchanged', () => {
        expect(normalizeVoiceSourceFileName('meeting-15-43-11.webm')).toBe('meeting-15-43-11.webm');
        expect(normalizeVoiceSourceFileName('Запись встречи.webm')).toBe('Запись встречи.webm');
    });

    it('extracts and normalizes source filename from message metadata', () => {
        const expected = 'Запись встречи 15-43-11.webm';
        const mojibake = Buffer.from(expected, 'utf8').toString('latin1');
        const message: VoiceBotMessage = {
            file_metadata: {
                original_filename: mojibake,
            },
            attachments: [],
        };

        expect(extractVoiceSourceFileName(message)).toBe(expected);
    });
});
