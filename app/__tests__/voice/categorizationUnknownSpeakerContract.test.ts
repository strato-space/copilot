import fs from 'node:fs';
import path from 'node:path';

describe('Categorization unknown speaker display contract', () => {
    it('hides Unknown speaker label in row header', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain("const showSpeakerLabel = speakerLabel.length > 0 && speakerLabel.toLowerCase() !== 'unknown';");
        expect(source).toContain('{showSpeakerLabel ? (');
        expect(source).not.toContain('>{row.name}<');
    });
});
