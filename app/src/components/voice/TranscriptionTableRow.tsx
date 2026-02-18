import dayjs from 'dayjs';
import { Button, Input, Tooltip, message } from 'antd';
import {
    CheckOutlined,
    CloseOutlined,
    CopyOutlined,
    DeleteOutlined,
    EditOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import type { VoiceBotMessage } from '../../types/voice';

interface TranscriptionTableRowProps {
    row: VoiceBotMessage;
    isLast: boolean;
}

type TranscriptionSegment = {
    id?: string;
    start?: number;
    end?: number;
    speaker?: string | null;
    text?: string;
    is_deleted?: boolean;
};

const isSegmentOid = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    return /^[a-f\d]{24}$/i.test(value);
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

const getSegmentsFromMessage = (row: VoiceBotMessage): TranscriptionSegment[] => {
    const segments = row.transcription?.segments;
    if (Array.isArray(segments) && segments.length > 0) return segments;

    const chunks = row.transcription_chunks;
    if (Array.isArray(chunks) && chunks.length > 0) return chunks;

    if (typeof row.transcription_text === 'string' && row.transcription_text.trim()) {
        return [{ text: row.transcription_text }];
    }

    return [];
};

const formatSegmentMeta = (seg: TranscriptionSegment, row: VoiceBotMessage): string => {
    const parts: string[] = [];

    if (row.message_timestamp) {
        parts.push(dayjs(row.message_timestamp).format('HH:mm:ss'));
    }

    if (typeof seg.speaker === 'string' && seg.speaker.trim()) {
        parts.push(seg.speaker.trim());
    }

    return parts.join(' · ');
};

export default function TranscriptionTableRow({ row, isLast }: TranscriptionTableRowProps) {
    const voiceBotSession = useVoiceBotStore((state) => state.voiceBotSession);
    const fetchVoiceBotSession = useVoiceBotStore((state) => state.fetchVoiceBotSession);
    const editTranscriptChunk = useVoiceBotStore((state) => state.editTranscriptChunk);
    const deleteTranscriptChunk = useVoiceBotStore((state) => state.deleteTranscriptChunk);

    const segments = getSegmentsFromMessage(row);
    const visibleSegments = segments.filter((seg) => {
        if (seg?.is_deleted) return false;
        if (typeof seg?.text !== 'string') return false;
        return seg.text.trim() !== '';
    });

    const [editingOid, setEditingOid] = useState<string | null>(null);
    const [draftText, setDraftText] = useState('');
    const [draftReason, setDraftReason] = useState('');
    const [busyOid, setBusyOid] = useState<string | null>(null);

    const beginEdit = (seg: TranscriptionSegment): void => {
        if (!isSegmentOid(seg?.id)) return;
        if (busyOid) return;

        setEditingOid(seg.id);
        setDraftText(typeof seg.text === 'string' ? seg.text : '');
        setDraftReason('');
    };

    const cancelEdit = (): void => {
        if (busyOid) return;
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
            await editTranscriptChunk(
                {
                    session_id: sessionId,
                    message_id: messageId,
                    segment_oid: editingOid,
                    new_text: draftText,
                    reason: draftReason.trim() ? draftReason.trim() : undefined,
                },
                { silent: true }
            );
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
        if (!isSegmentOid(seg?.id)) return;
        if (busyOid) return;

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
                            const segmentMeta = formatSegmentMeta(seg, row);
                            const showActions = isSegmentOid(seg?.id);
                            const isEditing = editingOid === seg?.id;

                            return (
                                <div className="relative w-full p-1 group" key={segmentKey}>
                                    {showActions || segmentMeta ? (
                                        <div className="w-full flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                {segmentMeta ? (
                                                    <div className="text-black/45 text-[9px] font-normal leading-3">
                                                        {segmentMeta}
                                                    </div>
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
                                            <div className="self-stretch text-black/90 text-[10px] font-normal leading-3 whitespace-pre-wrap break-words">
                                                {seg?.text}
                                            </div>
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
