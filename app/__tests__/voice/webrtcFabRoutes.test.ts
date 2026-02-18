import fs from 'node:fs';
import path from 'node:path';

describe('webrtc FAB session links', () => {
  const scriptPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('uses /voice/session/:id for main-app navigation', () => {
    expect(source).toContain('function getMainAppSessionPath(sid)');
    expect(source).toContain('return `/voice/session/${encodeURIComponent(safeId)}`;');
    expect(source).toContain('const url = new URL(getMainAppSessionPath(safeSid)');
    expect(source).toContain('const link = getMainAppSessionPath(newId);');
  });

  it('does not build direct /session/:id links for host navigation', () => {
    expect(source).not.toContain('new URL(`/session/${encodeURIComponent(sid)}`');
    expect(source).not.toContain('const link = `/session/${encodeURIComponent(newId)}`');
  });
});
