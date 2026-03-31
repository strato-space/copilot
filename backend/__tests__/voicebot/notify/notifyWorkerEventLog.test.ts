import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

const spawnMock = jest.fn();
const getDbMock = jest.fn();
const insertSessionLogEventMock = jest.fn();
const writeSummaryAuditLogMock = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: spawnMock,
}));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/services/voicebotSessionLog.js', () => ({
  insertSessionLogEvent: insertSessionLogEventMock,
}));

jest.unstable_mockModule('../../../src/services/voicebot/voicebotDoneNotify.js', () => ({
  writeSummaryAuditLog: writeSummaryAuditLogMock,
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
    writeSummaryAuditLogMock.mockReset();
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
    writeSummaryAuditLogMock.mockReset();
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

  it('writes notify_http_failed when summarize notify returns empty 2xx ack', async () => {
    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = '';
    process.env.VOICE_BOT_NOTIFIES_URL = 'https://call-actions.stratospace.fun/notify';
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'token';

    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response);

    const result = await handleNotifyJob({
      event: 'session_ready_to_summarize',
      session_id: '699f70000000000000000013',
      payload: {
        project_id: '699f70000000000000000001',
        correlation_id: 'corr-empty-ack',
        idempotency_key: '699f70000000000000000013:summary_telegram_send:corr-empty-ack',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: 'notify_http_semantic_ack_failed',
        status: 200,
      })
    );

    const failedCall = insertSessionLogEventMock.mock.calls.find(
      (call) => call[0]?.event_name === 'notify_http_failed'
    );
    expect(failedCall).toBeDefined();
    expect(failedCall?.[0]?.metadata?.reason).toBe('notify_http_semantic_ack_failed');
    expect(failedCall?.[0]?.metadata?.semantic_ack_reason).toBe('empty_body');
    expect(writeSummaryAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'summary_telegram_send',
        status: 'failed',
        correlation_id: 'corr-empty-ack',
        idempotency_key: '699f70000000000000000013:summary_telegram_send:corr-empty-ack',
      })
    );
  });

  it('writes durable hook failure when detached summarize hook exits with non-zero code', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-notify-log-'));
    const hooksPath = path.join(tempDir, 'notifies.hooks.yaml');
    fs.writeFileSync(hooksPath, ['session_ready_to_summarize:', '  - cmd: /bin/echo', '    args: ["run"]'].join('\n'));
    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = hooksPath;
    process.env.VOICE_BOT_NOTIFIES_URL = 'https://call-actions.stratospace.fun/notify';
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'token';

    const handlers = new Map<string, (...args: unknown[]) => void>();
    const childStub = {
      pid: 5002,
      on: jest.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        handlers.set(eventName, handler);
      }),
      unref: jest.fn(),
    };
    spawnMock.mockReturnValue(childStub);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accepted: true }),
    } as Response);

    const result = await handleNotifyJob({
      event: 'session_ready_to_summarize',
      session_id: '699f70000000000000000014',
      payload: {
        project_id: '699f70000000000000000001',
        correlation_id: 'corr-hook-exit',
        idempotency_key: '699f70000000000000000014:summary_telegram_send:corr-hook-exit',
      },
    });
    expect(result.ok).toBe(true);
    expect(writeSummaryAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'summary_telegram_send',
        status: 'pending',
        correlation_id: 'corr-hook-exit',
        idempotency_key: '699f70000000000000000014:summary_telegram_send:corr-hook-exit',
      })
    );

    const exitHandler = handlers.get('exit');
    expect(exitHandler).toBeDefined();
    exitHandler?.(130, null);
    await new Promise((resolve) => setImmediate(resolve));

    const hookFailedCall = insertSessionLogEventMock.mock.calls.find(
      (call) =>
        call[0]?.event_name === 'notify_hook_failed'
        && call[0]?.metadata?.reason === 'notify_hook_exit_non_zero'
    );
    expect(hookFailedCall).toBeDefined();
    expect(writeSummaryAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'summary_telegram_send',
        status: 'failed',
        correlation_id: 'corr-hook-exit',
        idempotency_key: '699f70000000000000000014:summary_telegram_send:corr-hook-exit',
      })
    );
  });

  it('marks summarize audit as failed when detached hook exceeds timeout after HTTP ack', async () => {
    jest.useFakeTimers();
    try {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-notify-log-'));
      const hooksPath = path.join(tempDir, 'notifies.hooks.yaml');
      fs.writeFileSync(hooksPath, ['session_ready_to_summarize:', '  - cmd: /bin/echo', '    args: ["run"]'].join('\n'));
      process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = hooksPath;
      process.env.VOICE_BOT_NOTIFIES_URL = 'https://call-actions.stratospace.fun/notify';
      process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'token';
      process.env.VOICE_BOT_NOTIFY_HOOK_TIMEOUT_MS = '1000';

      const childStub = {
        pid: 5004,
        on: jest.fn(),
        kill: jest.fn(),
        unref: jest.fn(),
      };
      spawnMock.mockReturnValue(childStub);
      jest.spyOn(process, 'kill').mockImplementation(() => true);
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ accepted: true }),
      } as Response);

      const result = await handleNotifyJob({
        event: 'session_ready_to_summarize',
        session_id: '699f70000000000000000016',
        payload: {
          project_id: '699f70000000000000000001',
          correlation_id: 'corr-hook-timeout',
          idempotency_key: '699f70000000000000000016:summary_telegram_send:corr-hook-timeout',
        },
      });
      expect(result.ok).toBe(true);

      jest.advanceTimersByTime(1100);
      await Promise.resolve();

      const failedAuditCall = writeSummaryAuditLogMock.mock.calls.find(
        (call) =>
          call[0]?.event_name === 'summary_telegram_send'
          && call[0]?.status === 'failed'
          && call[0]?.correlation_id === 'corr-hook-timeout'
      );
      expect(failedAuditCall).toBeDefined();
      expect(failedAuditCall?.[0]?.metadata?.reason).toBe('notify_hook_timeout');
      expect(failedAuditCall?.[0]?.metadata?.hook_timeout_ms).toBe(1000);

      const hookFailedCall = insertSessionLogEventMock.mock.calls.find(
        (call) =>
          call[0]?.event_name === 'notify_hook_failed'
          && call[0]?.metadata?.reason === 'notify_hook_timeout'
      );
      expect(hookFailedCall).toBeDefined();
    } finally {
      jest.useRealTimers();
      delete process.env.VOICE_BOT_NOTIFY_HOOK_TIMEOUT_MS;
    }
  });

  it('marks summarize audit done only after detached hook exits successfully', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-notify-log-'));
    const hooksPath = path.join(tempDir, 'notifies.hooks.yaml');
    fs.writeFileSync(hooksPath, ['session_ready_to_summarize:', '  - cmd: /bin/echo', '    args: ["run"]'].join('\n'));
    process.env.VOICE_BOT_NOTIFY_HOOKS_CONFIG = hooksPath;
    process.env.VOICE_BOT_NOTIFIES_URL = 'https://call-actions.stratospace.fun/notify';
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'token';

    const handlers = new Map<string, (...args: unknown[]) => void>();
    const childStub = {
      pid: 5003,
      on: jest.fn((eventName: string, handler: (...args: unknown[]) => void) => {
        handlers.set(eventName, handler);
      }),
      unref: jest.fn(),
    };
    spawnMock.mockReturnValue(childStub);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accepted: true }),
    } as Response);

    const result = await handleNotifyJob({
      event: 'session_ready_to_summarize',
      session_id: '699f70000000000000000015',
      payload: {
        project_id: '699f70000000000000000001',
        correlation_id: 'corr-hook-success',
        idempotency_key: '699f70000000000000000015:summary_telegram_send:corr-hook-success',
      },
    });
    expect(result.ok).toBe(true);
    expect(writeSummaryAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'summary_telegram_send',
        status: 'pending',
        correlation_id: 'corr-hook-success',
        idempotency_key: '699f70000000000000000015:summary_telegram_send:corr-hook-success',
      })
    );
    expect(writeSummaryAuditLogMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'summary_telegram_send',
        status: 'done',
        correlation_id: 'corr-hook-success',
      })
    );

    const exitHandler = handlers.get('exit');
    expect(exitHandler).toBeDefined();
    exitHandler?.(0, null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(writeSummaryAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: 'summary_telegram_send',
        status: 'done',
        correlation_id: 'corr-hook-success',
        idempotency_key: '699f70000000000000000015:summary_telegram_send:corr-hook-success',
      })
    );
  });
});
