import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

const spawnMock = jest.fn();
const getDbMock = jest.fn();
const insertSessionLogEventMock = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnMock,
}));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotSessionLog.js', () => ({
  insertSessionLogEvent: insertSessionLogEventMock,
}));

const {
  handleNotifyJob,
  resetNotifyHooksCacheForTests,
} = await import('../../../src/workers/voicebot/handlers/notifyHandler.js');

describe('voicebot notify worker session-log events', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.VOICE_BOT_NOTIFIES_URL;
    delete process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN;
    delete process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG;

    resetNotifyHooksCacheForTests();
    spawnMock.mockReset();
    getDbMock.mockReset();
    insertSessionLogEventMock.mockReset();
    jest.restoreAllMocks();

    const projectId = new ObjectId('699f70000000000000000001');
    const dbStub = {
      collection: jest.fn(() => ({
        findOne: jest.fn(async () => ({ project_id: projectId })),
      })),
    };

    getDbMock.mockReturnValue(dbStub);
    insertSessionLogEventMock.mockResolvedValue({ _id: new ObjectId() });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetNotifyHooksCacheForTests();
    spawnMock.mockReset();
    getDbMock.mockReset();
    insertSessionLogEventMock.mockReset();
    jest.restoreAllMocks();
  });

  it('writes notify_hook_started and notify_http_failed when hooks run but HTTP transport is not configured', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-notify-log-'));
    const hooksPath = path.join(tempDir, 'notifies.hooks.yaml');
    fs.writeFileSync(hooksPath, ['session_ready_to_summarize:', '  - cmd: /bin/echo', '    args: ["run"]'].join('\n'));
    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = hooksPath;

    const childStub = {
      pid: 5001,
      on: jest.fn(),
      unref: jest.fn(),
    };
    spawnMock.mockReturnValue(childStub);

    const result = await handleNotifyJob({
      event: 'session_ready_to_summarize',
      session_id: '699f70000000000000000011',
      payload: { project_id: '699f70000000000000000001' },
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.hooks_started).toBe(1);

    const eventNames = insertSessionLogEventMock.mock.calls.map((call) => call[0]?.event_name);
    expect(eventNames).toContain('notify_hook_started');
    expect(eventNames).toContain('notify_http_failed');

    const failedCall = insertSessionLogEventMock.mock.calls.find(
      (call) => call[0]?.event_name === 'notify_http_failed'
    );
    expect(failedCall?.[0]?.metadata?.reason).toBe('notify_url_or_token_not_configured');
  });

  it('writes notify_http_sent on successful HTTP notify', async () => {
    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = '';
    process.env.VOICE_BOT_NOTIFIES_URL = 'https://call-actions.stratospace.fun/notify';
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'token';

    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await handleNotifyJob({
      event: 'session_done',
      session_id: '699f70000000000000000012',
      payload: {},
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const sentCall = insertSessionLogEventMock.mock.calls.find(
      (call) => call[0]?.event_name === 'notify_http_sent'
    );
    expect(sentCall).toBeDefined();
    expect(sentCall?.[0]?.metadata?.status).toBe(200);
  });
});
