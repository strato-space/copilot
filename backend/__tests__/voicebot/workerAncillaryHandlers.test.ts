import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { VOICEBOT_COLLECTIONS, VOICEBOT_JOBS } from '../../src/constants.js';

const getDbMock = jest.fn();

jest.unstable_mockModule('../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

const { handleStartMultipromptJob } = await import('../../src/workers/voicebot/handlers/startMultiprompt.js');
const { handleSendToSocketJob } = await import('../../src/workers/voicebot/handlers/sendToSocket.js');
const { handleNotifyJob } = await import('../../src/workers/voicebot/handlers/notify.js');
const { VOICEBOT_WORKER_MANIFEST } = await import('../../src/workers/voicebot/manifest.js');

describe('voicebot ancillary worker handlers', () => {
  const originalFetch = global.fetch;
  const originalNotifyUrl = process.env.VOICE_BOT_NOTIFIES_URL;
  const originalNotifyToken = process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN;

  beforeEach(() => {
    getDbMock.mockReset();
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    process.env.VOICE_BOT_NOTIFIES_URL = originalNotifyUrl;
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = originalNotifyToken;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  it('marks session as waiting for START_MULTIPROMPT', async () => {
    const sessionId = new ObjectId();
    const updateOne = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));

    getDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === VOICEBOT_COLLECTIONS.SESSIONS) return { updateOne };
        return {};
      },
    });

    const result = await handleStartMultipromptJob({
      _id: sessionId.toHexString(),
      chat_id: 3045664,
    });

    expect(result).toMatchObject({ ok: true, session_id: sessionId.toHexString(), updated: true });
    expect(updateOne).toHaveBeenCalledTimes(1);

    const [query, update] = updateOne.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(String(query._id)).toBe(sessionId.toHexString());
    expect(update.$set).toEqual(
      expect.objectContaining({
        is_waiting: true,
      })
    );
  });

  it('skips SEND_TO_SOCKET in standalone worker runtime', async () => {
    const result = await handleSendToSocketJob({
      session_id: '69963fb37d45b98d3fbc0344',
      event: 'session_update',
      payload: { ok: true },
    });

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: 'socket_runtime_not_available',
    });
  });

  it('skips notify when URL/token are not configured', async () => {
    delete process.env.VOICE_BOT_NOTIFIES_URL;
    delete process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN;

    const result = await handleNotifyJob(
      {
        session_id: '69963fb37d45b98d3fbc0344',
        payload: { foo: 'bar' },
      },
      VOICEBOT_JOBS.notifies.SESSION_DONE
    );

    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: 'notify_url_or_token_not_configured',
    });
    expect((global.fetch as unknown as jest.Mock).mock.calls.length).toBe(0);
  });

  it('sends notify envelope over HTTP when config is present', async () => {
    process.env.VOICE_BOT_NOTIFIES_URL = 'https://notify.stratospace.fun/hook';
    process.env.VOICE_BOT_NOTIFIES_BEARER_TOKEN = 'test-token';

    (global.fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    });

    const sessionId = '69963fb37d45b98d3fbc0344';
    const result = await handleNotifyJob(
      {
        session_id: sessionId,
        payload: { source: 'test' },
      },
      VOICEBOT_JOBS.notifies.SESSION_DONE
    );

    expect(result).toEqual({ ok: true, status: 200 });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = (global.fetch as unknown as jest.Mock).mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://notify.stratospace.fun/hook');
    expect(options.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      })
    );

    const payload = JSON.parse(String(options.body));
    expect(payload).toEqual({
      event: VOICEBOT_JOBS.notifies.SESSION_DONE,
      payload: {
        source: 'test',
        session_id: sessionId,
      },
    });
  });

  it('manifest includes start/events/notifies handlers', () => {
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.common.START_MULTIPROMPT]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.events.SEND_TO_SOCKET]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.notifies.SESSION_DONE]).toBeDefined();
    expect(VOICEBOT_WORKER_MANIFEST[VOICEBOT_JOBS.notifies.SESSION_READY_TO_SUMMARIZE]).toBeDefined();
  });
});
