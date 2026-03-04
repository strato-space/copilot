import fs from 'node:fs';
import path from 'node:path';

describe('categorization row-local selection logic', () => {
    it('toggles by row identity (not by message block id) and keeps additive row-local selection semantics', () => {
        const storePath = path.resolve(process.cwd(), 'src/store/sessionsUIStore.ts');
        const source = fs.readFileSync(storePath, 'utf8');

        expect(source).toContain('toggleSelectedCategorizationRow: (row) =>');
        expect(source).toContain('const rowId = getCategorizationRowIdentity(row);');
        expect(source).toContain('getCategorizationRowIdentity(selectedRow) === rowId');
        expect(source).toContain('selectedCategorizationRows: [...state.selectedCategorizationRows, row]');
        expect(source).not.toContain('selectedRow.message_id === row.message_id');
    });
});
