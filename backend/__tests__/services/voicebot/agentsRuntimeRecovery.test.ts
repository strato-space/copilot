import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const readFileMock = jest.fn();
const copyFileMock = jest.fn();
const mkdirMock = jest.fn();
const execFileMock = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  copyFile: copyFileMock,
  mkdir: mkdirMock,
}));

jest.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

import {
  attemptAgentsQuotaRecovery,
  resetAgentsQuotaRecoveryStateForTests,
} from '../../../src/services/voicebot/agentsRuntimeRecovery.js';

describe('attemptAgentsQuotaRecovery', () => {
  beforeEach(() => {
    readFileMock.mockReset();
    copyFileMock.mockReset();
    mkdirMock.mockReset();
    execFileMock.mockReset();
    resetAgentsQuotaRecoveryStateForTests();
  });

  it('skips copy and restart when auth.json is unchanged', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from('same-auth'))
      .mockResolvedValueOnce(Buffer.from('same-auth'));
    mkdirMock.mockResolvedValue(undefined);

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'status=429 usage_limit_reached',
    });

    expect(recovered).toBe(false);
    expect(copyFileMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('copies auth and restarts agents when auth.json changed', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from('fresh-auth'))
      .mockResolvedValueOnce(Buffer.from('stale-auth'));
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    execFileMock.mockImplementation((_file: string, _args: string[], _opts: Record<string, unknown>, cb: (error: Error | null, stdout?: string, stderr?: string) => void) => {
      cb(null, 'restarted', '');
      return {} as never;
    });

    const recovered = await attemptAgentsQuotaRecovery({
      reason: 'status=429 usage_limit_reached',
    });

    expect(recovered).toBe(true);
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
