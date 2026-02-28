import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getDbMock = jest.fn();
const getLoggerMock = jest.fn();
const dbToken = { token: 'db' };
const loggerToken = { token: 'logger' };

getDbMock.mockReturnValue(dbToken);
getLoggerMock.mockReturnValue(loggerToken);

const buildIngressDepsMock = jest.fn((args: Record<string, unknown>) => ({
  marker: 'deps',
  ...args,
}));
const handleVoiceIngressMock = jest.fn(async () => ({ ok: true, route: 'voice' }));
const handleTextIngressMock = jest.fn(async () => ({ ok: true, route: 'text' }));
const handleAttachmentIngressMock = jest.fn(async () => ({ ok: true, route: 'attachment' }));

jest.unstable_mockModule('../../../src/services/db.js', () => ({
  getDb: getDbMock,
}));

jest.unstable_mockModule('../../../src/utils/logger.js', () => ({
  getLogger: getLoggerMock,
}));

jest.unstable_mockModule('../../../src/voicebot_tgbot/ingressHandlers.js', () => ({
  buildIngressDeps: buildIngressDepsMock,
  handleVoiceIngress: handleVoiceIngressMock,
  handleTextIngress: handleTextIngressMock,
  handleAttachmentIngress: handleAttachmentIngressMock,
}));

const { handleVoiceJob } = await import('../../../src/workers/voicebot/handlers/handleVoice.js');
const { handleTextJob } = await import('../../../src/workers/voicebot/handlers/handleText.js');
const { handleAttachmentJob } = await import('../../../src/workers/voicebot/handlers/handleAttachment.js');

describe('voicebot worker ingress wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDbMock.mockReturnValue(dbToken);
    getLoggerMock.mockReturnValue(loggerToken);
    handleVoiceIngressMock.mockResolvedValue({ ok: true, route: 'voice' });
    handleTextIngressMock.mockResolvedValue({ ok: true, route: 'text' });
    handleAttachmentIngressMock.mockResolvedValue({ ok: true, route: 'attachment' });
  });

  it('delegates HANDLE_VOICE payload to handleVoiceIngress', async () => {
    const result = await handleVoiceJob({ message: { file_id: 'voice-file', duration: 12 } });

    expect(result).toEqual({ ok: true, route: 'voice' });
    expect(buildIngressDepsMock).toHaveBeenCalledWith({ db: dbToken, logger: loggerToken });
    expect(handleVoiceIngressMock).toHaveBeenCalledWith({
      deps: expect.objectContaining({ marker: 'deps', db: dbToken, logger: loggerToken }),
      input: { file_id: 'voice-file', duration: 12 },
    });
  });

  it('delegates HANDLE_TEXT payload to handleTextIngress', async () => {
    const result = await handleTextJob({ message: { text: 'hello' } });

    expect(result).toEqual({ ok: true, route: 'text' });
    expect(buildIngressDepsMock).toHaveBeenCalledWith({ db: dbToken, logger: loggerToken });
    expect(handleTextIngressMock).toHaveBeenCalledWith({
      deps: expect.objectContaining({ marker: 'deps', db: dbToken, logger: loggerToken }),
      input: { text: 'hello' },
    });
  });

  it('delegates HANDLE_ATTACHMENT payload to handleAttachmentIngress and normalizes empty payload', async () => {
    const result = await handleAttachmentJob({});

    expect(result).toEqual({ ok: true, route: 'attachment' });
    expect(buildIngressDepsMock).toHaveBeenCalledWith({ db: dbToken, logger: loggerToken });
    expect(handleAttachmentIngressMock).toHaveBeenCalledWith({
      deps: expect.objectContaining({ marker: 'deps', db: dbToken, logger: loggerToken }),
      input: {},
    });
  });
});
