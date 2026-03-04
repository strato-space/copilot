import fs from 'node:fs';
import path from 'node:path';

describe('Transcription fallback error signature contract', () => {
  const rowPath = path.resolve(process.cwd(), 'src/components/voice/TranscriptionTableRow.tsx');
  const rowSource = fs.readFileSync(rowPath, 'utf8');

  it('renders metadata signature line for fallback error rows via shared formatter', () => {
    expect(rowSource).toContain('const resolveFallbackErrorSignature = (');
    expect(rowSource).toContain("const plainText = typeof row.text === 'string' ? row.text.trim() : '';");
    expect(rowSource).toContain('if (plainText) return null;');
    expect(rowSource).toContain('const errorCode = getTranscriptionErrorCode(row);');
    expect(rowSource).toContain('if (!errorCode) return null;');

    expect(rowSource).toContain('return formatVoiceMetadataSignature({');
    expect(rowSource).toContain('startSeconds: relativeStartSeconds');
    expect(rowSource).toContain('endSeconds: relativeStartSeconds');
    expect(rowSource).toContain('sourceFileName: extractSourceFileName(row)');
    expect(rowSource).toContain('absoluteTimestampMs: messageTimestampMs');

    expect(rowSource).toContain('const fallbackErrorSignature = resolveFallbackErrorSignature(row, sessionBaseTimestampMs);');
    expect(rowSource).toContain('{fallbackErrorSignature ? (');
    expect(rowSource).toContain('{fallbackErrorSignature}');
  });

  it('prioritizes transcription_text so websocket message_update replaces quota placeholder in-place', () => {
    expect(rowSource).toContain("if (typeof msg.transcription_text === 'string' && msg.transcription_text.trim()) {");
    expect(rowSource).toContain('return [{ text: msg.transcription_text }];');

    const fallbackBodyTextIndex = rowSource.indexOf('const resolveFallbackBodyText = (row: VoiceBotMessage): string => {');
    const fallbackBodyErrorIndex = rowSource.indexOf('const errorCode = getTranscriptionErrorCode(row);');
    const fallbackBodyTranscriptionTextIndex = rowSource.indexOf('const transcriptionText = getTranscriptionText(row);');
    expect(fallbackBodyTextIndex).toBeGreaterThan(-1);
    expect(fallbackBodyTranscriptionTextIndex).toBeGreaterThan(fallbackBodyTextIndex);
    expect(fallbackBodyErrorIndex).toBeGreaterThan(fallbackBodyTranscriptionTextIndex);
  });

  it('keeps non-error fallback states unchanged', () => {
    expect(rowSource).toContain("return '⏳ Обработка аудио...';");
    expect(rowSource).toContain("return '—';");
    expect(rowSource).toContain("return '⏳ Ожидание транскрибации...';");
  });
});
