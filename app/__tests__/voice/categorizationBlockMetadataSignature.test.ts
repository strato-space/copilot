import dayjs from 'dayjs';

import { buildCategorizationBlockMetadataSignature } from '../../src/utils/voiceMetadataSignature';

describe('categorization block metadata signature', () => {
    const timestampMs = 1740925604000;
    const expectedAbsoluteTime = dayjs(timestampMs).format('HH:mm:ss');

    it('formats canonical footer signature for single-row blocks', () => {
        const signature = buildCategorizationBlockMetadataSignature({
            rows: [
                {
                    source_file_name: 'single-row.webm',
                    message_timestamp: timestampMs,
                },
            ],
            materials: [],
            messageTimestamp: timestampMs,
        });

        expect(signature).toBe(`single-row.webm, ${expectedAbsoluteTime}`);
    });

    it('formats canonical footer signature once for multi-row blocks', () => {
        const signature = buildCategorizationBlockMetadataSignature({
            rows: [
                {
                    source_file_name: 'multi-row.webm',
                    message_timestamp: timestampMs,
                },
                {
                    source_file_name: 'multi-row.webm',
                    message_timestamp: timestampMs + 1000,
                },
            ],
            materials: [],
            messageTimestamp: timestampMs,
        });

        expect(signature).toBe(`multi-row.webm, ${expectedAbsoluteTime}`);
    });

    it('formats canonical footer signature for image-only blocks using materials metadata', () => {
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
