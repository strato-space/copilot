import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const spawnMock = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnMock,
}));

const {
  handleNotifyJob,
  resetNotifyHooksCacheForTests,
} = await import('../../src/workers/voicebot/handlers/notify.js');

describe('voicebot notify worker hooks runner', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VOICE_BOT_NOTIFIES_URL;
    delete process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN;
    delete process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG;
    resetNotifyHooksCacheForTests();
    spawnMock.mockReset();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetNotifyHooksCacheForTests();
    spawnMock.mockReset();
    jest.restoreAllMocks();
  });

  it('runs local YAML hook in fire-and-forget mode even when HTTP notify is not configured', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-notify-hooks-'));
    const hooksPath = path.join(tempDir, 'notifies.hooks.yaml');
    fs.writeFileSync(
      hooksPath,
      [
        'session_ready_to_summarize:',
        '  - cmd: /usr/local/bin/uv',
        '    args:',
        '      - --directory',
        '      - /home/strato-space/prompt/StratoProject/app',
        '      - run',
        '      - StratoProject.py',
        '      - --model',
        '      - codex',
        '      - -m',
      ].join('\n'),
      'utf8'
    );

    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = hooksPath;

    const childStub = {
      pid: 4242,
      on: jest.fn(),
      unref: jest.fn(),
    };
    spawnMock.mockReturnValue(childStub);

    const result = await handleNotifyJob({
      event: 'session_ready_to_summarize',
      session_id: 'abc',
      payload: { project_id: 'pmo-id' },
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('notify_url_or_token_not_configured');
    expect(result.hooks_started).toBe(1);
    expect(result.config_path).toBe(hooksPath);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('/usr/local/bin/uv');
    expect(args.slice(0, 7)).toEqual([
      '--directory',
      '/home/strato-space/prompt/StratoProject/app',
      'run',
      'StratoProject.py',
      '--model',
      'codex',
      '-m',
    ]);

    const eventJsonArg = args[args.length - 1];
    const parsed = JSON.parse(eventJsonArg) as Record<string, unknown>;
    expect(parsed.event).toBe('session_ready_to_summarize');
    expect(parsed.payload).toEqual({
      project_id: 'pmo-id',
      session_id: 'abc',
    });
  });

  it('supports explicit disable via empty VOICE_BOT_NOTIFY_HOOKS_CONFIG', async () => {
    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = '';

    const result = await handleNotifyJob({
      event: 'session_ready_to_summarize',
      payload: { project_id: 'pmo-id' },
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('notify_url_or_token_not_configured');
    expect(result.hooks_started).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('sends HTTP notify and still starts hooks', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-notify-hooks-'));
    const hooksPath = path.join(tempDir, 'notifies.hooks.yaml');
    fs.writeFileSync(
      hooksPath,
      ['session_done:', '  - cmd: /bin/echo', '    args: ["hello"]'].join('\n'),
      'utf8'
    );

    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = hooksPath;
    process.env.VOICE_BOT_NOTIFIES_URL = 'https://call-actions.stratospace.fun/notify';
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'token';

    const childStub = {
      pid: 777,
      on: jest.fn(),
      unref: jest.fn(),
    };
    spawnMock.mockReturnValue(childStub);

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await handleNotifyJob({
      event: 'session_done',
      session_id: 'abc',
      payload: { from: 'test' },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.hooks_started).toBe(1);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(String(requestInit.body));
    expect(requestBody).toEqual({
      event: 'session_done',
      payload: {
        from: 'test',
        session_id: 'abc',
      },
    });
  });
});
