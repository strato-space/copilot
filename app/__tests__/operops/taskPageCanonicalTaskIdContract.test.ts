import fs from 'node:fs';
import path from 'node:path';

import type { Ticket } from '../../src/types/crm';
import { resolveCanonicalTaskId } from '../../src/pages/operops/taskPageUtils';

const createTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
    _id: '67c4473f4a0ec9753d95d42a',
    id: 'OPS-77',
    name: 'Canonical task id contract',
    project: 'Copilot',
    ...overrides,
});

describe('OperOps task card canonical task-id contract', () => {
    it('resolves canonical id from public id first, then route id, then _id', () => {
        expect(resolveCanonicalTaskId(createTicket())).toBe('OPS-77');
        expect(resolveCanonicalTaskId(createTicket({ id: '  ' }), 'route-id')).toBe('route-id');
        expect(resolveCanonicalTaskId(createTicket({ id: '' }), '')).toBe('67c4473f4a0ec9753d95d42a');
    });

    it('renders dedicated Task ID header block with copy action in TaskPage', () => {
        const componentPath = path.resolve(process.cwd(), 'src/pages/operops/TaskPage.tsx');
        const source = fs.readFileSync(componentPath, 'utf8');

        expect(source).toContain('resolveCanonicalTaskId(task, taskId)');
        expect(source).toContain('Task ID');
        expect(source).toContain('copyable={{ text: canonicalTaskId }}');
    });
});
