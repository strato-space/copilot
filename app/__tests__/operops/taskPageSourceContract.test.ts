import fs from 'node:fs';
import path from 'node:path';

import type { Ticket } from '../../src/types/crm';
import { resolveTaskSourceInfo } from '../../src/pages/operops/taskPageUtils';

const createTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
    _id: '67c4473f4a0ec9753d95d42a',
    id: 'OPS-77',
    name: 'Source contract',
    project: 'Copilot',
    ...overrides,
});

describe('TaskPage source contract', () => {
    it('resolves source kind and external link for voice/telegram/manual tasks', () => {
        const voiceSource = resolveTaskSourceInfo(
            createTicket({
                source: 'VOICE_BOT',
                source_data: { session_id: '699ec60739cbeaee2a40c8c7' } as unknown as Ticket['source_data'],
            })
        );
        const telegramSource = resolveTaskSourceInfo(
            createTicket({
                source_kind: 'telegram',
                source_ref: 't.me/c/123/456',
            })
        );
        const manualSource = resolveTaskSourceInfo(
            createTicket({
                source: undefined,
                source_kind: undefined,
                source_ref: undefined,
                source_data: undefined,
            })
        );

        expect(voiceSource.label).toBe('Voice session');
        expect(voiceSource.reference).toBe('699ec60739cbeaee2a40c8c7');
        expect(voiceSource.link).toBe('https://copilot.stratospace.fun/voice/session/699ec60739cbeaee2a40c8c7');

        expect(telegramSource.label).toBe('Telegram');
        expect(telegramSource.link).toBe('https://t.me/c/123/456');

        expect(manualSource.label).toBe('Manual');
        expect(manualSource.reference).toBe('N/A');
        expect(manualSource.link).toBeUndefined();
    });

    it('TaskPage renders source block with new-tab external link', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('const sourceInfo = resolveTaskSourceInfo(task);');
        expect(source).toContain('Source');
        expect(source).toContain('target="_blank"');
        expect(source).toContain('{sourceInfo.reference}');
    });
});
