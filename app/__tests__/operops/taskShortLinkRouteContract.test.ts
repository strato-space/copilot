import fs from 'node:fs';
import path from 'node:path';

describe('OperOps task link routing contract', () => {
    const kanbanPath = path.resolve(process.cwd(), 'src/components/crm/CRMKanban.tsx');
    const source = fs.readFileSync(kanbanPath, 'utf8');

    it('opens task cards by database _id first to avoid short-id collisions', () => {
        expect(source).toContain('const resolveTicketRouteId = useCallback((record: Ticket): string => {');
        expect(source).toContain('const dbId = resolveTicketDbId(record);');
        expect(source).toContain('if (!publicId || duplicatedPublicTicketIds.has(publicId)) return \'\';');
        expect(source).toContain('href={`/operops/task/${encodeURIComponent(routeTaskId)}`}');
        expect(source).not.toContain('/operops/task/${record.id || record._id}');
    });

    it('keeps table row identity deterministic even when _id is missing', () => {
        expect(source).toContain('const resolveTicketRowKey = useCallback((record: Ticket): string => {');
        expect(source).toContain('return [');
        expect(source).toContain('rowKey={(record) => resolveTicketRowKey(record)}');
    });
});
