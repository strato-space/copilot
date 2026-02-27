import fs from 'node:fs';
import path from 'node:path';

import type { Performer, Ticket } from '../../src/types/crm';
import { resolveTaskCreator } from '../../src/pages/operops/taskPageUtils';

const createTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
    _id: '67c4473f4a0ec9753d95d42a',
    id: 'OPS-77',
    name: 'Creator contract',
    project: 'Copilot',
    ...overrides,
});

describe('TaskPage creator contract', () => {
    it('resolves creator from explicit name and performer identity fallbacks', () => {
        const performers: Performer[] = [
            {
                _id: '67c4473f4a0ec9753d95d42b',
                id: 'vp',
                name: 'VP',
                real_name: 'Vladimir Petrov',
            },
        ];

        const byExplicitName = resolveTaskCreator(
            createTicket({
                created_by_name: 'System User',
            } as Partial<Ticket>),
            performers
        );
        const byObjectIdentity = resolveTaskCreator(
            createTicket({
                created_by: { _id: '67c4473f4a0ec9753d95d42b' } as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );
        const byLegacyId = resolveTaskCreator(
            createTicket({
                created_by: 'vp' as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );
        const fallback = resolveTaskCreator(
            createTicket({
                created_by: undefined,
                created_by_name: undefined,
            } as Partial<Ticket>),
            performers
        );

        expect(byExplicitName).toBe('System User');
        expect(byObjectIdentity).toBe('Vladimir Petrov');
        expect(byLegacyId).toBe('Vladimir Petrov');
        expect(fallback).toBe('N/A');
    });

    it('TaskPage renders a dedicated Created by metadata block using resolver', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('const creatorName = resolveTaskCreator(task, performers);');
        expect(source).toContain('Created by');
        expect(source).toContain('{creatorName}');
    });
});
