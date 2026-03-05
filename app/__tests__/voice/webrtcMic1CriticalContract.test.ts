import fs from 'node:fs';
import path from 'node:path';

describe('webrtc mic1 critical contract', () => {
  const runtimePath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const fabHtmlPath = path.resolve(process.cwd(), 'public/webrtc/components/fab.html');
  const fabCssPath = path.resolve(process.cwd(), 'public/webrtc/components/fab.css');

  const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
  const fabHtml = fs.readFileSync(fabHtmlPath, 'utf8');
  const fabCss = fs.readFileSync(fabCssPath, 'utf8');

  it('shows explicit red Mic 1 OFF warning while capture state is active', () => {
    expect(runtimeSource).toContain('function updateMic1CriticalState()');
    expect(runtimeSource).toContain("const activeCaptureState = state === 'recording' || state === 'paused' || state === 'cutting';");
    expect(runtimeSource).toContain("fabWrap.classList.toggle('mic1-critical', critical);");
    expect(fabHtml).toContain('id="fab-mic1-alert"');
    expect(fabCss).toContain('.fab-wrap.mic1-critical .fab-mic1-alert');
    expect(fabCss).toContain('.fab-wrap.mic1-critical .fab-status-pill');
    expect(fabCss).toContain('.fab-wrap.mic1-critical .fab-call');
  });

  it('uses deterministic fallback for missing saved Mic 1: LifeCam -> Microphone -> OFF', () => {
    expect(runtimeSource).toContain('function pickMic1FallbackId(mics, excludedIds = null)');
    expect(runtimeSource).toContain('isLifeCamLabel');
    expect(runtimeSource).toContain('isMicLabel');
    expect(runtimeSource).toContain('savedMissingMic1');
    expect(runtimeSource).toContain('Strict Mic 1 downgrade when configured device disappeared: LifeCam -> Microphone -> OFF.');
    expect(runtimeSource).toContain('if (!preferred && savedMissingMic1)');
    expect(runtimeSource).toContain('preferred = pickMic1FallbackId(mics, blocked) || null;');
  });
});
