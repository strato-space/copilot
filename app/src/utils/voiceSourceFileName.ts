import type { VoiceBotMessage } from '../types/voice';

const MOJIBAKE_HINT_RE = /(Ð.|Ñ.|Ã.|Â.|â.)/;
const C1_CONTROL_RE = /[\u0080-\u009F]/g;
const CYRILLIC_RE = /[\u0400-\u04FF]/g;

const countMatches = (value: string, pattern: RegExp): number => {
    const matches = value.match(pattern);
    return matches ? matches.length : 0;
};

const decodeUtf8AsLatin1 = (value: string): string | null => {
    try {
        const bytes = new Uint8Array(value.length);
        for (let i = 0; i < value.length; i += 1) {
            bytes[i] = value.charCodeAt(i) & 0xff;
        }
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(bytes);
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(bytes).toString('utf8');
        }
        return null;
    } catch (error) {
        console.warn('Failed to decode potential mojibake filename', error);
        return null;
    }
};

export const normalizeUtf8AsLatin1Mojibake = (value: string): string => {
    if (!value) return value;
    if (!MOJIBAKE_HINT_RE.test(value)) return value;
    if (CYRILLIC_RE.test(value)) return value;

    const decoded = decodeUtf8AsLatin1(value);
    if (!decoded) return value;
    if (decoded === value) return value;
    if (decoded.includes('\uFFFD')) return value;

    const originalControlCount = countMatches(value, C1_CONTROL_RE);
    const decodedControlCount = countMatches(decoded, C1_CONTROL_RE);
    const originalCyrillicCount = countMatches(value, CYRILLIC_RE);
    const decodedCyrillicCount = countMatches(decoded, CYRILLIC_RE);

    const improvesControlChars = decodedControlCount < originalControlCount;
    const improvesCyrillicCoverage = decodedCyrillicCount > originalCyrillicCount;

    if (!improvesControlChars && !improvesCyrillicCoverage) return value;

    return decoded;
};

export const normalizeVoiceSourceFileName = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    return normalizeUtf8AsLatin1Mojibake(trimmed);
};

export const extractVoiceSourceFileName = (message: VoiceBotMessage): string => {
    const messageRecord = message && typeof message === 'object' ? (message as unknown as Record<string, unknown>) : {};
    const candidates: Array<unknown> = [
        messageRecord.file_name,
        message.file_metadata?.original_filename,
    ];

    const attachments = Array.isArray(messageRecord.attachments) ? messageRecord.attachments : [];
    if (attachments.length > 0) {
        const firstAttachment = attachments[0];
        if (firstAttachment && typeof firstAttachment === 'object') {
            const item = firstAttachment as Record<string, unknown>;
            candidates.push(item.name, item.filename, item.file_name);
        }
    }

    for (const candidate of candidates) {
        const normalized = normalizeVoiceSourceFileName(candidate);
        if (normalized) return normalized;
    }

    return '';
};
