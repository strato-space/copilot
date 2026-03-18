import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const readFileMock = jest.fn();
const copyFileMock = jest.fn();
const mkdirMock = jest.fn();
const writeFileMock = jest.fn();
const execFileMock = jest.fn();

jest.unstable_mockModule('node:fs/promises', () => ({
  readFile: readFileMock,
  copyFile: copyFileMock,
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

jest.unstable_mockModule('node:child_process', () => ({
  execFile: execFileMock,
}));

const {
  attemptAgentsQuotaRecovery,
  resetAgentsQuotaRecoveryStateForTests,
} = await import('../../../src/services/voicebot/agentsRuntimeRecovery.js');

describe('attemptAgentsQuotaRecovery', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    readFileMock.mockReset();
    copyFileMock.mockReset();
    mkdirMock.mockReset();
    writeFileMock.mockReset();
    execFileMock.mockReset();
    fetchMock.mockReset();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    resetAgentsQuotaRecoveryStateForTests();
  });

  it('skips copy and restart when auth.json and default_model are already aligned', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'other-account' } })))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'other-account' } })))
      .mockResolvedValueOnce(Buffer.from('default_model: codexplan\n'));
    mkdirMock.mockResolvedValue(undefined);

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'status=429 usage_limit_reached',
    });

    expect(recovered).toBe(false);
    expect(copyFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('copies auth and restarts agents when auth.json changed', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'other-account' } })))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'stale-account' } })))
      .mockResolvedValueOnce(Buffer.from('default_model: codexplan\n'));
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: Record<string, unknown>, cb: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      cb(null, 'restarted', '');
      return {} as never;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'status=429 usage_limit_reached',
    });

    expect(recovered).toBe(true);
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('treats invalid-auth reasons as recoverable input', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'other-account' } })))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'stale-account' } })))
      .mockResolvedValueOnce(Buffer.from('default_model: codexplan\n'));
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: Record<string, unknown>, cb: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      cb(null, 'restarted', '');
      return {} as never;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'Error executing tool create_tasks: Invalid OpenAI API key. The configured OpenAI API key was rejected. status=401',
    });

    expect(recovered).toBe(true);
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('updates fast-agent default_model and restarts even when auth bytes are unchanged', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'd72d46e8-41f3-47c1-ba22-98c52b3f6448' } })))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'd72d46e8-41f3-47c1-ba22-98c52b3f6448' } })))
      .mockResolvedValueOnce(Buffer.from('default_model: codexplan\n'));
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: Record<string, unknown>, cb: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      cb(null, 'restarted', '');
      return {} as never;
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'manual-auth-sync',
    });

    expect(recovered).toBe(true);
    expect(copyFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledWith(
      '/home/strato-space/copilot/agents/fastagent.config.yaml',
      'default_model: codexspark',
      'utf8'
    );
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('returns false when agents restart completes but MCP readiness never comes back', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'other-account' } })))
      .mockResolvedValueOnce(Buffer.from(JSON.stringify({ tokens: { account_id: 'stale-account' } })))
      .mockResolvedValueOnce(Buffer.from('default_model: codexplan\n'));
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: Record<string, unknown>, cb: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      cb(null, 'restarted', '');
      return {} as never;
    });
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8722'));

    let tick = 300_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      tick += 10_000;
      return tick;
    });

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'status=429 usage_limit_reached',
    });

    nowSpy.mockRestore();

    expect(recovered).toBe(false);
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});
