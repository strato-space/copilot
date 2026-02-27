import fs from 'node:fs';
import path from 'node:path';

describe('OperOps task link routing contract', () => {
    const kanbanPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
    const source = fs.readFileSync(kanbanPath, 'utf8');

    it('opens task cards by database _id first to avoid short-id collisions', () => {
        expect(source).toContain('/operops/task/${record._id || record.id}');
        expect(source).not.toContain('/operops/task/${record.id || record._id}');
    });
});
