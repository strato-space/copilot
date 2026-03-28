import fs from 'node:fs';
import path from 'node:path';

describe('Voice activate_session resilience contract', () => {
  const storePath = path.resolve(process.cwd(), 'src/store/voiceBotStore.ts');
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const webrtcPath = path.resolve(process.cwd(), 'public/webrtc/webrtc-voicebot-lib.js');
  const webrtcSource = fs.readFileSync(webrtcPath, 'utf8');
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function extractStoreMethodBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    if (start < 0) throw new Error(`Method not found: ${signature}`);
    const open = source.indexOf('{', start + signature.length - 1);
    if (open < 0) throw new Error(`Method body not found: ${signature}`);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(open + 1, i);
      }
    }
    throw new Error(`Method closing brace not found: ${signature}`);
  }

  const activateSessionBody = extractStoreMethodBody(storeSource, 'activateSession: async (sessionId) => {');
  const executableActivateSessionBody = activateSessionBody
    .replace('(error: unknown): boolean =>', '(error) =>')
    .replace(/ as Record<string, unknown> \| undefined/g, '');

  function createActivateSession(deps: {
    axiosLike: { isAxiosError: (error: unknown) => boolean };
    voicebotHttp: {
      request: (endpoint: string, payload: unknown) => Promise<unknown>;
      isTransientError: (error: unknown) => boolean;
    };
    get: () => { voiceBotSession?: { _id?: string } | null };
  }): (sessionId: string) => Promise<boolean> {
    const factory = new Function(
      'deps',
      `
      const axios = deps.axiosLike;
      const voicebotHttp = deps.voicebotHttp;
      const get = deps.get;
      const window = { setTimeout: (cb) => cb() };
      const console = deps.console;
      const activateSession = async (sessionId) => {
        ${executableActivateSessionBody}
      };
      return activateSession;
      `,
    );
    return factory({ ...deps, console }) as (sessionId: string) => Promise<boolean>;
  }

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries transient activate_session errors and succeeds after recovery', async () => {
    const errors = [new Error('timeout-1'), new Error('timeout-2')];
    const request = jest.fn(async () => {
      if (errors.length > 0) throw errors.shift();
      return {};
    });
    const activateSession = createActivateSession({
      axiosLike: { isAxiosError: () => false },
      voicebotHttp: {
        request,
        isTransientError: () => true,
      },
      get: () => ({ voiceBotSession: { _id: 'session-123' } }),
    });

    await expect(activateSession('session-123')).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      'Повтор активации сессии после сетевой ошибки',
      expect.objectContaining({
        sessionId: 'session-123',
        attempt: 1,
        maxAttempts: 3,
        retryDelayMs: 250,
      })
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      'Повтор активации сессии после сетевой ошибки',
      expect.objectContaining({
        sessionId: 'session-123',
        attempt: 2,
        maxAttempts: 3,
        retryDelayMs: 500,
      })
    );
  });

  it('does not treat 409 session_inactive as successful local fallback activation', async () => {
    const inactiveConflict = {
      __isAxiosError: true,
      response: {
        status: 409,
        data: { error: 'session_inactive' },
      },
    };
    const request = jest.fn(async () => {
      throw inactiveConflict;
    });
    const activateSession = createActivateSession({
      axiosLike: { isAxiosError: (error) => Boolean((error as { __isAxiosError?: boolean })?.__isAxiosError) },
      voicebotHttp: {
        request,
        isTransientError: () => false,
      },
      get: () => ({ voiceBotSession: { _id: 'session-123' } }),
    });

    await expect(activateSession('session-123')).resolves.toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Ошибка при активации сессии:', inactiveConflict);
    expect(warnSpy).toHaveBeenCalledWith(
      'Локальный fallback активации отменен: сессия уже закрыта на сервере',
      expect.objectContaining({ sessionId: 'session-123' })
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      'Повтор активации сессии после сетевой ошибки',
      expect.anything()
    );
  });

  it('uses retry + degraded fallback for activate_session in webrtc runtime', () => {
    expect(webrtcSource).toContain('function isTransientActivationError(error)');
    expect(webrtcSource).toContain("credentials: 'include'");
    expect(webrtcSource).toContain('[activate_session] transient failure; retrying');
    expect(webrtcSource).toContain("logApi('activate_session.degraded'");
  });
});
