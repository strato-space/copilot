import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  CODEX_TASK_CHAT_ID,
  CODEX_IMAGE_CHAT_ID,
  buildDevVoiceWebInterfaceUrl,
  getActiveVoiceSessionForUserMock,
  setActiveVoiceSessionMock,
  makeDb,
  buildIngressDeps,
  handleAttachmentIngress,
  handleTextIngress,
  resetTgIngressMocks,
} from './tgIngressHandlers.test.helpers.js';

describe('voicebot tgbot ingress handlers', () => {
  beforeEach(() => {
    resetTgIngressMocks();
  });

  it('stores @task payload on session and creates codex task with canonical external_ref', async () => {
    const performerId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const projectId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '2010' },
      codexPerformer: { _id: codexPerformerId, id: 'codex', name: 'Codex', real_name: 'Codex' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        project_id: projectId,
        is_active: true,
      },
      codexProject: {
        _id: projectId,
        name: 'Copilot',
        git_repo: 'git@github.com:strato-space/copilot.git',
      },
    });
    process.env.VOICE_WEB_INTERFACE_URL = buildDevVoiceWebInterfaceUrl();

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 2010,
        chat_id: CODEX_TASK_CHAT_ID,
        username: 'codex-task-user',
        message_id: 120,
        message_timestamp: 1770500500,
        text: '@task Investigate billing mismatch for February',
      },
    });

    expect(result.ok).toBe(true);
    expect(spies.tasksInsertOne).toHaveBeenCalledTimes(1);

    const insertedTask = spies.tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(insertedTask.id || '')).toMatch(/^[a-z0-9-]+-\d{2}-\d{2}(?:-\d+)?$/);
    expect(insertedTask.source_kind).toBe('telegram');
    expect(insertedTask.created_by_performer_id).toEqual(performerId);
    expect(insertedTask.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`);
    expect(insertedTask.description).toContain('Investigate billing mismatch for February');

    const sourceData = insertedTask.source_data as Record<string, unknown>;
    const payload = sourceData.payload as Record<string, unknown>;
    expect(payload.trigger).toBe('@task');
    expect(payload.session_id).toBe(sessionId.toHexString());
    expect(payload.message_db_id).toBe(result.message_id);
    expect(payload.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${sessionId.toHexString()}`);

    const codexPayloadUpdate = spies.sessionsUpdateOne.mock.calls.find((call) => {
      const update = call[1] as Record<string, unknown> | undefined;
      const push = update?.$push as Record<string, unknown> | undefined;
      return Boolean(push && Object.prototype.hasOwnProperty.call(push, 'processors_data.CODEX_TASKS.data'));
    });
    expect(codexPayloadUpdate).toBeDefined();
  });

  it('auto-creates session with Codex project for @task when active session is missing', async () => {
    const performerId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const createdSessionId = new ObjectId();
    const projectId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue(null);

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '3010' },
      codexPerformer: { _id: codexPerformerId, id: 'codex', name: 'Codex', real_name: 'Codex' },
      createdSessionId,
      codexProject: {
        _id: projectId,
        name: 'Codex',
        git_repo: 'git@github.com:strato-space/copilot.git',
      },
    });

    const result = await handleTextIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 3010,
        chat_id: 3010,
        username: 'codex-autocreate-user',
        message_id: 150,
        message_timestamp: 1770500600,
        text: '@task Prepare Codex delivery checklist',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.created_session).toBe(true);
    expect(spies.sessionsInsertOne).toHaveBeenCalledTimes(1);
    expect(spies.tasksInsertOne).toHaveBeenCalledTimes(1);
    expect(setActiveVoiceSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: createdSessionId,
      })
    );

    const insertedSession = spies.sessionsInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedSession.project_id).toEqual(projectId);

    const insertedTask = spies.tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(insertedTask.id || '')).toMatch(/^[a-z0-9-]+-\d{2}-\d{2}(?:-\d+)?$/);
    const sourceData = insertedTask.source_data as Record<string, unknown>;
    expect(sourceData.session_id).toEqual(createdSessionId);
    expect(insertedTask.external_ref).toBe(`https://copilot.stratospace.fun/voice/session/${createdSessionId.toHexString()}`);
  });

  it('appends normalized public_attachment links to @task task descriptions for attachment ingress', async () => {
    const performerId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const projectId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '2020' },
      codexPerformer: { _id: codexPerformerId, id: 'codex', name: 'Codex', real_name: 'Codex' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        project_id: projectId,
        is_active: true,
      },
      codexProject: {
        _id: projectId,
        name: 'Copilot',
        git_repo: 'git@github.com:strato-space/copilot.git',
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 2020,
        chat_id: CODEX_TASK_CHAT_ID,
        username: 'codex-task-user',
        message_id: 121,
        message_timestamp: 1770500510,
        text: '@task Review attached files before triage',
        message_type: 'document',
        attachments: [
          {
            kind: 'file',
            source: 'telegram',
            file_id: 'doc-file-1',
            file_unique_id: 'uniq-doc-1',
            name: 'invoice.pdf',
            mimeType: 'application/pdf',
          },
          {
            kind: 'image',
            source: 'telegram',
            file_id: 'image-file-2',
            uri: '/voicebot/public_attachment/legacy-session/legacy-uniq',
            mimeType: 'image/png',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(spies.tasksInsertOne).toHaveBeenCalledTimes(1);

    const insertedTask = spies.tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    const description = String(insertedTask.description || '');
    expect(description).toContain('Review attached files before triage');
    expect(description).toContain(
      `\n\nAttachments:\n- https://copilot.stratospace.fun/api/voicebot/public_attachment/${sessionId.toHexString()}/uniq-doc-1`
    );
    expect(description).toContain(
      '- https://copilot.stratospace.fun/api/voicebot/public_attachment/legacy-session/legacy-uniq'
    );
    expect(description).toContain(
      `\n\nAttachment reverse links:\n- https://copilot.stratospace.fun/api/voicebot/message_attachment/${result.message_id}/0`
    );
    expect(description).toContain(
      `- https://copilot.stratospace.fun/api/voicebot/message_attachment/${result.message_id}/1`
    );

    const sourceData = insertedTask.source_data as Record<string, unknown>;
    const payload = sourceData.payload as Record<string, unknown>;
    const payloadAttachments = payload.attachments as Array<Record<string, unknown>>;
    expect(Array.isArray(payloadAttachments)).toBe(true);
    expect(payloadAttachments).toHaveLength(2);
    expect(payloadAttachments[0]?.public_url).toBe(
      `https://copilot.stratospace.fun/api/voicebot/public_attachment/${sessionId.toHexString()}/uniq-doc-1`
    );
    expect(payloadAttachments[0]?.reverse_uri).toBe(`/api/voicebot/message_attachment/${result.message_id}/0`);
    expect(payloadAttachments[1]?.uri).toBe('/voicebot/public_attachment/legacy-session/legacy-uniq');
    expect(payloadAttachments[1]?.reverse_url).toBe(
      `https://copilot.stratospace.fun/api/voicebot/message_attachment/${result.message_id}/1`
    );
    expect(sourceData.attachments).toEqual(payloadAttachments);
  });

  it('creates codex task from @task screenshot with image attachment and persists attachment links in source_data', async () => {
    const performerId = new ObjectId();
    const codexPerformerId = new ObjectId();
    const projectId = new ObjectId();
    const sessionId = new ObjectId();

    getActiveVoiceSessionForUserMock.mockResolvedValue({
      active_session_id: sessionId,
    });

    const { db, spies } = makeDb({
      performer: { _id: performerId, telegram_id: '2030' },
      codexPerformer: { _id: codexPerformerId, id: 'codex', name: 'Codex', real_name: 'Codex' },
      activeSession: {
        _id: sessionId,
        session_type: 'multiprompt_voice_session',
        project_id: projectId,
        is_active: true,
      },
      codexProject: {
        _id: projectId,
        name: 'Copilot',
        git_repo: 'git@github.com:strato-space/copilot.git',
      },
    });

    const result = await handleAttachmentIngress({
      deps: buildIngressDeps({ db }),
      input: {
        telegram_user_id: 2030,
        chat_id: CODEX_IMAGE_CHAT_ID,
        username: 'codex-image-user',
        message_id: 131,
        message_timestamp: 1770500520,
        text: '@task Validate screenshot anomaly and propose fix',
        message_type: 'screenshot',
        attachments: [
          {
            kind: 'image',
            source: 'telegram',
            file_id: 'image-file-3',
            file_unique_id: 'uniq-image-3',
            width: 1200,
            height: 800,
            mimeType: 'image/jpeg',
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(spies.tasksInsertOne).toHaveBeenCalledTimes(1);

    const insertedTask = spies.tasksInsertOne.mock.calls[0]?.[0] as Record<string, unknown>;
    const description = String(insertedTask.description || '');
    expect(description).toContain('Validate screenshot anomaly and propose fix');
    expect(description).toContain(
      `https://copilot.stratospace.fun/api/voicebot/public_attachment/${sessionId.toHexString()}/uniq-image-3`
    );
    expect(description).toContain(
      `https://copilot.stratospace.fun/api/voicebot/message_attachment/${result.message_id}/0`
    );

    const sourceData = insertedTask.source_data as Record<string, unknown>;
    const payload = sourceData.payload as Record<string, unknown>;
    expect(payload.message_type).toBe('screenshot');
    expect(payload.session_id).toBe(sessionId.toHexString());
    expect(payload.message_db_id).toBe(result.message_id);

    const payloadAttachments = payload.attachments as Array<Record<string, unknown>>;
    expect(Array.isArray(payloadAttachments)).toBe(true);
    expect(payloadAttachments).toHaveLength(1);
    expect(payloadAttachments[0]?.kind).toBe('image');
    expect(payloadAttachments[0]?.public_url).toBe(
      `https://copilot.stratospace.fun/api/voicebot/public_attachment/${sessionId.toHexString()}/uniq-image-3`
    );
    expect(payloadAttachments[0]?.reverse_uri).toBe(`/api/voicebot/message_attachment/${result.message_id}/0`);
    expect(payloadAttachments[0]?.reverse_url).toBe(
      `https://copilot.stratospace.fun/api/voicebot/message_attachment/${result.message_id}/0`
    );
    expect(sourceData.attachments).toEqual(payloadAttachments);
  });
});
