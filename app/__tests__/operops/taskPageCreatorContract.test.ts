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
    const performers: Performer[] = [
        {
            _id: '67c4473f4a0ec9753d95d42b',
            id: 'vp',
            name: 'VP',
            real_name: 'Vladimir Petrov',
            email: 'vp@strato.space',
        },
    ];

    it('prefers explicit creator name fields over object and performer fallbacks', () => {
        const fromCreatedByName = resolveTaskCreator(
            createTicket({
                created_by_name: '  System User  ',
                creator_name: 'Legacy Name',
                created_by: { _id: '67c4473f4a0ec9753d95d42b', name: 'Object Name' } as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );

        const fromCreatorName = resolveTaskCreator(
            createTicket({
                created_by_name: ' ',
                creator_name: 'Legacy Name',
            } as Partial<Ticket>),
            performers
        );

        expect(fromCreatedByName).toBe('System User');
        expect(fromCreatorName).toBe('Legacy Name');
    });

    it('uses creator object display label before performer identity lookup', () => {
        const byObjectLabel = resolveTaskCreator(
            createTicket({
                created_by: {
                    _id: '67c4473f4a0ec9753d95d42b',
                    name: 'Creator Object Name',
                } as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );

        expect(byObjectLabel).toBe('Creator Object Name');
    });

    it('falls back to performer lookup using creator identity aliases', () => {
        const byObjectIdentity = resolveTaskCreator(
            createTicket({
                created_by: {
                    performer_id: 'vp',
                } as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );

        const byLegacyId = resolveTaskCreator(
            createTicket({
                created_by: 'vp' as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );

        expect(byObjectIdentity).toBe('Vladimir Petrov');
        expect(byLegacyId).toBe('Vladimir Petrov');
    });

    it('falls back to creator identity string and then N/A', () => {
        const byIdentityFromObject = resolveTaskCreator(
            createTicket({
                created_by: {
                    createdBy: 'legacy-author-id',
                } as unknown as Ticket['created_by'],
            } as Partial<Ticket>),
            performers
        );

        const byRawIdentity = resolveTaskCreator(
            createTicket({
                created_by: 'manual-author-id' as unknown as Ticket['created_by'],
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

        expect(byIdentityFromObject).toBe('legacy-author-id');
        expect(byRawIdentity).toBe('manual-author-id');
        expect(fallback).toBe('N/A');
    });

    it('TaskPage renders a dedicated Created by metadata block using resolver', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('const creatorName = resolveTaskCreator(task, performers);');
        expect(source).toContain('<UserOutlined /> Created by');
        expect(source).toMatch(/<UserOutlined \/>\s*Created by[\s\S]*\{creatorName\}/);
    });
});
