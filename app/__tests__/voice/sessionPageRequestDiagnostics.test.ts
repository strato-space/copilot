import fs from 'node:fs';
import path from 'node:path';

describe('Session fetch UX and request diagnostics parity', () => {
  const sessionPagePath = path.resolve(process.cwd(), 'src/pages/voice/SessionPage.tsx');
  const httpPath = path.resolve(process.cwd(), 'src/store/voicebotHttp.ts');
  const sessionPageSource = fs.readFileSync(sessionPagePath, 'utf8');
  const httpSource = fs.readFileSync(httpPath, 'utf8');

  it('maps session fetch errors to dedicated 404/409 UX states', () => {
    expect(sessionPageSource).toContain('axios.isAxiosError(error) && error.response?.status === 409');
    expect(sessionPageSource).toContain('Сессия недоступна в текущем runtime (prod/dev mismatch)');
    expect(sessionPageSource).toContain('axios.isAxiosError(error) && error.response?.status === 404');
    expect(sessionPageSource).toContain("setLoadError('Сессия не найдена')");
    expect(sessionPageSource).toContain("setLoadError('Не удалось загрузить сессию')");
  });

  it('logs enriched diagnostics for voicebot request failures', () => {
    expect(httpSource).toContain("console.error('[voicebot] request failed'");
    expect(httpSource).toContain('endpoint,');
    expect(httpSource).toContain('targetUrl,');
    expect(httpSource).toContain('status: status ?? null');
    expect(httpSource).toContain('runtimeMismatch =');
    expect(httpSource).toContain('status === 409');
    expect(httpSource).toContain("error === 'runtime_mismatch'");
    expect(httpSource).toContain('response: error.response?.data ?? null');
  });
});
