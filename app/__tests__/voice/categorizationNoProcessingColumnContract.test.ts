import fs from 'node:fs';
import path from 'node:path';

describe('categorization processing column removal contract', () => {
    it('does not render processing column or status component in Categorization tab', () => {
        const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
        const source = fs.readFileSync(categorizationPath, 'utf8');

        expect(source).not.toContain('Обработка');
        expect(source).not.toContain('CategorizationStatusColumn');
    });
});

