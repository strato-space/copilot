import dayjs from 'dayjs';

import { buildCategorizationBlockMetadataSignature } from '../../src/utils/voiceMetadataSignature';

describe('categorization block metadata signature', () => {
    const timestampMs = 1740925604000;
    const expectedAbsoluteTime = dayjs(timestampMs).format('HH:mm:ss');

    it('formats compact block metadata with timeline for single-row blocks', () => {
        const signature = buildCategorizationBlockMetadataSignature({
            rows: [
                {
                    timeStart: 0,
                    timeEnd: 47,
                    source_file_name: 'single-row.webm',
                    message_timestamp: timestampMs,
                },
            ],
            materials: [],
            messageTimestamp: timestampMs,
        });

        expect(signature).toBe(`0:00 - 0:47, single-row.webm, ${expectedAbsoluteTime}`);
    });

    it('formats compact block metadata once for multi-row blocks using the full row range', () => {
        const signature = buildCategorizationBlockMetadataSignature({
            rows: [
                {
                    timeStart: 0,
                    timeEnd: 47,
                    source_file_name: 'multi-row.webm',
                    message_timestamp: timestampMs,
                },
                {
                    timeStart: 47,
                    timeEnd: 92,
                    source_file_name: 'multi-row.webm',
                    message_timestamp: timestampMs + 1000,
                },
            ],
            materials: [],
            messageTimestamp: timestampMs,
        });

        expect(signature).toBe(`0:00 - 1:32, multi-row.webm, ${expectedAbsoluteTime}`);
    });

    it('formats compact block metadata for image-only blocks using materials metadata', () => {
        const signature = buildCategorizationBlockMetadataSignature({
            rows: [],
            materials: [
                {
                    source_file_name: 'image-only.webm',
                    message_timestamp: timestampMs,
                },
            ],
            messageTimestamp: timestampMs,
        });

        expect(signature).toBe(`image-only.webm, ${expectedAbsoluteTime}`);
    });
});
