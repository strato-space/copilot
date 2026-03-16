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
  beforeEach(() => {
    readFileMock.mockReset();
    copyFileMock.mockReset();
    mkdirMock.mockReset();
    writeFileMock.mockReset();
    execFileMock.mockReset();
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

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'status=429 usage_limit_reached',
    });

    expect(recovered).toBe(true);
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).not.toHaveBeenCalled();
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
});
