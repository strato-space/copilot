import fs from 'node:fs';
import path from 'node:path';

describe('Categorization metadata signature contract', () => {
    it('renders metadata signature once per block footer and keeps row renderer signature-free', () => {
        const categorizationPath = path.resolve(process.cwd(), 'src/components/voice/Categorization.tsx');
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const utilsPath = path.resolve(process.cwd(), 'src/utils/voiceMetadataSignature.ts');
        const categorizationSource = fs.readFileSync(categorizationPath, 'utf8');
        const source = fs.readFileSync(rowPath, 'utf8');
        const utilsSource = fs.readFileSync(utilsPath, 'utf8');

        expect(categorizationSource).toContain('buildCategorizationBlockMetadataSignature');
        expect(categorizationSource).toContain('const metadataSignature = buildCategorizationBlockMetadataSignature({');
        expect(categorizationSource).toContain('rows: sortedRows');
        expect(categorizationSource).toContain('materials,');
        expect(categorizationSource).toContain('{metadataSignature ? (');
        expect(categorizationSource).toContain('text-black/45 text-[9px] font-normal leading-3');

        expect(utilsSource).toContain('export const formatVoiceMetadataFooterSignature');
        expect(utilsSource).toContain('export const buildCategorizationBlockMetadataSignature');

        expect(source).not.toContain('formatVoiceMetadataSignature');
        expect(source).not.toContain('buildMetadataSignature');
        expect(source).not.toContain('metadataSignature ? (');
    });
});
