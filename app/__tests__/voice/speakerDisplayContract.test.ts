import fs from 'node:fs';
import path from 'node:path';

describe('Transcription speaker display contract', () => {
  const rowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const source = fs.readFileSync(rowPath, 'utf8');

  it('maps technical speaker labels to user-facing Спикер N while preserving raw labels in data', () => {
    expect(source).toContain('const isTechnicalSpeakerLabel = (label: string): boolean => {');
    expect(source).toContain("/^spk[_-]?\\d+$/.test(normalized)");
    expect(source).toContain("/^\\d+$/.test(normalized)");
    expect(source).toContain('speakerMap.set(rawSpeaker, `Спикер ${nextSpeakerNumber}`);');
    expect(source).toContain('return speakerDisplayMap.get(speaker) ?? speaker;');
  });
});
