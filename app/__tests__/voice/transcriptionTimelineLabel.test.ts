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

  it('keeps signatures after text blocks (per-segment for transcribed rows) and uses ch_* segment ids for actions', () => {
    // Segment ids are stable `ch_<oid>` strings (not raw ObjectIds).
    expect(rowSource).toMatch(/startsWith\('ch_'\)/);

    // Segment timeline signature is rendered under segment text.
    expect(rowSource).toContain('const timelineLabel = formatSegmentTimeline(seg, row, sessionBaseTimestampMs);');
    expect(rowSource).toContain('sourceFileName: extractVoiceSourceFileName(row),');
    expect(rowSource).toContain('absoluteTimestampMs: segmentAbsoluteStartMs,');
    expect(rowSource).toContain('{timelineLabel ? (');
    expect(rowSource).toContain('{timelineLabel}');

    // Error fallback signature remains available when transcription body is missing.
    expect(rowSource).toContain('const fallbackErrorSignature = resolveFallbackErrorSignature(row, sessionBaseTimestampMs);');
    expect(rowSource).toMatch(
      /formatVoiceMetadataSignature\(\{\s*startSeconds:\s*relativeStartSeconds,\s*endSeconds:\s*relativeStartSeconds,[\s\S]*?sourceFileName:\s*extract\w*SourceFileName\(row\),[\s\S]*?absoluteTimestampMs:\s*messageTimestampMs/m
    );
    expect(rowSource).toMatch(/\{fallbackErrorSignature\s*\?\s*\(/);
    expect(rowSource).toContain('{fallbackErrorSignature}');
  });
});
