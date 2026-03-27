import { useEffect, useMemo } from 'react';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import TranscriptionTableHeader from './TranscriptionTableHeader';
import TranscriptionTableRow from './TranscriptionTableRow';
import { parseTimestampMs } from './timestampUtils';

const hasVisibleTranscriptionContent = (message: Record<string, unknown>): boolean => {
    const isDeleted = message.is_deleted;
    if (isDeleted === true) return false;
    if (typeof isDeleted === 'string' && isDeleted.trim().toLowerCase() === 'true') return false;

    const transcription = message.transcription;
    if (transcription && typeof transcription === 'object') {
        const segmentsRaw = (transcription as { segments?: unknown[] }).segments;
        const segments: unknown[] = Array.isArray(segmentsRaw)
            ? segmentsRaw
            : [];
        if (segments.some((segment) => {
            if (!segment || typeof segment !== 'object') return false;
            const item = segment as Record<string, unknown>;
            if (item.is_deleted === true) return false;
            const text = typeof item.text === 'string' ? item.text.trim() : '';
            return text.length > 0;
        })) {
            return true;
        }
    }

    const legacyChunks = Array.isArray(message.transcription_chunks)
        ? message.transcription_chunks
        : [];
    if (legacyChunks.some((chunk) => {
        if (!chunk || typeof chunk !== 'object') return false;
        const item = chunk as Record<string, unknown>;
        if (item.is_deleted === true) return false;
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        return text.length > 0;
    })) {
        return true;
    }

    const fallbackText = typeof message.transcription_text === 'string'
        ? message.transcription_text.trim()
        : '';
    if (fallbackText.length > 0) return true;

    const plainText = typeof message.text === 'string' ? message.text.trim() : '';
    if (plainText.length > 0) return true;

    const hasAudioPayload = [
        message.file_path,
        message.file_name,
        message.file_unique_id,
        message.file_hash,
    ].some((value) => typeof value === 'string' && value.trim().length > 0);
    if (hasAudioPayload) return true;

    const mimeType = typeof message.mime_type === 'string' ? message.mime_type.toLowerCase().trim() : '';
    if (mimeType.startsWith('audio/')) return true;

    const hasRetryFlag = message.to_transcribe === true;
    if (hasRetryFlag) return true;

    const hasTranscriptionError =
        typeof message.transcription_error === 'string' && message.transcription_error.trim().length > 0;
    if (hasTranscriptionError) return true;

    const processingStateRaw =
        (typeof message.transcription_processing_state === 'string' && message.transcription_processing_state) ||
        (typeof message.transcriptionProcessingState === 'string' && message.transcriptionProcessingState) ||
        (typeof message.transcription_state === 'string' && message.transcription_state) ||
        '';
    const processingState = processingStateRaw.trim().toLowerCase();
    if (
        processingState === 'pending_classification' ||
        processingState === 'pending_transcription' ||
        processingState === 'classified_skip' ||
        processingState === 'transcription_error' ||
        processingState === 'transcribed'
    ) {
        return true;
    }

    const hasProjection = [
        message.primary_payload_media_kind,
        message.primaryPayloadMediaKind,
        message.payload_media_kind,
        message.payloadMediaKind,
        message.primary_transcription_attachment_index,
        message.primaryTranscriptionAttachmentIndex,
        message.transcription_eligibility,
        message.transcriptionEligibility,
        message.classification_resolution_state,
        message.classificationResolutionState,
    ].some((value) => value != null && String(value).trim().length > 0);
    if (hasProjection) return true;

    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const hasAttachmentProjection = attachments.some((attachment) => {
        if (!attachment || typeof attachment !== 'object') return false;
        const record = attachment as Record<string, unknown>;
        return [
            record.payload_media_kind,
            record.classification_resolution_state,
            record.transcription_eligibility,
            record.transcription_processing_state,
            record.transcription_skip_reason,
            record.transcription_text,
            record.transcription_error,
            record.file_id,
            record.file_unique_id,
        ].some((value) => value != null && String(value).trim().length > 0);
    });
    if (hasAttachmentProjection) return true;

    return message.is_transcribed === true;
};

export default function Transcription() {
    const rows = useVoiceBotStore((state) => state.voiceBotMessages);
    const voiceBotSession = useVoiceBotStore((state) => state.voiceBotSession);
    const {
        transcriptionSort,
        toggleTranscriptionSort,
        initTranscriptionSort,
    } = useSessionsUIStore();

    useEffect(() => {
        initTranscriptionSort(voiceBotSession?.is_active);
    }, [voiceBotSession?.is_active, initTranscriptionSort]);

    const sortedRows = useMemo(() => {
        const list = [...rows].filter((row) => hasVisibleTranscriptionContent(row as unknown as Record<string, unknown>));
        const toNumericMessageId = (value: unknown): number => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        list.sort((a, b) => {
            const aTs = parseTimestampMs(a?.message_timestamp) ?? 0;
            const bTs = parseTimestampMs(b?.message_timestamp) ?? 0;
            let comparison = 0;
            if (aTs > bTs) comparison = -1;
            else if (aTs < bTs) comparison = 1;
            else {
                const aId = toNumericMessageId(a?.message_id);
                const bId = toNumericMessageId(b?.message_id);
                if (aId > bId) comparison = -1;
                else if (aId < bId) comparison = 1;
            }
            return transcriptionSort.ascending ? -comparison : comparison;
        });
        return list;
    }, [rows, transcriptionSort.ascending]);

    const sessionBaseTimestampMs = useMemo(() => {
        const stamps = sortedRows
            .map((msg) => parseTimestampMs(msg?.message_timestamp))
            .filter((value): value is number => value != null);
        if (stamps.length === 0) return null;
        return Math.min(...stamps);
    }, [sortedRows]);

    return (
        <div className="voice-session-scroll-pane">
            <div className="inline-flex min-h-full w-full flex-col items-start justify-start">
                <TranscriptionTableHeader
                    ascending={transcriptionSort.ascending}
                    onToggleSort={toggleTranscriptionSort}
                />
                {sortedRows.map((row, idx) => (
                    <div className="flex flex-row w-full shadow-sm bg-white items-stretch" key={row._id || row.message_id || idx}>
                        <div className="flex-1 flex flex-col h-full">
                            <TranscriptionTableRow
                                row={row}
                                isLast={idx === sortedRows.length - 1}
                                sessionBaseTimestampMs={sessionBaseTimestampMs}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
