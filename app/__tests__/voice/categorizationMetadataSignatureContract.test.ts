import fs from 'node:fs';
import path from 'node:path';

describe('Categorization metadata signature contract', () => {
    it('renders a pale metadata signature line in categorization rows for transcription comparability', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain('const metadataSignature = buildMetadataSignature(row);');
        expect(source).toContain("const parts = [rangeLabel, speakerLabel]");
        expect(source).toContain("parts.join(', ')");
        expect(source).toContain('text-black/45 text-[9px] font-normal leading-3');
    });
});
