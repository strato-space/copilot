import fs from 'node:fs';
import path from 'node:path';

import type { Project, Ticket } from '../../src/types/crm';
import { resolveTaskProjectName } from '../../src/pages/operops/taskPageUtils';

const createTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
    _id: '67c4473f4a0ec9753d95d42a',
    id: 'OPS-77',
    name: 'Project display contract',
    project: '',
    ...overrides,
});

describe('TaskPage project name contract', () => {
    it('prefers project_data and falls back to dictionary lookup before N/A', () => {
        const byArrayProjectData = resolveTaskProjectName(
            createTicket({
                project_data: [{ name: 'Project from lookup payload' }] as unknown as Ticket['project_data'],
            } as Partial<Ticket>),
            []
        );

        const projectsData: Project[] = [{ _id: 'proj-1', name: 'Project from dictionary' }];
        const byProjectId = resolveTaskProjectName(
            createTicket({
                project: '',
                project_id: 'proj-1',
            }),
            projectsData
        );

        const fallbackValue = resolveTaskProjectName(
            createTicket({
                project: 'Legacy project field',
            }),
            projectsData
        );

        const emptyFallback = resolveTaskProjectName(
            createTicket({
                project: '',
                project_id: undefined,
                project_data: undefined,
            }),
            []
        );

        expect(byArrayProjectData).toBe('Project from lookup payload');
        expect(byProjectId).toBe('Project from dictionary');
        expect(fallbackValue).toBe('Legacy project field');
        expect(emptyFallback).toBe('N/A');
    });

    it('TaskPage uses canonical project resolver instead of direct task.project access', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('const projectName = resolveTaskProjectName(task, projectsData);');
        expect(source).toContain('{projectName}');
        expect(source).not.toContain("task.project ?? 'N/A'");
    });
});
