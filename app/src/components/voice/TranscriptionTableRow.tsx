import dayjs from 'dayjs';
import { Button, Input, Tooltip, message } from 'antd';
import { CheckOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import type { VoiceBotMessage } from '../../types/voice';

interface TranscriptionTableRowProps {
    row: VoiceBotMessage;
    isLast: boolean;
    sessionBaseTimestampMs: number | null;
}

type TranscriptionSegment = {
    id?: string | undefined;
    start?: number | null | undefined;
    end?: number | null | undefined;
    speaker?: string | null | undefined;
    text?: string | undefined;
    is_deleted?: boolean | undefined;
    absoluteTimestampMs?: number | null | undefined;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const toTimestampMs = (value: unknown): number | null => {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isNaN(ms) ? null : ms;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1e11 ? value : value * 1000;
    }

    if (typeof value === 'string' && value.trim()) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric > 1e11 ? numeric : numeric * 1000;
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
};

const formatRelativeTime = (secondsValue: unknown): string | null => {
    const seconds = Number(secondsValue);
    if (!Number.isFinite(seconds) || seconds < 0) return null;

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const rem = totalSeconds % 60;
    return `${minutes}:${String(rem).padStart(2, '0')}`;
};

const buildLegacySegments = (legacyChunks: unknown[], fallbackTimestampMs: number | null): TranscriptionSegment[] => {
    if (!Array.isArray(legacyChunks) || legacyChunks.length === 0) return [];

    const ordered = legacyChunks
        .map((chunk, idx) => {
            const chunkObj = chunk && typeof chunk === 'object' ? (chunk as Record<string, unknown>) : {};
            const rawIndex = Number(chunkObj.segment_index);
            return {
                chunk: chunkObj,
                index: Number.isFinite(rawIndex) ? rawIndex : idx,
                order: idx,
                timestampMs: toTimestampMs(chunkObj.timestamp),
            };
        })
        .sort((a, b) => {
            if (a.index !== b.index) return a.index - b.index;
            if (a.timestampMs != null && b.timestampMs != null && a.timestampMs !== b.timestampMs) {
                return a.timestampMs - b.timestampMs;
            }
            return a.order - b.order;
        });

    const baselineTimestampMs = fallbackTimestampMs ?? null;
    let previousEnd = 0;

    return ordered.map((entry) => {
        const durationSeconds = Number(entry?.chunk?.duration_seconds);
        const hasDuration = Number.isFinite(durationSeconds) && durationSeconds > 0;

        const start = previousEnd;
        const end = hasDuration ? start + durationSeconds : null;
        if (hasDuration) previousEnd = end as number;

        const id = typeof entry?.chunk?.id === 'string' ? entry.chunk.id : undefined;

        return {
            id,
            start,
            end,
            speaker: typeof entry?.chunk?.speaker === 'string' ? entry.chunk.speaker : null,
            text: typeof entry?.chunk?.text === 'string' ? entry.chunk.text : '',
            is_deleted: Boolean(entry?.chunk?.is_deleted),
            absoluteTimestampMs: baselineTimestampMs != null ? baselineTimestampMs + start * 1000 : null,
        };
    });
};

const getSegmentsFromMessage = (msg: VoiceBotMessage): TranscriptionSegment[] => {
    const fallbackMessageTimestampMs = toTimestampMs(msg?.message_timestamp);

    const legacyChunks = Array.isArray((msg as { transcription_chunks?: unknown[] }).transcription_chunks)
        ? ((msg as { transcription_chunks?: unknown[] }).transcription_chunks as unknown[])
        : [];

    const legacySegments = buildLegacySegments(legacyChunks, fallbackMessageTimestampMs);
    const legacyById = new Map(
        legacySegments
            .filter((seg) => typeof seg?.id === 'string')
            .map((seg) => [seg.id as string, seg])
    );

    const transcriptionSegments = msg?.transcription?.segments;
    if (Array.isArray(transcriptionSegments) && transcriptionSegments.length > 0) {
        return transcriptionSegments
            .map((segment) => {
                const fromLegacy = typeof segment?.id === 'string' ? legacyById.get(segment.id) : undefined;

                const start = isFiniteNumber(Number(segment?.start))
                    ? Number(segment.start)
                    : fromLegacy?.start ?? null;
                const end = isFiniteNumber(Number(segment?.end))
                    ? Number(segment.end)
                    : fromLegacy?.end ?? null;

                let absoluteTimestampMs: number | null = null;
                if (fallbackMessageTimestampMs != null && isFiniteNumber(start)) {
                    absoluteTimestampMs = fallbackMessageTimestampMs + start * 1000;
                } else {
                    absoluteTimestampMs = fromLegacy?.absoluteTimestampMs ?? null;
                }

                return {
                    id: segment?.id,
                    start,
                    end,
                    speaker: typeof segment?.speaker === 'string' ? segment.speaker : null,
                    text: typeof segment?.text === 'string' ? segment.text : '',
                    is_deleted: Boolean(segment?.is_deleted),
                    absoluteTimestampMs,
                } satisfies TranscriptionSegment;
            })
            .filter((seg) => typeof seg?.id === 'string' && seg.id.startsWith('ch_'));
    }

    if (legacySegments.length > 0) {
        return legacySegments
            .filter((seg) => typeof seg?.id === 'string' && seg.id.startsWith('ch_'));
    }

    if (typeof msg.transcription_text === 'string' && msg.transcription_text.trim()) {
        return [{ text: msg.transcription_text }];
    }

    return [];
};

const formatSegmentMeta = (seg: TranscriptionSegment): string => {
    const speaker = typeof seg.speaker === 'string' && seg.speaker.trim() ? seg.speaker.trim() : '';
    return speaker;
};

const isSegmentOid = (value: unknown): value is string => typeof value === 'string' && value.startsWith('ch_');

const formatSegmentTimeline = (
    segment: TranscriptionSegment,
    row: VoiceBotMessage,
    sessionBaseTimestampMs: number | null
): string | null => {
    const start = Number(segment?.start);
    if (!Number.isFinite(start) || start < 0) return null;

    const end = Number(segment?.end);
    const hasEnd = Number.isFinite(end) && end > start;

    const messageTimestampMs = toTimestampMs(row?.message_timestamp);
    const segmentAbsoluteStartMs =
        messageTimestampMs != null
            ? messageTimestampMs + start * 1000
            : toTimestampMs(segment?.absoluteTimestampMs);

    const absoluteLabel = segmentAbsoluteStartMs != null ? dayjs(segmentAbsoluteStartMs).format('HH:mm') : null;

    let relativeStartSeconds = start;
    let relativeEndSeconds: number | null = hasEnd ? end : null;

    const sessionBaseMs =
        typeof sessionBaseTimestampMs === 'number' && Number.isFinite(sessionBaseTimestampMs)
            ? sessionBaseTimestampMs
            : null;

    if (sessionBaseMs != null) {
        if (messageTimestampMs != null) {
            const messageOffsetSeconds = Math.max(0, (messageTimestampMs - sessionBaseMs) / 1000);
            relativeStartSeconds = messageOffsetSeconds + start;
            if (hasEnd) relativeEndSeconds = messageOffsetSeconds + end;
        } else if (segmentAbsoluteStartMs != null) {
            const sessionStartSeconds = Math.max(0, (segmentAbsoluteStartMs - sessionBaseMs) / 1000);
            relativeStartSeconds = sessionStartSeconds;
            if (hasEnd) relativeEndSeconds = sessionStartSeconds + (end - start);
        }
    }

    const relativeStart = formatRelativeTime(relativeStartSeconds);
    if (!relativeStart) return null;

    if (!hasEnd || relativeEndSeconds == null) {
        if (absoluteLabel) return `${absoluteLabel}, ${relativeStart}`;
        return `${relativeStart}`;
    }

    const relativeEnd = formatRelativeTime(relativeEndSeconds);
    if (!relativeEnd) {
        if (absoluteLabel) return `${absoluteLabel}, ${relativeStart}`;
        return `${relativeStart}`;
    }

    if (absoluteLabel) return `${absoluteLabel}, ${relativeStart} - ${relativeEnd}`;
    return `${relativeStart} - ${relativeEnd}`;
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trimmed);
        return true;
    }

    if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = trimmed;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            return true;
        } finally {
            document.body.removeChild(textarea);
        }
    }

    return false;
};

export default function TranscriptionTableRow({ row, isLast, sessionBaseTimestampMs }: TranscriptionTableRowProps) {
    const voiceBotSession = useVoiceBotStore((state) => state.voiceBotSession);
    const fetchVoiceBotSession = useVoiceBotStore((state) => state.fetchVoiceBotSession);
    const editTranscriptChunk = useVoiceBotStore((state) => state.editTranscriptChunk);
    const deleteTranscriptChunk = useVoiceBotStore((state) => state.deleteTranscriptChunk);

    const segments = getSegmentsFromMessage(row);
    const visibleSegments = segments.filter((seg) => !seg?.is_deleted);

    const [editingOid, setEditingOid] = useState<string | null>(null);
    const [draftText, setDraftText] = useState('');
    const [draftReason, setDraftReason] = useState('');
    const [busyOid, setBusyOid] = useState<string | null>(null);

    const isBusy = Boolean(busyOid);

    const beginEdit = (seg: TranscriptionSegment): void => {
        if (!seg || !isSegmentOid(seg.id)) return;
        if (isBusy) return;

        setEditingOid(seg.id);
        setDraftText(typeof seg.text === 'string' ? seg.text : '');
        setDraftReason('');
    };

    const cancelEdit = (): void => {
        if (isBusy) return;
        setEditingOid(null);
        setDraftText('');
        setDraftReason('');
    };

    const saveEdit = async (): Promise<void> => {
        const sessionId = voiceBotSession?._id;
        const messageId = row?._id;
        if (!sessionId || !messageId || !editingOid) return;

        if (!draftText.trim()) {
            message.error('Text is required');
            return;
        }

        setBusyOid(editingOid);
        try {
            const payload = {
                session_id: sessionId,
                message_id: messageId,
                segment_oid: editingOid,
                new_text: draftText,
                ...(draftReason.trim() ? { reason: draftReason.trim() } : {}),
            };
            await editTranscriptChunk(payload, { silent: true });
            await fetchVoiceBotSession(sessionId);
            message.success('Saved');
            setEditingOid(null);
            setDraftText('');
            setDraftReason('');
        } catch (e) {
            console.error(e);
            message.error('Failed');
        } finally {
            setBusyOid(null);
        }
    };

    const deleteSegment = async (seg: TranscriptionSegment): Promise<void> => {
        const sessionId = voiceBotSession?._id;
        const messageId = row?._id;
        if (!sessionId || !messageId) return;
        if (!seg?.id || !isSegmentOid(seg.id)) return;
        if (isBusy) return;

        setBusyOid(seg.id);
        try {
            await deleteTranscriptChunk(
                {
                    session_id: sessionId,
                    message_id: messageId,
                    segment_oid: seg.id,
                },
                { silent: true }
            );
            await fetchVoiceBotSession(sessionId);
            message.success('Deleted');

            if (editingOid === seg.id) {
                setEditingOid(null);
                setDraftText('');
                setDraftReason('');
            }
        } catch (e) {
            console.error(e);
            message.error('Failed');
        } finally {
            setBusyOid(null);
        }
    };

    const copySegment = async (seg: TranscriptionSegment): Promise<void> => {
        const textToCopy = typeof seg?.text === 'string' ? seg.text.trim() : '';
        if (!textToCopy) return;

        try {
            const copied = await copyTextToClipboard(textToCopy);
            if (!copied) {
                message.error('Copy is not supported in this browser');
                return;
            }
            message.success('Copied');
        } catch (e) {
            console.error(e);
            message.error('Failed to copy');
        }
    };

    return (
        <div
            className={`self-stretch flex flex-col justify-start items-stretch h-full ${
                isLast ? 'border-b border-black/30' : 'border-b border-slate-200'
            }`}
        >
            <div className="flex-1 self-stretch p-1 flex justify-start items-start">
                <div className="min-w-0 w-full inline-flex flex-col justify-start items-start">
                    {visibleSegments.length > 0 ? (
                        visibleSegments.map((seg, segIdx) => {
                            const segmentKey = seg?.id || `${row?._id || row?.message_id || 'msg'}:${segIdx}`;
                            const segmentMeta = formatSegmentMeta(seg);
                            const timelineLabel = formatSegmentTimeline(seg, row, sessionBaseTimestampMs);
                            const showActions = isSegmentOid(seg?.id);
                            const isEditing = editingOid === seg?.id;

                            return (
                                <div className="relative w-full p-1 group" key={segmentKey}>
                                    {showActions || segmentMeta ? (
                                        <div className="w-full flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                {segmentMeta ? (
                                                    <div className="text-black/45 text-[9px] font-normal leading-3">{segmentMeta}</div>
                                                ) : null}
                                            </div>
                                            {showActions ? (
                                                <div
                                                    className={[
                                                        'flex items-start gap-1 transition-opacity',
                                                        isEditing
                                                            ? 'opacity-0 pointer-events-none'
                                                            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
                                                    ].join(' ')}
                                                >
                                                    <Tooltip title="Copy">
                                                        <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copySegment(seg)} />
                                                    </Tooltip>
                                                    <Tooltip title="Edit">
                                                        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => beginEdit(seg)} />
                                                    </Tooltip>
                                                    <Tooltip title="Delete">
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            danger
                                                            icon={<DeleteOutlined />}
                                                            loading={busyOid === seg?.id}
                                                            onClick={() => deleteSegment(seg)}
                                                        />
                                                    </Tooltip>
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    <div className="min-w-0 w-full">
                                        {isEditing ? (
                                            <div className="w-full">
                                                <Input.TextArea
                                                    value={draftText}
                                                    onChange={(e) => setDraftText(e.target.value)}
                                                    autoSize={{ minRows: 3, maxRows: 10 }}
                                                    className="text-[10px] font-normal leading-3"
                                                    disabled={busyOid === seg?.id}
                                                />
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <Button
                                                        size="small"
                                                        type="primary"
                                                        icon={<CheckOutlined />}
                                                        onClick={saveEdit}
                                                        loading={busyOid === seg?.id}
                                                        disabled={!draftText.trim()}
                                                    >
                                                        Save
                                                    </Button>
                                                    <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit} disabled={busyOid === seg?.id}>
                                                        Cancel
                                                    </Button>
                                                    <Input
                                                        size="small"
                                                        value={draftReason}
                                                        onChange={(e) => setDraftReason(e.target.value)}
                                                        placeholder="Reason (optional)"
                                                        className="max-w-[420px] text-[10px] font-normal leading-3"
                                                        disabled={busyOid === seg?.id}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="self-stretch text-black/90 text-[10px] font-normal leading-3 whitespace-pre-wrap break-words">
                                                    {seg?.text}
                                                </div>
                                                {timelineLabel ? (
                                                    <div className="mt-1 text-black/55 text-[9px] font-normal leading-3">
                                                        {timelineLabel}
                                                    </div>
                                                ) : null}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="self-stretch text-black/90 text-[10px] font-normal leading-3 p-1 whitespace-pre-wrap break-words">
                            {row.transcription_text || ''}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
