import fs from 'node:fs';
import path from 'node:path';

describe('Voice activate_session resilience contract', () => {
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const webrtcPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const webrtcSource = fs.readFileSync(webrtcPath, 'utf8');

  it('retries transient activate_session failures in voiceBotStore and keeps page session fallback', () => {
    expect(storeSource).toContain('const maxAttempts = 3;');
    expect(storeSource).toContain('const shouldRetry = attempt < maxAttempts && voicebotHttp.isTransientError(error);');
    expect(storeSource).toContain('Повтор активации сессии после сетевой ошибки');
    expect(storeSource).toContain('Локальный fallback активации: используем текущую открытую сессию');
  });

  it('uses retry + degraded fallback for activate_session in webrtc runtime', () => {
    expect(webrtcSource).toContain('function isTransientActivationError(error)');
    expect(webrtcSource).toContain("credentials: 'include'");
    expect(webrtcSource).toContain('[activate_session] transient failure; retrying');
    expect(webrtcSource).toContain("logApi('activate_session.degraded'");
  });
});
