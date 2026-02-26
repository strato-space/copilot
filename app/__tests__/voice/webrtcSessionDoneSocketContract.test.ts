import fs from 'node:fs';
import path from 'node:path';

describe('WebRTC session_done socket contract', () => {
  const runtimePath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const source = fs.readFileSync(runtimePath, 'utf8');

  it('tries session_done on /voicebot namespace with base fallbacks', () => {
    expect(source).toContain('function buildSocketBaseCandidates(base)');
    expect(source).toContain('pathname.replace(/\\/api(?:\\/.*)?$/i, \'\')');
    expect(source).toContain("const voicebotNs = `${String(candidateBase || '').replace(/\\/+$/, '')}/voicebot`;");
    expect(source).toContain('const ok = await emitSessionDoneToNamespace(voicebotNs, sessionId, opts);');
  });

  it('does not clear active session silently when close failed', () => {
    expect(source).toContain("if (!closeOk) throw new Error('session_done_failed');");
    expect(source).toContain('if (closeFailed) {');
    expect(source).toContain("setFabState('paused');");
  });

  it('treats ack {ok:false} as failed close', () => {
    expect(source).toContain("if (ack && typeof ack === 'object' && ack.ok === false)");
    expect(source).toContain("console.warn('[sessionDoneBrowser] session_done rejected', ack);");
  });
});
