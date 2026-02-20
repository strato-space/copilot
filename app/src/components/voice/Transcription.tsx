import { useEffect, useMemo } from 'react';
import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import TranscriptionTableHeader from './TranscriptionTableHeader';
import TranscriptionTableRow from './TranscriptionTableRow';

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
            if (Boolean(item.is_deleted)) return false;
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
        if (Boolean(item.is_deleted)) return false;
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

    return false;
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
            const aTs = toTimestampMs(a?.message_timestamp) ?? 0;
            const bTs = toTimestampMs(b?.message_timestamp) ?? 0;
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
            .map((msg) => toTimestampMs(msg?.message_timestamp))
            .filter((value): value is number => value != null);
        if (stamps.length === 0) return null;
        return Math.min(...stamps);
    }, [sortedRows]);

    return (
        <div className="flex-1 inline-flex flex-col justify-start items-start">
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
    );
}
