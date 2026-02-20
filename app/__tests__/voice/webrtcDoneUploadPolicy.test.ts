import fs from 'node:fs';
import path from 'node:path';

describe('webrtc done upload policy', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('auto-attempts each pending chunk only once before manual retries', () => {
    expect(source).toContain("li?.dataset?.autoUploadAttempted === '1'");
    expect(source).toContain("li.dataset.autoUploadAttempted = '1'");
    expect(source).toContain("'pending-manual'");
  });

  it('keeps full-track rows in monitor but skips full-track upload by policy', () => {
    expect(source).toContain("trackKind === 'full_track'");
    expect(source).toContain("ARCHIVE_TRACK_UPLOAD_ENABLED = false");
    expect(source).toContain("[archive] upload skipped by policy");
    expect(source).toContain(" · full-track");
  });
});
