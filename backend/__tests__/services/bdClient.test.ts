import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const spawnMock = jest.fn();
const loggerInfoMock = jest.fn();

type SpawnPlan = {
  code: number | null;
  stdout?: string;
  stderr?: string;
  signal?: NodeJS.Signals | null;
};

type SpawnChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: jest.Mock;
};

jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnMock,
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  getLogger: () => ({
    info: loggerInfoMock,
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const { createBdIssue } = await import('../../src/services/bdClient.js');

const createSpawnChild = (plan: SpawnPlan): SpawnChild => {
  const child = new EventEmitter() as SpawnChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn();

  queueMicrotask(() => {
    if (plan.stdout) child.stdout.write(plan.stdout);
    if (plan.stderr) child.stderr.write(plan.stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', plan.code, plan.signal ?? null);
  });

  return child;
};

const queueSpawnPlans = (plans: SpawnPlan[]) => {
  const queue = [...plans];
  spawnMock.mockImplementation(() => {
    const next = queue.shift();
    if (!next) {
      throw new Error('Unexpected spawn call without a queued plan');
    }
    return createSpawnChild(next);
  });
};

describe('bdClient.createBdIssue', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    spawnMock.mockReset();
    loggerInfoMock.mockReset();
    delete process.env.VOICEBOT_CODEX_BD_BIN;
    delete process.env.VOICEBOT_CODEX_REVIEW_BD_BIN;
  });

  it('runs bd create with assignee/external-ref and returns parsed issue id', async () => {
    process.env.VOICEBOT_CODEX_BD_BIN = 'custom-bd';
    queueSpawnPlans([
      {
        code: 0,
        stdout: JSON.stringify({ id: 'copilot-123' }),
      },
    ]);

    const issueId = await createBdIssue({
      title: 'Codex issue title',
      description: 'Codex issue body',
      assignee: 'vp',
      externalRef: 'https://copilot.stratospace.fun/voice/session/abc',
      priority: '1',
      issueType: 'task',
    });

    expect(issueId).toBe('copilot-123');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe('custom-bd');
    expect(args).toEqual(
      expect.arrayContaining([
        '--no-daemon',
        'create',
        'Codex issue title',
        '--json',
        '--type',
        'task',
        '--description',
        'Codex issue body',
        '--priority',
        '1',
        '-a',
        'vp',
        '--external-ref',
        'https://copilot.stratospace.fun/voice/session/abc',
      ])
    );
  });

  it('parses line-delimited json output and extracts issue id', async () => {
    queueSpawnPlans([
      {
        code: 0,
        stdout: [
          'Created issue',
          '{"id":"copilot-456","title":"line json"}',
          'Done',
        ].join('\n'),
      },
    ]);

    await expect(
      createBdIssue({
        title: 'Line JSON output',
        description: 'body',
      })
    ).resolves.toBe('copilot-456');
  });

  it('throws stderr message when bd create exits with non-zero code', async () => {
    queueSpawnPlans([
      {
        code: 2,
        stderr: 'bd create failed',
      },
    ]);

    await expect(
      createBdIssue({
        title: 'Failure case',
        description: 'body',
      })
    ).rejects.toThrow('bd create failed');
  });

  it('throws bd_create_no_issue_id when stdout has no issue id payload', async () => {
    queueSpawnPlans([
      {
        code: 0,
        stdout: '{"ok":true}',
      },
    ]);

    await expect(
      createBdIssue({
        title: 'No issue id',
        description: 'body',
      })
    ).rejects.toThrow(/bd_create_no_issue_id/);
  });
});
