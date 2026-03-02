import type { VoiceMessageRow } from '../types/voice';

type CategorizationRowIdentityInput = {
    explicitRowId?: unknown;
    segmentOid?: unknown;
    messageRef?: unknown;
    timeStart?: unknown;
    timeEnd?: unknown;
    text?: unknown;
    sourceIndex?: unknown;
};

const normalizeToken = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const normalizeTimeToken = (value: unknown): string => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'na';
    const compact = numeric.toFixed(6).replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
    return compact || '0';
};

const normalizeTextToken = (value: unknown): string => {
    const normalized = normalizeToken(value)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[|:]/g, '_');
    if (!normalized) return 'empty';
    return normalized.slice(0, 64);
};

const normalizeIndexToken = (value: unknown): number => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
};

export const resolveCategorizationSegmentOid = (rowLike: Record<string, unknown>): string => {
    const explicit = normalizeToken(rowLike.segment_oid ?? rowLike.segmentOid);
    if (explicit.startsWith('ch_')) return explicit;

    const fromId = normalizeToken(rowLike.id);
    if (fromId.startsWith('ch_')) return fromId;

    return '';
};

export const buildCategorizationRowIdentity = (input: CategorizationRowIdentityInput): string => {
    const explicit = normalizeToken(input.explicitRowId);
    if (explicit) return explicit;

    const segmentOid = normalizeToken(input.segmentOid);
    if (segmentOid.startsWith('ch_')) return `seg:${segmentOid}`;

    const messageToken = normalizeToken(input.messageRef) || 'msg';
    const startToken = normalizeTimeToken(input.timeStart);
    const endToken = normalizeTimeToken(input.timeEnd);
    const textToken = normalizeTextToken(input.text);
    const sourceIndex = normalizeIndexToken(input.sourceIndex);

    return `row:${messageToken}:${startToken}:${endToken}:${textToken}:${sourceIndex}`;
};

export const getCategorizationRowIdentity = (
    row: Pick<
        VoiceMessageRow,
        'row_id' | 'segment_oid' | 'message_id' | 'material_source_message_id' | 'timeStart' | 'timeEnd' | 'text' | 'row_index'
    >
): string =>
    buildCategorizationRowIdentity({
        explicitRowId: row.row_id,
        segmentOid: row.segment_oid,
        messageRef: row.message_id ?? row.material_source_message_id,
        timeStart: row.timeStart,
        timeEnd: row.timeEnd,
        text: row.text,
        sourceIndex: row.row_index,
    });
