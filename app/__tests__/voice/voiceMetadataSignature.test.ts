import { formatVoiceMetadataSignature, formatVoiceRelativeTimeLabel } from '../../src/utils/voiceMetadataSignature';
import dayjs from 'dayjs';

describe('voice metadata signature formatter', () => {
    it('formats relative time labels', () => {
        expect(formatVoiceRelativeTimeLabel(179)).toBe('2:59');
        expect(formatVoiceRelativeTimeLabel('0')).toBe('0:00');
        expect(formatVoiceRelativeTimeLabel(-1)).toBeNull();
    });

    it('formats signature with range, source file and absolute time', () => {
        const absoluteTimestampMs = '1740925604000';
        const signature = formatVoiceMetadataSignature({
            startSeconds: 179,
            endSeconds: 179,
            sourceFileName: '002-1.webm',
            absoluteTimestampMs,
        });

        expect(signature).toBe(`2:59 - 2:59, 002-1.webm, ${dayjs(Number(absoluteTimestampMs)).format('HH:mm:ss')}`);
    });

    it('omits zero-only range when omitZeroRange is enabled', () => {
        const absoluteTimestampMs = '1740925604000';
        const signature = formatVoiceMetadataSignature({
            startSeconds: 0,
            endSeconds: 0,
            sourceFileName: '002-1.webm',
            absoluteTimestampMs,
            omitZeroRange: true,
        });
        expect(signature).toBe(`002-1.webm, ${dayjs(Number(absoluteTimestampMs)).format('HH:mm:ss')}`);
    });

    it('normalizes mojibake source filename in signature output', () => {
        const absoluteTimestampMs = '1740925604000';
        const utf8Name = 'Запись_15-43-11.webm';
        const mojibakeName = Buffer.from(utf8Name, 'utf8').toString('latin1');

        const signature = formatVoiceMetadataSignature({
            startSeconds: 10,
            endSeconds: 12,
            sourceFileName: mojibakeName,
            absoluteTimestampMs,
        });

        expect(signature).toBe(`0:10 - 0:12, ${utf8Name}, ${dayjs(Number(absoluteTimestampMs)).format('HH:mm:ss')}`);
    });
});
