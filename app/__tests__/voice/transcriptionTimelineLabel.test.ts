import fs from 'node:fs';
import path from 'node:path';

describe('Transcription timeline label contract', () => {
  const transcriptionPath = path.resolve(process.cwd(), 'src/components/voice/Transcription.tsx');
  const rowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const transcriptionSource = fs.readFileSync(transcriptionPath, 'utf8');
  const rowSource = fs.readFileSync(rowPath, 'utf8');

  it('computes sessionBaseTimestampMs and passes it into rows', () => {
    expect(transcriptionSource).toContain('sessionBaseTimestampMs');
    expect(transcriptionSource).toContain('Math.min');
    expect(transcriptionSource).toContain('sessionBaseTimestampMs={sessionBaseTimestampMs}');
  });

  it('formats timeline label via metadata signature helper and uses ch_* segment ids for actions', () => {
    expect(rowSource).toContain('formatVoiceMetadataSignature({');
    expect(rowSource).toContain('relativeStartSeconds');
    expect(rowSource).toContain('relativeEndSeconds');
    expect(rowSource).toContain('sourceFileName: extractSourceFileName(row)');
    expect(rowSource).toContain('absoluteTimestampMs: segmentAbsoluteStartMs');

    // Segment ids are stable `ch_<oid>` strings (not raw ObjectIds).
    expect(rowSource).toContain("value.startsWith('ch_')");

    // Timeline label is rendered below segment text.
    expect(rowSource).toContain('timelineLabel');
  });
});
