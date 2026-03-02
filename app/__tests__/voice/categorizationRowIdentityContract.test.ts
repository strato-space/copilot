import fs from 'node:fs';
import path from 'node:path';

import {
    buildCategorizationRowIdentity,
    getCategorizationRowIdentity,
    resolveCategorizationSegmentOid,
} from '../../src/utils/categorizationRowIdentity';

describe('categorization row identity contract', () => {
    it('prefers explicit row_id and segment_oid identities', () => {
        expect(buildCategorizationRowIdentity({ explicitRowId: 'row:manual' })).toBe('row:manual');
        expect(buildCategorizationRowIdentity({ segmentOid: 'ch_segment_1' })).toBe('seg:ch_segment_1');
    });

    it('builds deterministic fallback identity with source index to avoid collisions', () => {
        const first = buildCategorizationRowIdentity({
            messageRef: 'msg-1',
            timeStart: 12,
            timeEnd: 14,
            text: 'Same text',
            sourceIndex: 0,
        });
        const second = buildCategorizationRowIdentity({
            messageRef: 'msg-1',
            timeStart: 12,
            timeEnd: 14,
            text: 'Same text',
            sourceIndex: 1,
        });
        expect(first).not.toEqual(second);
    });

    it('resolves row identity from VoiceMessageRow fields', () => {
        expect(
            getCategorizationRowIdentity({
                row_id: undefined,
                segment_oid: 'ch_segment_2',
                message_id: 'msg-2',
                material_source_message_id: undefined,
                timeStart: 1,
                timeEnd: 2,
                text: 'hello',
                row_index: 4,
            })
        ).toBe('seg:ch_segment_2');
    });

    it('extracts segment oid from segment_oid or ch_* id fallback', () => {
        expect(resolveCategorizationSegmentOid({ segment_oid: 'ch_segment_3' })).toBe('ch_segment_3');
        expect(resolveCategorizationSegmentOid({ id: 'ch_segment_4' })).toBe('ch_segment_4');
        expect(resolveCategorizationSegmentOid({ id: 'row-1' })).toBe('');
    });
});

describe('sessionsUIStore identity usage contract', () => {
    it('does not rely on message_id-timeStart-timeEnd composite key', () => {
        const storePath = path.resolve(process.cwd(), 'src/store/sessionsUIStore.ts');
        const source = fs.readFileSync(storePath, 'utf8');

        expect(source).toContain('getCategorizationRowIdentity');
        expect(source).not.toContain('`${row.message_id}-${row.timeStart}-${row.timeEnd}`');
    });
});

