import fs from 'node:fs';
import path from 'node:path';

describe('WebRTC session_done REST contract', () => {
  const runtimePath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(runtimePath, 'utf8');

  it('uses a dedicated REST close helper and session_done endpoint', () => {
    expect(source).toContain('async function closeSessionViaRest(sessionId, opts = {})');
    expect(source).toContain('const resp = await fetch(endpoints.closeSession(), {');
    expect(source).toContain("body: JSON.stringify({ session_id: sid })");
    expect(source).toContain("closeSession: () => `${API_BASE.replace(/\\/$/, '')}/voicebot/session_done`");
    expect(source).not.toContain('sessionDoneBrowser(');
  });

  it('does not clear active session silently when close failed', () => {
    expect(source).toContain("if (!closeOk) throw new Error('session_done_failed');");
    expect(source).toContain('if (closeFailed) {');
    expect(source).toContain("setFabState('paused');");
  });

  it('routes all done-close entry points through REST close helper', () => {
    expect(source).toContain('const closeOk = await closeSessionViaRest(prevSid, { timeoutMs: 4000 });');
    expect(source).toContain('const closed = await closeSessionViaRest(sid, { timeoutMs: 4000 });');
    expect(source).toContain('await closeSessionViaRest(sid, { timeoutMs: 3000 });');
  });
});
