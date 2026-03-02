import fs from 'node:fs';
import path from 'node:path';

describe('categorization materials column contract', () => {
    it('renders materials from dedicated materials list instead of image rows in text area', () => {
        const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const source = fs.readFileSync(categorizationPath, 'utf8');
        const rowSource = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain('const materials = Array.isArray(group.materials)');
        expect(source).toContain('materials={i === 0 ? materials : []}');
        expect(source).toContain('rowsToRender = sortedRows.length > 0');
        expect(source).toContain('materials.length > 0');
        expect(rowSource).toContain('materials = []');
        expect(rowSource).toContain('materials.map((material, idx) => (');
        expect(rowSource).not.toContain('row.kind === \'image\'');
    });
});

