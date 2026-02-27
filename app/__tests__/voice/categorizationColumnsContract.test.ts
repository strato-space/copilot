import fs from 'node:fs';
import path from 'node:path';

describe('Categorization columns contract', () => {
    it('removes Src and Quick Summary columns from categorization table', () => {
        const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
        const source = fs.readFileSync(categorizationPath, 'utf8');

        expect(source).not.toContain('>Src<');
        expect(source).not.toContain('Quick Summary');
        expect(source).not.toContain('CategorizationTableSummary');
    });
});
