import fs from 'node:fs';
import path from 'node:path';

import type { Performer } from '../../src/types/crm';
import {
    CODEX_PERFORMER_ID,
    CODEX_PERFORMER_NAME,
    ensureCodexPerformerForKanban,
    ensureCodexPerformerRecords,
} from '../../src/utils/codexPerformer';

describe('Codex performer selector contract', () => {
    it('injects Codex performer once for CRM/kanban selectors', () => {
        const basePerformers: Performer[] = [
            {
                _id: '507f1f77bcf86cd799439011',
                id: 'vp',
                name: 'VP',
                real_name: 'Vladimir Petrov',
            },
        ];

        const withCodex = ensureCodexPerformerForKanban(basePerformers);
        const withCodexAgain = ensureCodexPerformerForKanban(withCodex);

        expect(withCodex.some((item) => item._id === CODEX_PERFORMER_ID)).toBe(true);
        expect(withCodexAgain.filter((item) => item._id === CODEX_PERFORMER_ID)).toHaveLength(1);
        expect(withCodexAgain.find((item) => item._id === CODEX_PERFORMER_ID)?.name).toBe(
            CODEX_PERFORMER_NAME
        );
    });

    it('injects Codex performer once for voice task performer selector payloads', () => {
        const withCodex = ensureCodexPerformerRecords([
            { _id: '507f1f77bcf86cd799439011', name: 'VP' },
        ]);
        const withCodexAgain = ensureCodexPerformerRecords(withCodex);

        expect(withCodex.some((item) => item._id === CODEX_PERFORMER_ID)).toBe(true);
        expect(withCodexAgain.filter((item) => item._id === CODEX_PERFORMER_ID)).toHaveLength(1);
    });

    it('wires Codex helper into kanban and voice performer loaders', () => {
        const kanbanStorePath = path.resolve(process.cwd(), 'src/store/kanbanStore.ts');
        const voiceStorePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
        const kanbanStoreSource = fs.readFileSync(kanbanStorePath, 'utf8');
        const voiceStoreSource = fs.readFileSync(voiceStorePath, 'utf8');

        expect(kanbanStoreSource).toContain('ensureCodexPerformerForKanban');
        expect(kanbanStoreSource).toContain('const performers = ensureCodexPerformerForKanban(data.performers);');
        expect(voiceStoreSource).toContain('ensureCodexPerformerRecords');
        expect(voiceStoreSource).toContain('const performersWithCodex = ensureCodexPerformerRecords(data);');
    });
});
