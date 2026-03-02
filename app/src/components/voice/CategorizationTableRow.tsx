import { CheckOutlined, CloseOutlined, CopyOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { Button, Input, Tooltip, message } from 'antd';
import { useState } from 'react';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import type { CategorizationRow } from '../../store/sessionsUIStore';
import { formatTimelineSecondsLabel } from '../../utils/voiceTimeline';
import { resolveCategorizationSegmentOid } from '../../utils/categorizationRowIdentity';
import { formatVoiceMetadataSignature } from '../../utils/voiceMetadataSignature';

interface CategorizationTableRowProps {
    row: CategorizationRow;
    materials?: CategorizationRow[];
    rowId: string;
    isLast?: boolean;
}

const hasNonZeroTimelineValue = (value: unknown): boolean => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && Math.abs(numeric) > 0;
};

const toTimestampMs = (value: unknown): number | null => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e11 ? numeric : numeric * 1000;
};

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

const isInteractiveElement = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('button, a, input, textarea, [contenteditable="true"], [contenteditable=""]'));
};

const toBackendErrorText = (error: unknown): string => {
    if (!error || typeof error !== 'object') return '';
    const maybeError = error as {
        response?: { data?: { error?: unknown; error_code?: unknown } };
        message?: unknown;
    };
    const backendError = maybeError.response?.data?.error;
    if (typeof backendError === 'string' && backendError.trim()) return backendError.trim();
    if (typeof maybeError.message === 'string' && maybeError.message.trim()) return maybeError.message.trim();
    return '';
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

const buildMetadataSignature = (row: CategorizationRow): string | null => {
    const startSeconds = Number(row.timeStart);
    const messageTimestampMs = toTimestampMs(row.message_timestamp);
    const absoluteTimestampMs =
        Number.isFinite(startSeconds) && startSeconds >= 0 && messageTimestampMs != null
            ? messageTimestampMs + startSeconds * 1000
            : null;

    return formatVoiceMetadataSignature({
        startSeconds: row.timeStart,
        endSeconds: row.timeEnd,
        sourceFileName: row.source_file_name,
        absoluteTimestampMs,
        omitZeroRange: true,
    });
};

export default function CategorizationTableRow({ row, materials = [], rowId }: CategorizationTableRowProps) {
    const voiceBotSession = useVoiceBotStore((state) => state.voiceBotSession);
    const fetchVoiceBotSession = useVoiceBotStore((state) => state.fetchVoiceBotSession);
    const fetchSessionLog = useVoiceBotStore((state) => state.fetchSessionLog);
    const editCategorizationChunk = useVoiceBotStore((state) => state.editCategorizationChunk);
    const deleteCategorizationChunk = useVoiceBotStore((state) => state.deleteCategorizationChunk);
    const highlightedMessageId = useVoiceBotStore((state) => state.highlightedMessageId);
    const toggleSelectedCategorizationRow = useSessionsUIStore((state) => state.toggleSelectedCategorizationRow);
    const isCategorizationRowSelected = useSessionsUIStore((state) => state.isCategorizationRowSelected);
    const materialTargetMessageId = useSessionsUIStore((state) => state.materialTargetMessageId);
    const setMaterialTargetMessageId = useSessionsUIStore((state) => state.setMaterialTargetMessageId);

    const isHighlighted = highlightedMessageId && row.message_id === highlightedMessageId;
    const isSelected = isCategorizationRowSelected(row);
    const rowMessageRef = typeof row.message_id === 'string' ? row.message_id.trim() : '';
    const isMaterialTarget = Boolean(rowMessageRef && materialTargetMessageId === rowMessageRef);
    const hasText = typeof row.text === 'string' && row.text.trim().length > 0;
    const isSelectable = hasText;
    const speakerLabel = typeof row.name === 'string' ? row.name.trim() : '';
    const showSpeakerLabel = speakerLabel.length > 0 && speakerLabel.toLowerCase() !== 'unknown';
    const showSpeakerBadge = showSpeakerLabel;
    const showTimeline = hasNonZeroTimelineValue(row.timeStart) || hasNonZeroTimelineValue(row.timeEnd);
    const startTimelineLabel = showTimeline ? formatTimelineSecondsLabel(row.timeStart) : '';
    const endTimelineLabel = showTimeline ? formatTimelineSecondsLabel(row.timeEnd) : '';
    const metadataSignature = buildMetadataSignature(row);
    const rowSegmentOid = resolveCategorizationSegmentOid(row as unknown as Record<string, unknown>) || '';
    const fallbackSegmentOid =
        typeof row.source_segment_id === 'string' && row.source_segment_id.trim().startsWith('ch_')
            ? row.source_segment_id.trim()
            : '';
    const rowOid = rowSegmentOid || fallbackSegmentOid;
    const apiMessageIdCandidate =
        typeof row.message_db_id === 'string' && row.message_db_id.trim()
            ? row.message_db_id.trim()
            : (typeof row.message_id === 'string' && OBJECT_ID_RE.test(row.message_id.trim()) ? row.message_id.trim() : '');
    const canMutate = Boolean(voiceBotSession?._id && apiMessageIdCandidate && rowOid && hasText);

    const [isEditing, setIsEditing] = useState(false);
    const [draftText, setDraftText] = useState(typeof row.text === 'string' ? row.text : '');
    const [draftReason, setDraftReason] = useState('');
    const [busyAction, setBusyAction] = useState<'edit' | 'delete' | null>(null);

    const handleRowClick = (event: React.MouseEvent<HTMLDivElement>): void => {
        if (isInteractiveElement(event.target)) return;
        if (rowMessageRef) {
            setMaterialTargetMessageId(isMaterialTarget ? null : rowMessageRef);
        }
        if (!isSelectable) return;

        if (event.ctrlKey || event.metaKey) {
            toggleSelectedCategorizationRow(row);
            return;
        }

        toggleSelectedCategorizationRow(row);
    };

    const beginEdit = (): void => {
        if (!canMutate || busyAction) return;
        setDraftText(typeof row.text === 'string' ? row.text : '');
        setDraftReason('');
        setIsEditing(true);
    };

    const cancelEdit = (): void => {
        if (busyAction) return;
        setIsEditing(false);
        setDraftText(typeof row.text === 'string' ? row.text : '');
        setDraftReason('');
    };

    const copyRowText = async (): Promise<void> => {
        const textToCopy = typeof row.text === 'string' ? row.text.trim() : '';
        if (!textToCopy) return;
        try {
            const copied = await copyTextToClipboard(textToCopy);
            if (!copied) {
                message.error('Copy is not supported in this browser');
                return;
            }
            message.success('Copied');
        } catch (error) {
            console.error(error);
            message.error('Failed to copy');
        }
    };

    const saveEdit = async (): Promise<void> => {
        if (!canMutate || !voiceBotSession?._id || !apiMessageIdCandidate || !rowOid) return;
        if (!draftText.trim()) {
            message.error('Text is required');
            return;
        }
        setBusyAction('edit');
        try {
            await editCategorizationChunk(
                {
                    session_id: voiceBotSession._id,
                    message_id: apiMessageIdCandidate,
                    row_oid: rowOid,
                    new_text: draftText.trim(),
                    ...(draftReason.trim() ? { reason: draftReason.trim() } : {}),
                },
                { silent: true }
            );
            await fetchVoiceBotSession(voiceBotSession._id);
            await fetchSessionLog(voiceBotSession._id, { silent: true });
            message.success('Saved');
            setIsEditing(false);
            setDraftReason('');
        } catch (error) {
            console.error(error);
            message.error(toBackendErrorText(error) || 'Failed');
        } finally {
            setBusyAction(null);
        }
    };

    const deleteRow = async (): Promise<void> => {
        if (!canMutate || !voiceBotSession?._id || !apiMessageIdCandidate || !rowOid) return;
        setBusyAction('delete');
        try {
            await deleteCategorizationChunk(
                {
                    session_id: voiceBotSession._id,
                    message_id: apiMessageIdCandidate,
                    row_oid: rowOid,
                },
                { silent: true }
            );
            await fetchVoiceBotSession(voiceBotSession._id);
            await fetchSessionLog(voiceBotSession._id, { silent: true });
            message.success('Deleted');
            setIsEditing(false);
            setDraftReason('');
        } catch (error) {
            console.error(error);
            message.error(toBackendErrorText(error) || 'Failed');
        } finally {
            setBusyAction(null);
        }
    };

    const rowBgClass = isHighlighted
        ? 'bg-blue-500/10'
        : isSelected
            ? 'bg-blue-100/70'
            : '';
    const materialTargetClass = isMaterialTarget ? 'ring-1 ring-inset ring-teal-500/70' : '';

    return (
        <div
            data-row-id={rowId}
            className={`flex w-full transition-colors duration-150 ${isSelectable ? 'cursor-pointer hover:bg-slate-50' : ''} ${isSelected ? 'border-l-2 border-blue-500' : ''} ${rowBgClass} ${materialTargetClass}`}
            onClick={handleRowClick}
        >
            <div className="w-12 flex flex-col justify-center items-start p-1">
                <span className="text-black/60 text-[8px] font-normal leading-[10px]">
                    {startTimelineLabel}
                </span>
                <span className="text-black/60 text-[8px] font-normal leading-[10px]">
                    {endTimelineLabel}
                </span>
            </div>
            <div className="w-[88px] flex items-start gap-1 p-1 overflow-hidden">
                {showSpeakerBadge ? (
                    <span className="w-3 h-3 bg-black/40 rounded-full flex items-start justify-center text-white text-[6px] font-semibold leading-[11px]">
                        {row.avatar}
                    </span>
                ) : null}
                {showSpeakerLabel ? (
                    <span className="flex-1 text-black/90 text-[8px] font-normal leading-[10px] truncate">{speakerLabel}</span>
                ) : null}
            </div>
            <div className="flex-1 min-w-0 flex items-start p-1">
                <div className="flex-1 min-w-0 group">
                    {canMutate || metadataSignature ? (
                        <div className="w-full flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1" />
                            {canMutate ? (
                                <div
                                    className={[
                                        'flex items-start gap-1 transition-opacity',
                                        isEditing
                                            ? 'opacity-0 pointer-events-none'
                                            : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
                                    ].join(' ')}
                                >
                                    <Tooltip title="Copy">
                                        <Button
                                            size="small"
                                            type="text"
                                            icon={<CopyOutlined />}
                                            onClick={copyRowText}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Edit">
                                        <Button
                                            size="small"
                                            type="text"
                                            icon={<EditOutlined />}
                                            onClick={beginEdit}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Delete">
                                        <Button
                                            size="small"
                                            type="text"
                                            danger
                                            icon={<DeleteOutlined />}
                                            loading={busyAction === 'delete'}
                                            onClick={deleteRow}
                                        />
                                    </Tooltip>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {isEditing ? (
                        <div className="w-full">
                            <Input.TextArea
                                value={draftText}
                                onChange={(event) => setDraftText(event.target.value)}
                                autoSize={{ minRows: 2, maxRows: 8 }}
                                className="text-[10px] font-normal leading-3"
                                disabled={busyAction !== null}
                            />
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                <Button
                                    size="small"
                                    type="primary"
                                    icon={<CheckOutlined />}
                                    onClick={saveEdit}
                                    loading={busyAction === 'edit'}
                                    disabled={!draftText.trim()}
                                >
                                    Save
                                </Button>
                                <Button
                                    size="small"
                                    icon={<CloseOutlined />}
                                    onClick={cancelEdit}
                                    disabled={busyAction !== null}
                                >
                                    Cancel
                                </Button>
                                <Input
                                    size="small"
                                    value={draftReason}
                                    onChange={(event) => setDraftReason(event.target.value)}
                                    placeholder="Reason (optional)"
                                    className="max-w-[420px] text-[10px] font-normal leading-3"
                                    disabled={busyAction !== null}
                                />
                            </div>
                        </div>
                    ) : hasText ? (
                        <span className="text-black/90 text-[10px] font-normal leading-3 whitespace-pre-line">{row.text}</span>
                    ) : null}
                    {metadataSignature ? (
                        <div className="mt-1 text-black/45 text-[9px] font-normal leading-3">{metadataSignature}</div>
                    ) : null}
                </div>
            </div>
            <div className="w-[220px] shrink-0 p-1 border-l border-slate-200">
                {materials.map((material, idx) => (
                    <a
                        key={`${material.imageUrl || 'material'}:${idx}`}
                        href={material.imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block mb-1 last:mb-0"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <img
                            src={material.imageUrl}
                            alt={material.imageName || 'attachment'}
                            className="max-h-36 max-w-[210px] rounded border border-slate-200 object-contain bg-white"
                        />
                    </a>
                ))}
            </div>
        </div>
    );
}
