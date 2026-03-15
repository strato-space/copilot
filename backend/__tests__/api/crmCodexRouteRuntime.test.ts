import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const spawnMock = jest.fn();
const loggerInfoMock = jest.fn();
const loggerWarnMock = jest.fn();
const loggerErrorMock = jest.fn();

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
    warn: loggerWarnMock,
    error: loggerErrorMock,
  }),
}));

const { default: codexRouter } = await import('../../src/api/routes/crm/codex.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/crm/codex', codexRouter);
  return app;
};

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

describe('CRM codex route runtime behavior', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    jest.restoreAllMocks();
  });

  it('retries bd list after bd sync --import-only when out-of-sync is detected', async () => {
    queueSpawnPlans([
      {
        code: 2,
        stderr: "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.",
      },
      {
        code: 0,
        stdout: 'import ok',
      },
      {
        code: 0,
        stdout: JSON.stringify([{ id: 'copilot-abc', title: 'Recovered issue' }]),
      },
    ]);

    const app = buildApp();
    const response = await request(app).post('/crm/codex/issues').send({ view: 'open', limit: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'copilot-abc', title: 'Recovered issue' }]);

    expect(spawnMock).toHaveBeenCalledTimes(3);
    const [, firstArgs] = spawnMock.mock.calls[0] as [string, string[]];
    const [, secondArgs] = spawnMock.mock.calls[1] as [string, string[]];
    const [, thirdArgs] = spawnMock.mock.calls[2] as [string, string[]];
    expect(firstArgs).toEqual(['--no-daemon', 'list', '--json', '--limit', '5']);
    expect(secondArgs).toEqual(['sync', '--import-only']);
    expect(thirdArgs).toEqual(['--no-daemon', 'list', '--json', '--limit', '5']);
  });

  it('falls back to direct JSONL parse when out-of-sync sync-recovery fails for bd show', async () => {
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const stream = new PassThrough();
      queueMicrotask(() => {
        stream.end(JSON.stringify({ id: 'copilot-x0xn', title: 'Recovered issue', status: 'closed' }) + '\n');
      });
      return stream as unknown as fs.ReadStream;
    });

    queueSpawnPlans([
      {
        code: 1,
        stdout: 'database out of sync with jsonl',
      },
      {
        code: 1,
        stderr: 'Error: importing: error reading JSONL: bufio.Scanner: token too long',
      },
    ]);

    const app = buildApp();
    const response = await request(app).post('/crm/codex/issue').send({ id: 'copilot-x0xn' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'copilot-x0xn', title: 'Recovered issue', status: 'closed' });
    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [, secondArgs] = spawnMock.mock.calls[1] as [string, string[]];
    expect(secondArgs).toEqual(['sync', '--import-only']);
  });

  it('falls back to direct JSONL parse when bd list stays out-of-sync after import-only sync failure', async () => {
    jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
      const stream = new PassThrough();
      queueMicrotask(() => {
        stream.end([
          JSON.stringify({ id: 'copilot-open', title: 'Open issue', status: 'open' }),
          JSON.stringify({ id: 'copilot-closed', title: 'Closed issue', status: 'closed' }),
        ].join('\n'));
      });
      return stream as unknown as fs.ReadStream;
    });

    queueSpawnPlans([
      {
        code: 1,
        stdout: "Database out of sync with JSONL. Run 'bd sync --import-only' to fix.",
      },
      {
        code: 1,
        stderr: 'Error: importing: error reading JSONL: bufio.Scanner: token too long',
      },
    ]);

    const app = buildApp();
    const response = await request(app).post('/crm/codex/issues').send({ view: 'open', limit: 1000 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'copilot-open', title: 'Open issue', status: 'open' }]);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('maps bd show not-found failures to 404', async () => {
    queueSpawnPlans([
      {
        code: 1,
        stderr: 'Issue not found',
      },
    ]);

    const app = buildApp();
    const response = await request(app).post('/crm/codex/issue').send({ issue_id: 'copilot-missing' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Issue not found' });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
