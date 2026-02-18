import fs from 'node:fs';
import path from 'node:path';

describe('Transcription row actions + header parity', () => {
  const headerPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableHeader.tsx');
  const rowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const headerSource = fs.readFileSync(headerPath, 'utf8');
  const rowSource = fs.readFileSync(rowPath, 'utf8');

  it('removes standalone Time column from header (time moves into row meta/timeline)', () => {
    expect(headerSource).not.toContain('Time');
  });

  it('renders Copy/Edit/Delete actions in a hover-only area above text (no overlap)', () => {
    expect(rowSource).toContain('CopyOutlined');
    expect(rowSource).toContain('EditOutlined');
    expect(rowSource).toContain('DeleteOutlined');

    // Hover-only actions container (group hover opacity)
    expect(rowSource).toContain('group-hover:opacity-100');

    // Segment text is wrapped with safe whitespace handling.
    expect(rowSource).toContain('whitespace-pre-wrap');
    expect(rowSource).toContain('break-words');

    // Wires edit/delete operations to API store.
    expect(rowSource).toContain('editTranscriptChunk');
    expect(rowSource).toContain('deleteTranscriptChunk');
  });
});
