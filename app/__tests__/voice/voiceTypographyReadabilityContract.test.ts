import fs from 'node:fs';
import path from 'node:path';

describe('voice typography readability contract', () => {
    it('uses readable primary/secondary text sizes in categorization rows', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain('text-black/90 text-[12px] font-normal leading-5 whitespace-pre-line');
        expect(source).toContain('text-black/60 text-[10px] font-normal leading-4');
        expect(source).toContain('text-black/90 text-[10px] font-normal leading-4 truncate');
    });

    it('uses readable primary/secondary text sizes in transcription rows', () => {
        const rowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
        const source = fs.readFileSync(rowPath, 'utf8');

        expect(source).toContain('text-black/90 text-[12px] font-normal leading-5 whitespace-pre-wrap break-words');
        expect(source).toContain('text-black/45 text-[10px] font-normal leading-4');
        expect(source).toContain('text-black/55 text-[10px] font-normal leading-4');
    });

    it('uses larger readable header labels in categorization and transcription tables', () => {
        const categorizationHeaderPath = path.resolve(process.cwd(), 'src/components/voice/CategorizationTableHeader.tsx');
        const transcriptionHeaderPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableHeader.tsx');
        const categorizationHeaderSource = fs.readFileSync(categorizationHeaderPath, 'utf8');
        const transcriptionHeaderSource = fs.readFileSync(transcriptionHeaderPath, 'utf8');

        expect(categorizationHeaderSource).toContain('text-black/60 text-[11px] font-semibold leading-4');
        expect(transcriptionHeaderSource).toContain('text-black/60 text-[11px] font-semibold leading-4');
    });
});
