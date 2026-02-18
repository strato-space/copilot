import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const buildIngressDepsMock = jest.fn((args: Record<string, unknown>) => args);
const handleVoiceIngressMock = jest.fn(async () => ({ ok: true }));
const handleTextIngressMock = jest.fn(async () => ({ ok: true }));
const handleAttachmentIngressMock = jest.fn(async () => ({ ok: true }));

jest.unstable_mockModule('../../src/voicebot_tgbot/ingressHandlers.js', () => ({
  buildIngressDeps: buildIngressDepsMock,
  handleVoiceIngress: handleVoiceIngressMock,
  handleTextIngress: handleTextIngressMock,
  handleAttachmentIngress: handleAttachmentIngressMock,
}));

const {
  buildCommonIngressContext,
  extractForwardedContext,
  installNonCommandHandlers,
  isCommandText,
} = await import('../../src/voicebot_tgbot/runtimeNonCommandHandlers.js');

type Handler = (ctx: Record<string, unknown>) => Promise<void> | void;

const createBot = () => {
  const handlers = new Map<string, Handler>();
  const bot = {
    on: jest.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
  };
  return {
    bot,
    handlers,
  };
};

const makeDeps = () => ({
  getDb: jest.fn(() => ({ collection: jest.fn() }) as any),
  logger: {
    warn: jest.fn(),
  },
  commonQueue: {
    add: jest.fn(async () => ({ id: 'common-job' })),
  },
  voiceQueue: {
    add: jest.fn(async () => ({ id: 'voice-job' })),
  },
  serializeForLog: (value: unknown) => JSON.stringify(value),
});

describe('runtimeNonCommandHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    handleVoiceIngressMock.mockResolvedValue({ ok: true });
    handleTextIngressMock.mockResolvedValue({ ok: true });
    handleAttachmentIngressMock.mockResolvedValue({ ok: true });
  });

  it('extracts forwarded context and reply text into common ingress context', () => {
    const ctx = {
      from: { id: 1001, username: 'tester' },
      chat: { id: -1002003 },
      message: {
        message_id: 77,
        date: 1770500400,
        text: 'forwarded text',
        caption: 'caption',
        reply_to_message: { text: 'reply has session ref' },
        forward_date: 1770500000,
        forward_origin: { type: 'channel', chat: { id: -1001 } },
      },
    } as any;

    const forwarded = extractForwardedContext(ctx.message);
    expect(forwarded).toEqual(
      expect.objectContaining({
        forward_date: 1770500000,
        forward_origin: expect.objectContaining({ type: 'channel' }),
      })
    );

    const common = buildCommonIngressContext(ctx);
    expect(common).toEqual(
      expect.objectContaining({
        telegram_user_id: 1001,
        chat_id: -1002003,
        username: 'tester',
        reply_text: 'reply has session ref',
        forwarded_context: forwarded,
      })
    );
  });

  it('detects slash commands and non-commands correctly', () => {
    expect(isCommandText('/help')).toBe(true);
    expect(isCommandText('/session 69953b9207290561f6e9c96a')).toBe(true);
    expect(isCommandText('plain text')).toBe(false);
    expect(isCommandText('')).toBe(false);
  });

  it('registers handlers and routes voice ingress payload', async () => {
    const { bot, handlers } = createBot();
    const deps = makeDeps();
    installNonCommandHandlers(bot as any, deps as any);

    expect(bot.on).toHaveBeenCalledTimes(5);

    const voiceHandler = handlers.get('voice');
    expect(voiceHandler).toBeDefined();

    await voiceHandler?.({
      from: { id: 2001, username: 'voice-user' },
      chat: { id: 2001 },
      message: {
        message_id: 88,
        date: 1770500500,
        voice: {
          file_id: 'tg-voice-1',
          file_unique_id: 'uniq-voice-1',
          duration: 11,
          mime_type: 'audio/ogg',
        },
      },
    });

    expect(handleVoiceIngressMock).toHaveBeenCalledTimes(1);
    const voiceCall = handleVoiceIngressMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const voiceInput = voiceCall.input as Record<string, unknown>;
    expect(voiceInput).toMatchObject({
      telegram_user_id: 2001,
      file_id: 'tg-voice-1',
      file_unique_id: 'uniq-voice-1',
      duration: 11,
      mime_type: 'audio/ogg',
    });
    expect(buildIngressDepsMock).toHaveBeenCalled();
  });

  it('skips text ingress for blank and command text messages', async () => {
    const { bot, handlers } = createBot();
    const deps = makeDeps();
    installNonCommandHandlers(bot as any, deps as any);

    const textHandler = handlers.get('text');
    expect(textHandler).toBeDefined();

    await textHandler?.({
      from: { id: 2002 },
      chat: { id: 2002 },
      message: { text: '   ' },
    });
    await textHandler?.({
      from: { id: 2002 },
      chat: { id: 2002 },
      message: { text: '/done' },
    });

    expect(handleTextIngressMock).not.toHaveBeenCalled();
  });

  it('routes photo/document/audio attachments and logs warnings on ingress failure', async () => {
    handleAttachmentIngressMock
      .mockResolvedValueOnce({ ok: false, error: 'photo_fail' })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const { bot, handlers } = createBot();
    const deps = makeDeps();
    installNonCommandHandlers(bot as any, deps as any);

    const photoHandler = handlers.get('photo');
    const documentHandler = handlers.get('document');
    const audioHandler = handlers.get('audio');

    await photoHandler?.({
      from: { id: 2003 },
      chat: { id: 2003 },
      message: {
        caption: 'photo caption',
        photo: [
          { file_id: 'small', file_size: 10, width: 50, height: 50 },
          { file_id: 'big', file_size: 100, width: 200, height: 200, file_unique_id: 'big-uniq' },
        ],
      },
    });

    await documentHandler?.({
      from: { id: 2003 },
      chat: { id: 2003 },
      message: {
        caption: 'doc caption',
        document: { file_id: 'doc-file-1', file_name: 'doc.pdf', mime_type: 'application/pdf', file_size: 512 },
      },
    });

    await audioHandler?.({
      from: { id: 2003 },
      chat: { id: 2003 },
      message: {
        caption: 'audio caption',
        audio: { file_id: 'audio-file-1', file_name: 'note.ogg', mime_type: 'audio/ogg', file_size: 2048 },
      },
    });

    expect(handleAttachmentIngressMock).toHaveBeenCalledTimes(3);

    const photoInput = (handleAttachmentIngressMock.mock.calls[0]?.[0] as Record<string, unknown>).input as Record<
      string,
      unknown
    >;
    expect(photoInput.message_type).toBe('screenshot');
    expect(photoInput.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file_id: 'big', file_unique_id: 'big-uniq' }),
      ])
    );

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[tgbot-runtime] photo_ingress_failed')
    );
  });
});
