import fs from 'node:fs';
import path from 'node:path';

describe('WebRTC session_done socket contract', () => {
  const runtimePath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(runtimePath, 'utf8');

  it('emits session_done to /voicebot namespace (not root namespace)', () => {
    expect(source).toContain("const voicebotNs = `${String(baseForSocket || '').replace(/\\/+$/, '')}/voicebot`;");
    expect(source).toContain('const sio = window.io(voicebotNs, {');
  });

  it('treats ack {ok:false} as failed close', () => {
    expect(source).toContain("if (ack && typeof ack === 'object' && ack.ok === false)");
    expect(source).toContain("console.warn('[sessionDoneBrowser] session_done rejected', ack);");
  });
});

