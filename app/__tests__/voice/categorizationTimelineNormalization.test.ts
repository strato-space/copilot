import fs from 'node:fs';
import path from 'node:path';

import {
    formatTimelineSecondsLabel,
    normalizeTimelineRangeSeconds,
    parseTimelineSeconds,
} from '../../src/utils/voiceTimeline';

describe('categorization timeline normalization', () => {
    it('parses numeric and clock-like timestamps to seconds', () => {
        expect(parseTimelineSeconds('250')).toBe(250);
        expect(parseTimelineSeconds('01:30')).toBe(90);
        expect(parseTimelineSeconds('01:02:03')).toBe(3723);
        expect(parseTimelineSeconds('')).toBeNull();
    });

    it('normalizes missing/invalid ranges and formats labels', () => {
        expect(normalizeTimelineRangeSeconds('', '')).toEqual({ startSeconds: 0, endSeconds: 0 });
        expect(normalizeTimelineRangeSeconds('30', '')).toEqual({ startSeconds: 30, endSeconds: 30 });
        expect(normalizeTimelineRangeSeconds('80', '30')).toEqual({ startSeconds: 80, endSeconds: 80 });

        expect(formatTimelineSecondsLabel(250)).toBe('04:10');
        expect(formatTimelineSecondsLabel('3723')).toBe('01:02:03');
    });

    it('is used by voice store and categorization row renderer', () => {
        const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const storeSource = fs.readFileSync(storePath, 'utf8');
        const rowSource = fs.readFileSync(rowPath, 'utf8');

        expect(storeSource).toContain('normalizeTimelineRangeSeconds(cat.start, cat.end)');
        expect(rowSource).toContain('formatTimelineSecondsLabel(row.timeStart)');
        expect(rowSource).toContain('formatTimelineSecondsLabel(row.timeEnd)');
    });
});
