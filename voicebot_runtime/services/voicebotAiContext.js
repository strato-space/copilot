const constants = require("../constants");

const normalizeBaseUrl = (rawBaseUrl) => {
    if (typeof rawBaseUrl !== "string") return "";
    return rawBaseUrl.replace(/\/+$/, "");
};

const getOptionalString = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const buildAttachmentProxyUrl = ({ baseUrl, messageObjectId, attachmentIndex }) => {
    if (!messageObjectId || attachmentIndex == null) return null;
    const base = normalizeBaseUrl(baseUrl);
    const path = `/voicebot/message_attachment/${messageObjectId}/${attachmentIndex}`;
    return base ? `${base}${path}` : path;
};

const buildMessageAiText = ({ message, baseUrl = "" }) => {
    if (!message || typeof message !== "object") return "";

    const messageType = getOptionalString(message.message_type) || null;
    const sourceType = getOptionalString(message.source_type) || null;
    const messageObjectId = message?._id?.toString ? message._id.toString() : getOptionalString(message._id);

    const transcriptionText = getOptionalString(message.transcription_text);
    const plainText = getOptionalString(message.text);

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];

    // Default: for voice/text messages just use transcription text.
    const defaultText = (transcriptionText || plainText || "").trim();

    const isAttachmentLike =
        messageType === constants.voice_message_types.SCREENSHOT ||
        messageType === constants.voice_message_types.DOCUMENT ||
        attachments.length > 0;

    if (!isAttachmentLike) return defaultText;

    const label = messageType === constants.voice_message_types.DOCUMENT ? "Document" : "Screenshot";

    const captionFromAttachment = (() => {
        for (const a of attachments) {
            const c = getOptionalString(a?.caption);
            if (c) return c;
        }
        return null;
    })();

    const caption = captionFromAttachment || transcriptionText || plainText || "";

    const urls = [];
    for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        if (!a || typeof a !== "object") continue;

        const rawUrl = getOptionalString(a.url) || getOptionalString(a.uri);
        const rawUri = getOptionalString(a.uri) || getOptionalString(a.url);

        const attachmentSource = getOptionalString(a.source);
        const isTelegramSource =
            attachmentSource === constants.voice_message_sources.TELEGRAM ||
            sourceType === constants.voice_message_sources.TELEGRAM;

        const fileId = getOptionalString(a.file_id) || (isTelegramSource ? getOptionalString(message.file_id) : null);
        if (isTelegramSource && fileId && messageObjectId) {
            const proxy = buildAttachmentProxyUrl({ baseUrl, messageObjectId, attachmentIndex: i });
            if (proxy) urls.push(proxy);
            continue;
        }

        if (rawUrl) urls.push(rawUrl);
        else if (rawUri) urls.push(rawUri);
    }

    const lines = [];
    const header = caption ? `[${label}] ${caption}` : `[${label}]`;
    lines.push(header.trim());
    for (const url of urls) {
        lines.push(url);
    }

    const messageId = message?.message_id != null ? String(message.message_id) : null;
    const meta = [
        messageId ? `message_id=${messageId}` : null,
        sourceType ? `source=${sourceType}` : null,
    ].filter(Boolean).join(" ");
    if (meta) lines.push(meta);

    return lines.join("\n").trim();
};

module.exports = {
    buildAttachmentProxyUrl,
    buildMessageAiText,
};

