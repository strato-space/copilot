import fs from 'node:fs';
import path from 'node:path';

describe('Transcription image preview contract', () => {
  const sourcePath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');

  it('extracts image attachments from message payload for row rendering', () => {
    expect(source).toContain('const extractImageAttachment = (row: VoiceBotMessage): { url: string; name: string } | null => {');
    expect(source).toContain('const imageAttachment = extractImageAttachment(row);');
  });

  it('renders preview image inside transcription row for clipboard/image chunks', () => {
    expect(source).toContain('href={imageAttachment.url}');
    expect(source).toContain('src={imageAttachment.url}');
    expect(source).toContain('className="max-h-48 max-w-[320px] rounded border border-slate-200 object-contain bg-white"');
  });
});
