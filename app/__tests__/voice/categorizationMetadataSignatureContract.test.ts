import fs from 'node:fs';
import path from 'node:path';

describe('Categorization metadata signature contract', () => {
    it('uses shared metadata formatter path with transcription for parity', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const transcriptionRowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');
        const transcriptionSource = fs.readFileSync(transcriptionRowPath, 'utf8');

        expect(source).toContain("import { formatVoiceMetadataSignature } from '../../utils/voiceMetadataSignature';");
        expect(transcriptionSource).toContain("import { formatVoiceMetadataSignature } from '../../utils/voiceMetadataSignature';");
        expect(source).toContain('return formatVoiceMetadataSignature({');
        expect(transcriptionSource).toContain('return formatVoiceMetadataSignature({');
        expect(source).toContain('text-black/45 text-[9px] font-normal leading-3');
    });
});
