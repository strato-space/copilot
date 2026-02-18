import fs from 'node:fs';
import path from 'node:path';

describe('Session fetch UX and request diagnostics parity', () => {
  const sessionPagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const sessionPageSource = fs.readFileSync(sessionPagePath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');

  it('shows dedicated runtime-mismatch message for 404 session fetch', () => {
    expect(sessionPageSource).toContain('axios.isAxiosError(error) && error.response?.status === 404');
    expect(sessionPageSource).toContain('Сессия недоступна в текущем runtime (prod/dev mismatch)');
    expect(sessionPageSource).toContain("setLoadError('Не удалось загрузить сессию')");
  });

  it('logs enriched diagnostics for voicebot request failures', () => {
    expect(storeSource).toContain("console.error('[voicebot] request failed'");
    expect(storeSource).toContain('endpoint,');
    expect(storeSource).toContain('targetUrl,');
    expect(storeSource).toContain('status: status ?? null');
    expect(storeSource).toContain('runtimeMismatch: status === 404');
    expect(storeSource).toContain('response: error.response?.data ?? null');
  });
});
