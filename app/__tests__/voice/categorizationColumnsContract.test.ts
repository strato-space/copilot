import fs from 'node:fs';
import path from 'node:path';

describe('Categorization columns contract', () => {
    it('replaces Quick Summary with Materials and keeps Src removed', () => {
        const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
        const headerPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableHeader.tsx');
        const source = fs.readFileSync(categorizationPath, 'utf8');
        const headerSource = fs.readFileSync(headerPath, 'utf8');

        expect(source).not.toContain('>Src<');
        expect(source).not.toContain('Quick Summary');
        expect(source).not.toContain('CategorizationTableSummary');
        expect(headerSource).toContain('>Materials<');
    });
});
