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
});
