const { ObjectId } = require('mongodb');
const constants = require('../../constants');
const { buildMessageAiText } = require('../../services/voicebotAiContext');

describe('voicebotAiContext attachments blocks', () => {
    it('includes proxy attachment URLs for Telegram screenshots/documents in LLM context', () => {
        const messageId = new ObjectId();

        const message = {
            _id: messageId,
            message_id: 777,
            message_type: constants.voice_message_types.SCREENSHOT,
            source_type: constants.voice_message_sources.TELEGRAM,
            file_id: 'tg-file-id',
            attachments: [
                {
                    source: constants.voice_message_sources.TELEGRAM,
                    kind: constants.voice_message_types.SCREENSHOT,
                    caption: 'UI bug report',
                    file_id: 'tg-file-id',
                    file_unique_id: 'tg-uniq',
                },
            ],
            transcription_text: '',
            text: '',
        };

        const text = buildMessageAiText({
            message,
            baseUrl: 'https://voice.stratospace.fun',
        });

        expect(text).toContain('[Screenshot]');
        expect(text).toContain('UI bug report');
        expect(text).toContain(`/voicebot/message_attachment/${messageId.toString()}/0`);
        // No token-leaking raw Telegram URLs should be present.
        expect(text).not.toContain('api.telegram.org');
    });
});
