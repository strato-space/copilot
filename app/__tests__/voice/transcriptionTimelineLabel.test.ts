import fs from 'node:fs';
import path from 'node:path';

describe('Transcription timeline label contract', () => {
  const transcriptionPath = path.resolve(process.cwd(), 'src/components/voice/Transcription.tsx');
  const rowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const transcriptionSource = fs.readFileSync(transcriptionPath, 'utf8');
  const rowSource = fs.readFileSync(rowPath, 'utf8');

  it('computes sessionBaseTimestampMs and passes it into rows', () => {
    expect(transcriptionSource).toContain('const sessionBaseTimestampMs = useMemo(() =>');
    expect(transcriptionSource).toMatch(/return\s+Math\.min\(\.\.\.stamps\);/);
    expect(transcriptionSource).toMatch(/sessionBaseTimestampMs=\{sessionBaseTimestampMs\}/);
  });

  it('formats timeline label via metadata signature helper and uses ch_* segment ids for actions', () => {
    expect(rowSource).toMatch(
      /formatVoiceMetadataSignature\(\{\s*startSeconds:\s*relativeStartSeconds,\s*endSeconds:\s*relativeEndSeconds\s*\?\?\s*relativeStartSeconds,[\s\S]*?sourceFileName:\s*extract\w*SourceFileName\(row\),[\s\S]*?absoluteTimestampMs:\s*segmentAbsoluteStartMs/m
    );

    // Segment ids are stable `ch_<oid>` strings (not raw ObjectIds).
    expect(rowSource).toMatch(/startsWith\('ch_'\)/);

    // Timeline label is rendered below segment text.
    expect(rowSource).toContain('const timelineLabel = formatSegmentTimeline(seg, row, sessionBaseTimestampMs);');
    expect(rowSource).toMatch(/\{timelineLabel\s*\?\s*\(/);
    expect(rowSource).toContain('{timelineLabel}');
  });
});
