import fs from 'node:fs';
import path from 'node:path';

describe('webrtc upload error handling', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('normalizes file-too-large responses to concise diagnostics', () => {
    expect(source).toContain('function normalizeUploadErrorMessage(status, rawText)');
    expect(source).toContain("String(payload?.error || '').trim() === 'file_too_large'");
    expect(source).toContain("const base = 'Upload failed: 500 File too large';");
    expect(source).toContain('return requestId ? `${base} [request_id=${requestId}]` : base;');
    expect(source).toContain('File too large (max ${maxLabel})');
  });

  it('uses normalized upload error instead of dumping raw html/json payload', () => {
    expect(source).toContain('throw new Error(normalizeUploadErrorMessage(resp.status, text));');
    expect(source).not.toContain('throw new Error(`Upload failed: ${resp.status} ${text}`);');
  });
});
