import axios, { type AxiosProgressEvent, type AxiosRequestConfig } from 'axios';
import { create } from 'zustand';
import _ from 'lodash';
import { message } from 'antd';
import type { Socket } from 'socket.io-client';

import { useAuthStore } from './authStore';
import { useSessionsUIStore } from './sessionsUIStore';
import { useMCPRequestStore } from './mcpRequestStore';
import type {
    VoiceBotMessage,
    VoiceMessageAttachment,
    VoicePossibleTask,
    VoiceBotSession,
    VoiceMessageGroup,
    VoiceMessageRow,
    TaskTypeNode,
    VoiceBotProject,
    VoicebotPerson,
    CreateTaskChunk,
    VoiceBotSessionResponse,
    VoiceSessionAttachment,
    VoiceSessionTaskflowRefreshHint,
    VoiceSessionLogEvent,
    CodexTask,
    VoiceTranscriptionEligibility,
    VoiceClassificationResolutionState,
    VoiceTranscriptionProcessingState,
    VoicePayloadMediaKind,
} from '../types/voice';
import { getVoicebotSocket, SOCKET_EVENTS } from '../services/socket';
import { normalizeTimelineRangeSeconds } from '../utils/voiceTimeline';
import { buildCategorizationRowIdentity, resolveCategorizationSegmentOid } from '../utils/categorizationRowIdentity';
import { ensureCodexPerformerRecords } from '../utils/codexPerformer';
import {
    buildVoiceSessionTaskSourceRefs,
    normalizeVoiceSessionSourceRefs,
    ticketMatchesVoiceSessionSourceRefs,
} from '../utils/voiceSessionTaskSource';
import {
    extractVoiceTaskCreateErrorText,
    extractVoiceTaskCreateRowErrors,
    isVoiceTaskCreateValidationError,
    type VoiceTaskCreateRowError,
    VoiceTaskCreateValidationError,
} from '../utils/voiceTaskCreation';
import {
    buildTranscriptionText,
    collectPossibleTaskLocators,
    filterPossibleTasksByLocators,
    parsePossibleTasksResponse,
} from '../utils/voicePossibleTasks';
import { extractVoiceSourceFileName } from '../utils/voiceSourceFileName';
import { voicebotRuntimeConfig } from './voicebotRuntimeConfig';
import { voicebotHttp } from './voicebotHttp';
import { codexTaskTimeline } from './codexTaskTimeline';

export {
    buildVoiceSessionTaskSourceRefs,
    normalizeVoiceSessionSourceRefs,
    ticketMatchesVoiceSessionSourceRefs,
};

const pendingPossibleTasksRefreshCorrelationBySession = new Map<string, string>();

const registerPendingPossibleTasksRefreshCorrelation = (sessionId: string, correlationId?: string | null): void => {
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedCorrelationId = typeof correlationId === 'string' ? correlationId.trim() : '';
    if (!normalizedSessionId || !normalizedCorrelationId) return;
    pendingPossibleTasksRefreshCorrelationBySession.set(normalizedSessionId, normalizedCorrelationId);
};

const consumePendingPossibleTasksRefreshCorrelation = (sessionId: string, correlationId?: string | null): boolean => {
    const normalizedSessionId = String(sessionId || '').trim();
    const normalizedCorrelationId = typeof correlationId === 'string' ? correlationId.trim() : '';
    if (!normalizedSessionId || !normalizedCorrelationId) return false;
    const expectedCorrelationId = pendingPossibleTasksRefreshCorrelationBySession.get(normalizedSessionId);
    if (!expectedCorrelationId || expectedCorrelationId !== normalizedCorrelationId) return false;
    pendingPossibleTasksRefreshCorrelationBySession.delete(normalizedSessionId);
    return true;
};

interface VoiceBotSessionDataSlice {
    currentSessionId: string | null;
    voiceBotSession: VoiceBotSession | null;
    voiceBotMessages: VoiceBotMessage[];
    voiceMesagesData: VoiceMessageGroup[];
    sessionAttachments: VoiceSessionAttachment[];
    possibleTasks: VoicePossibleTask[];
    possibleTasksLoadedAt: number | null;
    sessionLogEvents: VoiceSessionLogEvent[];
    highlightedMessageId: string | null;
    sessionTasksRefreshToken: number;
    sessionCodexRefreshToken: number;
}

interface VoiceBotSocketDataSlice {
    socketToken: string | null;
    socketPort: number | null;
    socket: Socket | null;
}

interface VoiceBotCatalogDataSlice {
    task_types: TaskTypeNode[] | null;
    voiceBotSessionsList: VoiceBotSession[];
    prepared_projects: VoiceBotProject[] | null;
    persons_list: VoicebotPerson[] | null;
    performers_list: Array<Record<string, unknown>> | null;
    performers_for_tasks_list: Array<Record<string, unknown>> | null;
    isSessionsListLoading: boolean;
    sessionsListLoadedAt: number | null;
    sessionsListIncludeDeleted: boolean | null;
}

interface VoiceBotSessionCrudActionsSlice {
    updateSessionName: (sessionId: string, newName: string) => Promise<void>;
    updateSessionDialogueTag: (sessionId: string, dialogueTag: string) => Promise<void>;
    fetchVoiceBotSession: (sessionId: string) => Promise<void>;
    fetchActiveSession: () => Promise<Record<string, unknown> | null>;
    activateSession: (sessionId: string) => Promise<boolean>;
    updateSessionProject: (sessionId: string, projectId: string | null) => Promise<void>;
    finishSession: (sessionId: string) => Promise<void>;
    updateSessionAccessLevel: (sessionId: string, accessLevel: string) => Promise<void>;
    restartCorruptedSession: (sessionId: string) => Promise<unknown>;
    setHighlightedMessageId: (messageId: string | null) => void;
    getSessionData: (sessionId: string) => Promise<VoiceBotSessionResponse>;
}

interface VoiceBotSessionProcessingActionsSlice {
    sendSessionToCrm: (sessionId: string) => Promise<boolean>;
    sendSessionToCrmWithMcp: (sessionId: string) => Promise<void>;
    createPossibleTasksForSession: (
        sessionId: string,
        options?: { refreshCorrelationId?: string; refreshClickedAtMs?: number }
    ) => Promise<{ requestId: string; tasks: VoicePossibleTask[] }>;
    fetchSessionPossibleTasks: (sessionId: string, options?: { silent?: boolean }) => Promise<VoicePossibleTask[]>;
    saveSessionPossibleTasks: (
        sessionId: string,
        tasks: Array<Record<string, unknown>> | VoicePossibleTask[],
        options?: {
            silent?: boolean;
            refreshMode?: 'full_recompute' | 'incremental_refresh';
            refreshCorrelationId?: string;
            refreshClickedAtMs?: number;
        }
    ) => Promise<VoicePossibleTask[]>;
    triggerSessionReadyToSummarize: (sessionId: string) => Promise<Record<string, unknown>>;
    saveSessionSummary: (
        payload: { session_id: string; md_text: string },
        options?: { silent?: boolean }
    ) => Promise<{ md_text: string; updated_at: string }>;
    fetchSessionLog: (sessionId: string, options?: { silent?: boolean }) => Promise<void>;
    fetchSessionCodexTasks: (sessionId: string) => Promise<CodexTask[]>;
    editTranscriptChunk: (
        payload: { session_id: string; message_id: string; segment_oid: string; new_text: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    editCategorizationChunk: (
        payload: { session_id: string; message_id: string; row_oid: string; new_text: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    deleteTranscriptChunk: (
        payload: { session_id: string; message_id: string; segment_oid: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    deleteCategorizationChunk: (
        payload: { session_id: string; message_id: string; row_oid: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    rollbackSessionEvent: (
        payload: { session_id: string; event_oid: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    resendNotifyEvent: (
        payload: { session_id: string; event_oid: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    retryCategorizationEvent: (
        payload: { session_id: string; event_oid: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    getMessageDataById: (messageId: string) => VoiceBotMessage | null;
}

interface VoiceBotSessionsListActionsSlice {
    fetchVoiceBotSessionsList: (options?: { force?: boolean; includeDeleted?: boolean }) => Promise<void>;
    postProcessSession: (sessionId: string) => Promise<void>;
    createTasksFromChunks: (sessionId: string, chunks: CreateTaskChunk[]) => Promise<void>;
    createTasksFromRows: (sessionId: string, rows: Array<{ text?: string }>) => Promise<void>;
    fetchTaskTypes: () => Promise<TaskTypeNode[]>;
    fetchPreparedProjects: () => Promise<void>;
    fetchPersonsList: () => Promise<VoicebotPerson[]>;
    createPerson: (personData: Record<string, unknown>) => Promise<VoicebotPerson>;
    updateSessionParticipants: (sessionId: string, participantIds: string[]) => Promise<boolean>;
}

interface VoiceBotUploadActionsSlice {
    uploadAudioFile: (
        file: File,
        sessionId: string,
        opt?: { onUploadProgress?: (evt: AxiosProgressEvent) => void }
    ) => Promise<unknown>;
    uploadSessionImageAttachment: (
        file: File,
        sessionId: string
    ) => Promise<Record<string, unknown>>;
    addSessionTextChunk: (sessionId: string, text: string) => Promise<void>;
    addSessionImageChunk: (
        sessionId: string,
        payload: {
            dataUrl: string;
            mimeType: string;
            name?: string;
            caption?: string;
            size?: number | null;
            targetMessageId?: string;
        }
    ) => Promise<void>;
    updateSessionAllowedUsers: (sessionId: string, allowedUserIds: string[]) => Promise<boolean>;
    fetchPerformersList: (includeIds?: string[]) => Promise<Array<Record<string, unknown>>>;
    fetchPerformersForTasksList: (includeIds?: string[]) => Promise<Array<Record<string, unknown>>>;
}

interface VoiceBotTicketsActionsSlice {
    confirmSelectedTickets: (
        selectedTicketIds: string[],
        updatedTickets?: Array<Record<string, unknown>> | null
    ) => Promise<{ createdTaskIds: string[]; removedRowIds: string[]; rowErrors: VoiceTaskCreateRowError[] }>;
    rejectAllTickets: () => void;
    deleteTaskFromSession: (taskId: string) => Promise<boolean>;
    deleteSession: (sessionId: string) => Promise<boolean>;
    mergeSessions: (payload: {
        sessionIds: string[];
        targetSessionId: string;
        confirmationPhrase: string;
        operationId?: string;
    }) => Promise<Record<string, unknown>>;
    downloadTranscription: (sessionId: string) => Promise<void>;
}

interface VoiceBotToolsActionsSlice {
    fetchProjectTopics: (projectId: string, sessionId?: string | null) => Promise<unknown>;
    runCustomPrompt: (
        prompt: string,
        input: unknown,
        model?: string,
        sessionId?: string | null,
        inputType?: string
    ) => Promise<unknown>;
}

type VoiceBotStoreShape = VoiceBotSessionDataSlice &
    VoiceBotSocketDataSlice &
    VoiceBotCatalogDataSlice &
    VoiceBotSessionCrudActionsSlice &
    VoiceBotSessionProcessingActionsSlice &
    VoiceBotSessionsListActionsSlice &
    VoiceBotUploadActionsSlice &
    VoiceBotTicketsActionsSlice &
    VoiceBotToolsActionsSlice;

const normalizeIdentityMessageRef = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    return '';
};

const normalizeIdentityIndex = (value: unknown, fallback: number): number => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
    return fallback;
};

const withStableRowIdentity = (row: VoiceMessageRow, fallbackRowIndex: number): VoiceMessageRow => {
    const row_index = normalizeIdentityIndex(row.row_index, fallbackRowIndex);
    const segment_oid = resolveCategorizationSegmentOid(row as unknown as Record<string, unknown>) || undefined;
    const messageRef = normalizeIdentityMessageRef(row.message_id ?? row.material_source_message_id);
    const row_id = buildCategorizationRowIdentity({
        explicitRowId: row.row_id,
        segmentOid: segment_oid,
        messageRef,
        timeStart: row.timeStart,
        timeEnd: row.timeEnd,
        text: row.text,
        sourceIndex: row_index,
    });

    return {
        ...row,
        row_index,
        segment_oid,
        row_id,
    };
};

const dedupeMaterialRows = (rows: VoiceMessageRow[]): VoiceMessageRow[] => {
    const seen = new Set<string>();
    const uniqueRows: VoiceMessageRow[] = [];
    for (const row of rows) {
        const key = [
            typeof row.imageUrl === 'string' ? row.imageUrl : '',
            typeof row.imageName === 'string' ? row.imageName : '',
            typeof row.material_source_message_id === 'string'
                ? row.material_source_message_id
                : (typeof row.message_id === 'string' ? row.message_id : ''),
        ].join('::');
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueRows.push(row);
    }
    return uniqueRows;
};

const voiceMessageLinkUtils = {
    getMessageRecord(msg: VoiceBotMessage): Record<string, unknown> {
        return msg && typeof msg === 'object' ? (msg as unknown as Record<string, unknown>) : {};
    },
    isMessageDeleted(msg: VoiceBotMessage | null | undefined): boolean {
        if (!msg || typeof msg !== 'object') return false;
        const value = this.getMessageRecord(msg).is_deleted;
        if (value === true) return true;
        if (typeof value === 'number') return value === 1;
        if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
        return false;
    },
    normalizeMessageRef(value: unknown): string {
        if (typeof value === 'string') return value.trim();
        if (value && typeof value === 'object') {
            const record = value as { $oid?: unknown };
            if (typeof record.$oid === 'string') return record.$oid.trim();
        }
        return '';
    },
    getMessageLinkRefs(msg: VoiceBotMessage): string[] {
        const refs = [
            this.normalizeMessageRef(msg?.message_id),
            this.normalizeMessageRef(msg?._id),
        ].filter((value): value is string => value.length > 0);
        return Array.from(new Set(refs));
    },
    getPrimaryMessageRef(msg: VoiceBotMessage): string {
        const refs = this.getMessageLinkRefs(msg);
        return refs[0] ?? '';
    },
    getRowsByMessageRefs(source: Map<string, VoiceMessageRow[]>, refs: string[]): VoiceMessageRow[] {
        for (const ref of refs) {
            const rows = source.get(ref);
            if (Array.isArray(rows) && rows.length > 0) return rows;
        }
        return [];
    },
    getImageRowsFromMessage(msg: VoiceBotMessage): VoiceMessageRow[] {
        const record = this.getMessageRecord(msg);
        const attachments = Array.isArray(record.attachments) ? record.attachments : [];
        const messageRef = this.getPrimaryMessageRef(msg);
        const sourceFileName = extractVoiceSourceFileName(msg);

        return attachments
            .map((attachment) => {
                const item = attachment && typeof attachment === 'object' ? (attachment as Record<string, unknown>) : null;
                if (!item) return null;

                const mime =
                    typeof item.mime_type === 'string'
                        ? item.mime_type
                        : typeof item.mimeType === 'string'
                            ? item.mimeType
                            : '';
                const kind = typeof item.kind === 'string' ? item.kind : '';
                const url =
                    normalizeAttachmentUri(item.direct_uri) ||
                    normalizeAttachmentUri(item.uri) ||
                    normalizeAttachmentUri(item.url);

                if (!url) return null;
                if (!(mime.startsWith('image/') || kind === 'image')) return null;

                const imageName =
                    typeof item.name === 'string'
                        ? item.name
                        : typeof item.file_unique_id === 'string'
                            ? item.file_unique_id
                            : 'image';
                const fallbackText =
                    typeof msg.transcription_text === 'string' && msg.transcription_text.trim()
                        ? msg.transcription_text.trim()
                        : typeof msg.text === 'string' && msg.text.trim()
                            ? msg.text.trim()
                            : '[Image]';

                return {
                    avatar: 'I',
                    name: 'Image',
                    text: fallbackText,
                    kind: 'image' as const,
                    imageUrl: url,
                    imageName,
                    message_id: messageRef || undefined,
                    source_file_name: sourceFileName || undefined,
                    message_timestamp: msg.message_timestamp,
                    material_source_message_id: messageRef || undefined,
                } satisfies VoiceMessageRow;
            })
            .filter((row): row is Exclude<typeof row, null> => row !== null);
    },
};

const transformVoiceBotMessagesToGroups = (voiceBotMessages: VoiceBotMessage[]): VoiceMessageGroup[] => {
    if (!Array.isArray(voiceBotMessages)) return [];

    const imageRowsByMessageRef = new Map<string, VoiceMessageRow[]>();
    const explicitLinkedImageRowsByTargetRef = new Map<string, Array<{ anchorMessageRef: string; rows: VoiceMessageRow[] }>>();
    const linkedImageAnchorRefs = new Set<string>();
    const allMessageRefs = new Set<string>();
    for (const msg of voiceBotMessages) {
        if (voiceMessageLinkUtils.isMessageDeleted(msg)) continue;
        const messageRefs = voiceMessageLinkUtils.getMessageLinkRefs(msg);
        for (const ref of messageRefs) allMessageRefs.add(ref);
        const imageRows = voiceMessageLinkUtils.getImageRowsFromMessage(msg);
        if (messageRefs.length > 0 && imageRows.length > 0) {
            for (const ref of messageRefs) {
                imageRowsByMessageRef.set(ref, imageRows);
            }
        }

        const record = voiceMessageLinkUtils.getMessageRecord(msg);
        const imageAnchorRef = voiceMessageLinkUtils.normalizeMessageRef(record.image_anchor_message_id);
        if (imageAnchorRef) linkedImageAnchorRefs.add(imageAnchorRef);

        const imageAnchorLinkedTargetRef = voiceMessageLinkUtils.normalizeMessageRef(record.image_anchor_linked_message_id);
        const anchorMessageRef = messageRefs[0] ?? '';
        if (imageRows.length > 0 && imageAnchorLinkedTargetRef && anchorMessageRef) {
            const current = explicitLinkedImageRowsByTargetRef.get(imageAnchorLinkedTargetRef) ?? [];
            explicitLinkedImageRowsByTargetRef.set(imageAnchorLinkedTargetRef, [
                ...current,
                {
                    anchorMessageRef,
                    rows: imageRows,
                },
            ]);
        }
    }

    const explicitlyLinkedAnchorRefs = new Set<string>();
    for (const [targetRef, entries] of explicitLinkedImageRowsByTargetRef.entries()) {
        if (!allMessageRefs.has(targetRef)) continue;
        for (const entry of entries) {
            explicitlyLinkedAnchorRefs.add(entry.anchorMessageRef);
        }
    }

    return voiceBotMessages.flatMap((msg) => {
        if (voiceMessageLinkUtils.isMessageDeleted(msg)) return [];
        const messageRefs = voiceMessageLinkUtils.getMessageLinkRefs(msg);
        const primaryMessageRef = messageRefs[0] ?? '';
        const messageDbId = typeof msg._id === 'string' ? msg._id.trim() : '';
        const ownImageRows = voiceMessageLinkUtils.getRowsByMessageRefs(imageRowsByMessageRef, messageRefs);
        const record = voiceMessageLinkUtils.getMessageRecord(msg);
        const sourceFileName = extractVoiceSourceFileName(msg);
        const imageAnchorRef = voiceMessageLinkUtils.normalizeMessageRef(record.image_anchor_message_id);
        const linkedAnchorRows = imageAnchorRef ? (imageRowsByMessageRef.get(imageAnchorRef) ?? []) : [];
        const explicitLinkedEntries = messageRefs.flatMap((ref) => explicitLinkedImageRowsByTargetRef.get(ref) ?? []);
        const explicitLinkedRows = explicitLinkedEntries.flatMap((entry) => entry.rows);

        if (
            ownImageRows.length > 0 &&
            messageRefs.some((ref) => linkedImageAnchorRefs.has(ref) || explicitlyLinkedAnchorRefs.has(ref))
        ) {
            return [];
        }

        const categorizationRows: VoiceMessageRow[] = (msg.categorization || []).map((cat, catIndex) => {
            const catRecord = cat && typeof cat === 'object' ? (cat as Record<string, unknown>) : {};
            const { startSeconds, endSeconds } = normalizeTimelineRangeSeconds(catRecord.start, catRecord.end);
            let avatar = 'U';
            const speaker = typeof catRecord.speaker === 'string' ? catRecord.speaker : '';
            const sourceSegmentId =
                typeof catRecord.source_segment_id === 'string'
                    ? catRecord.source_segment_id.trim()
                    : typeof catRecord.id === 'string'
                        ? catRecord.id.trim()
                        : '';
            const segmentOid = resolveCategorizationSegmentOid(catRecord) || undefined;
            if (speaker && speaker !== 'Unknown' && speaker.length > 0) {
                avatar = speaker[0]?.toUpperCase() ?? 'U';
            }
            return {
                timeStart: startSeconds,
                timeEnd: endSeconds,
                avatar,
                row_index: catIndex,
                segment_oid: segmentOid,
                source_segment_id: sourceSegmentId || undefined,
                name: speaker,
                text: typeof catRecord.text === 'string' ? catRecord.text.trim() : '',
                kind: 'categorization' as const,
                goal: typeof catRecord.related_goal === 'string' ? catRecord.related_goal : '',
                patt: typeof catRecord.new_pattern_detected === 'string' ? catRecord.new_pattern_detected : '',
                flag: typeof catRecord.quality_flag === 'string' ? catRecord.quality_flag : '',
                keywords: typeof catRecord.topic_keywords === 'string' ? catRecord.topic_keywords : '',
                source_file_name: sourceFileName || undefined,
                message_timestamp: msg.message_timestamp,
                message_id: primaryMessageRef || undefined,
                message_db_id: messageDbId || undefined,
            };
        }).filter((row) => typeof row.text === 'string' && row.text.trim().length > 0);

        let rows: VoiceMessageRow[] = categorizationRows;
        if (rows.length === 0) {
            const fallbackText =
                typeof msg.transcription_text === 'string' && msg.transcription_text.trim()
                    ? msg.transcription_text.trim()
                    : typeof msg.text === 'string' && msg.text.trim()
                        ? msg.text.trim()
                        : '';
            if (fallbackText) {
                rows = [
                    {
                        avatar: 'T',
                        name: 'Text',
                        text: fallbackText,
                        kind: 'text' as const,
                        source_file_name: sourceFileName || undefined,
                        message_timestamp: msg.message_timestamp,
                        message_id: primaryMessageRef || undefined,
                        message_db_id: messageDbId || undefined,
                    },
                ];
            }
        }

        let materialRows = dedupeMaterialRows([
            ...explicitLinkedRows,
            ...linkedAnchorRows,
            ...ownImageRows,
        ]);

        const explicitAnchorMessageId = explicitLinkedEntries[0]?.anchorMessageRef ?? '';
        const materialAnchorMessageId =
            imageAnchorRef ||
            explicitAnchorMessageId ||
            (materialRows.length > 0 ? primaryMessageRef : '');
        const materialTargetMessageId = primaryMessageRef;
        const materialGroupId = materialAnchorMessageId && materialTargetMessageId
            ? `${materialAnchorMessageId}::${materialTargetMessageId}`
            : '';
        if (materialGroupId) {
            rows = rows.map((row) => ({
                ...row,
                material_group_id: materialGroupId,
                material_anchor_message_id: materialAnchorMessageId,
                material_target_message_id: materialTargetMessageId,
                material_source_message_id: row.material_source_message_id ?? row.message_id,
            }));
            materialRows = materialRows.map((row) => ({
                ...row,
                material_group_id: materialGroupId,
                material_anchor_message_id: materialAnchorMessageId,
                material_target_message_id: materialTargetMessageId,
                material_source_message_id: row.material_source_message_id ?? row.message_id,
            }));
        }
        rows = rows.map((row) => ({
            ...row,
            source_file_name: (row.source_file_name ?? sourceFileName) || undefined,
            message_timestamp: row.message_timestamp ?? msg.message_timestamp,
        }));
        materialRows = materialRows.map((row) => ({
            ...row,
            source_file_name: (row.source_file_name ?? sourceFileName) || undefined,
            message_timestamp: row.message_timestamp ?? msg.message_timestamp,
        }));
        rows = rows.map((row, rowIndex) => withStableRowIdentity(row, rowIndex));
        materialRows = materialRows.map((row, rowIndex) => withStableRowIdentity(row, rowIndex));

        return [
            {
                message_id: primaryMessageRef || undefined,
                message_timestamp: msg.message_timestamp,
                material_group_id: materialGroupId || undefined,
                material_anchor_message_id: materialAnchorMessageId || undefined,
                material_target_message_id: materialTargetMessageId || undefined,
                original_message: msg,
                rows,
                materials: materialRows,
                summary: {
                    text: (msg.processors_data?.summarization?.data?.[0]?.summary as string) || '',
                },
                widgets: (() => {
                    const custom_widgets = _.omit(msg.processors_data, ['transcription', 'summarization', 'categorization', 'questioning']);
                    const widgets: Record<string, unknown> = {};
                    for (const [key, value] of Object.entries(custom_widgets || {})) {
                        const typedValue = value as { data?: Array<Record<string, unknown>> };
                        if (typedValue?.data && Array.isArray(typedValue.data)) {
                            widgets[key] = typedValue.data.map((d) => ({ ...d, message_id: msg.message_id }));
                        }
                    }
                    return {
                        questions:
                            (msg.processors_data?.questioning?.data?.map((d) => ({
                                ...(d as Record<string, unknown>),
                                message_id: msg.message_id,
                            })) || []) as unknown,
                        ...widgets,
                    };
                })(),
            },
        ];
    });
};

const messageListUtils = {
    getIdentity(message: VoiceBotMessage): string {
        const messageId = typeof message.message_id === 'string' ? message.message_id.trim() : '';
        if (messageId) return `mid:${messageId}`;
        const oid = typeof message._id === 'string' ? message._id.trim() : '';
        if (oid) return `oid:${oid}`;
        return '';
    },
    getTimestamp(message: VoiceBotMessage): number {
        const raw = message.message_timestamp;
        const numeric = Number(raw);
        if (Number.isFinite(numeric)) return numeric;
        return 0;
    },
    sort(messages: VoiceBotMessage[]): VoiceBotMessage[] {
        return [...messages].sort((left, right) => {
            const leftTs = this.getTimestamp(left);
            const rightTs = this.getTimestamp(right);
            if (leftTs !== rightTs) return leftTs - rightTs;
            const leftId = `${left.message_id || left._id || ''}`;
            const rightId = `${right.message_id || right._id || ''}`;
            return leftId.localeCompare(rightId);
        });
    },
    upsert(current: VoiceBotMessage[], incoming: VoiceBotMessage): VoiceBotMessage[] {
        const incomingIdentity = this.getIdentity(incoming);
        const matchIncoming = (existing: VoiceBotMessage): boolean => {
            const existingIdentity = this.getIdentity(existing);
            const identityMatch = Boolean(incomingIdentity && existingIdentity && incomingIdentity === existingIdentity);
            const fallbackMatch = Boolean(
                (incoming.message_id && existing.message_id && incoming.message_id === existing.message_id) ||
                (incoming._id && existing._id && incoming._id === existing._id)
            );
            return identityMatch || fallbackMatch;
        };

        if (voiceMessageLinkUtils.isMessageDeleted(incoming)) {
            const withoutIncoming = current.filter((existing) => !matchIncoming(existing) && !voiceMessageLinkUtils.isMessageDeleted(existing));
            return this.sort(withoutIncoming);
        }

        const next = [...current];
        let replaced = false;

        for (let index = 0; index < next.length; index++) {
            const existing = next[index];
            if (!existing) continue;
            if (matchIncoming(existing)) {
                next[index] = { ...existing, ...incoming };
                replaced = true;
                break;
            }
        }

        if (!replaced) next.push(incoming);
        return this.sort(next.filter((message) => !voiceMessageLinkUtils.isMessageDeleted(message)));
    },
};

const normalizeAttachmentUri = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('/api/voicebot/')) return trimmed;
    if (trimmed.startsWith('/voicebot/')) return `/api${trimmed}`;
    return trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const readString = (record: Record<string, unknown>, keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = record[key];
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return undefined;
};

const readNullableString = (record: Record<string, unknown>, keys: string[]): string | null | undefined => {
    let hasExplicitNull = false;
    for (const key of keys) {
        const value = record[key];
        if (value == null) {
            hasExplicitNull = true;
            continue;
        }
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
        hasExplicitNull = true;
    }
    return hasExplicitNull ? null : undefined;
};

const readInteger = (record: Record<string, unknown>, keys: string[]): number | null | undefined => {
    for (const key of keys) {
        const value = record[key];
        if (value == null) return null;
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
    return undefined;
};

const normalizePayloadMediaKind = (value: string | undefined): VoicePayloadMediaKind | undefined => {
    if (!value) return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'audio') return 'audio';
    if (normalized === 'video') return 'video';
    if (normalized === 'image') return 'image';
    if (normalized === 'binary_document' || normalized === 'binarydocument') return 'binary_document';
    if (normalized === 'unknown') return 'unknown';
    return undefined;
};

const normalizeTranscriptionEligibility = (value: string | null | undefined): VoiceTranscriptionEligibility | undefined => {
    if (value == null) return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'eligible') return 'eligible';
    if (normalized === 'ineligible') return 'ineligible';
    return undefined;
};

const normalizeClassificationResolutionState = (
    value: string | null | undefined
): VoiceClassificationResolutionState | null | undefined => {
    if (value == null) return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'resolved') return 'resolved';
    if (normalized === 'pending') return 'pending';
    return undefined;
};

const normalizeTranscriptionProcessingState = (
    value: string | null | undefined
): VoiceTranscriptionProcessingState | null | undefined => {
    if (value == null) return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'pending_classification') return 'pending_classification';
    if (normalized === 'pending_transcription') return 'pending_transcription';
    if (normalized === 'transcribed') return 'transcribed';
    if (normalized === 'classified_skip') return 'classified_skip';
    if (normalized === 'transcription_error') return 'transcription_error';
    return undefined;
};

const normalizeIsTranscribed = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) return undefined;
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return undefined;
};

const normalizeMessageAttachment = (
    value: unknown,
    fallbackAttachmentIndex: number
): VoiceMessageAttachment | null => {
    if (!isRecord(value)) return null;
    const item = value;
    const payloadMediaKind = normalizePayloadMediaKind(
        readString(item, ['payload_media_kind', 'payloadMediaKind', 'media_kind', 'mediaKind'])
    );
    const classificationResolutionState = normalizeClassificationResolutionState(
        readNullableString(item, ['classification_resolution_state', 'classificationResolutionState', 'classification_state'])
    );
    const transcriptionEligibility = normalizeTranscriptionEligibility(
        readNullableString(item, ['transcription_eligibility', 'transcriptionEligibility', 'eligibility'])
    );
    const transcriptionProcessingState = normalizeTranscriptionProcessingState(
        readNullableString(item, ['transcription_processing_state', 'transcriptionProcessingState', 'transcription_state'])
    );

    const attachmentIndex = readInteger(item, ['attachment_index', 'attachmentIndex']);
    const transcriptionText = readNullableString(item, ['transcription_text', 'transcriptionText']);
    const transcriptionError = readNullableString(item, ['transcription_error', 'transcriptionError']);
    const transcriptionSkipReason = readNullableString(item, ['transcription_skip_reason', 'transcriptionSkipReason', 'skip_reason']);
    const transcriptionRaw = item.transcription_raw ?? item.transcriptionRaw ?? item.transcription_result ?? item.provider_result;
    const speechBearingAssessment = readNullableString(item, ['speech_bearing_assessment', 'speechBearingAssessment']);
    const transcriptionEligibilityBasis = readNullableString(item, ['transcription_eligibility_basis', 'transcriptionEligibilityBasis']);
    const classificationRuleRef = readNullableString(item, ['classification_rule_ref', 'classificationRuleRef']);
    const audioTrackState = readNullableString(item, ['audio_track_state', 'audioTrackState']);

    return {
        ...item,
        attachment_index: attachmentIndex ?? fallbackAttachmentIndex,
        payload_media_kind: payloadMediaKind ?? null,
        speech_bearing_assessment: speechBearingAssessment ?? null,
        classification_resolution_state: classificationResolutionState ?? null,
        transcription_eligibility: transcriptionEligibility ?? null,
        transcription_processing_state: transcriptionProcessingState ?? null,
        transcription_skip_reason: transcriptionSkipReason ?? null,
        transcription_eligibility_basis: transcriptionEligibilityBasis ?? null,
        classification_rule_ref: classificationRuleRef ?? null,
        transcription_text: transcriptionText ?? null,
        transcription_raw: transcriptionRaw ?? null,
        transcription_error: transcriptionError ?? null,
        audio_track_state: audioTrackState ?? null,
        payloadMediaKind: payloadMediaKind ?? null,
        speechBearingAssessment: speechBearingAssessment ?? null,
        classificationResolutionState: classificationResolutionState ?? null,
        transcriptionEligibility: transcriptionEligibility ?? null,
        transcriptionProcessingState: transcriptionProcessingState ?? null,
        transcriptionSkipReason: transcriptionSkipReason ?? null,
        transcriptionEligibilityBasis: transcriptionEligibilityBasis ?? null,
        classificationRuleRef: classificationRuleRef ?? null,
        transcriptionText: transcriptionText ?? null,
        transcriptionRaw: transcriptionRaw ?? null,
        transcriptionError: transcriptionError ?? null,
        audioTrackState: audioTrackState ?? null,
    };
};

const normalizeVoiceBotMessage = (value: unknown): VoiceBotMessage | null => {
    if (!isRecord(value)) return null;
    const record = value;
    const attachmentsSource = Array.isArray(record.attachments) ? record.attachments : [];
    const attachments = attachmentsSource
        .map((item, index) => normalizeMessageAttachment(item, index))
        .filter((item): item is VoiceMessageAttachment => !!item);
    const primaryAttachmentIndex = readInteger(record, [
        'primary_transcription_attachment_index',
        'primaryTranscriptionAttachmentIndex',
        'primary_attachment_index',
        'attachment_index',
    ]);
    const primaryPayloadMediaKind = normalizePayloadMediaKind(
        readString(record, ['primary_payload_media_kind', 'primaryPayloadMediaKind', 'payload_media_kind', 'payloadMediaKind'])
    );
    const classificationResolutionState = normalizeClassificationResolutionState(
        readNullableString(record, ['classification_resolution_state', 'classificationResolutionState', 'classification_state'])
    );
    const transcriptionEligibility = normalizeTranscriptionEligibility(
        readNullableString(record, ['transcription_eligibility', 'transcriptionEligibility', 'eligibility'])
    );
    const sourceNoteText = readNullableString(record, ['source_note_text', 'sourceNoteText', 'source_note']);
    const transcriptionSkipReason = readNullableString(record, ['transcription_skip_reason', 'transcriptionSkipReason', 'skip_reason']);
    const transcriptionEligibilityBasis = readNullableString(record, ['transcription_eligibility_basis', 'transcriptionEligibilityBasis']);
    const classificationRuleRef = readNullableString(record, ['classification_rule_ref', 'classificationRuleRef']);
    const audioTrackState = readNullableString(record, ['audio_track_state', 'audioTrackState']);
    const transcriptionText = readNullableString(record, ['transcription_text', 'transcriptionText']);
    const transcriptionError = readNullableString(record, ['transcription_error', 'transcriptionError']);
    const hasTranscriptionText = typeof transcriptionText === 'string' && transcriptionText.trim().length > 0;

    let transcriptionProcessingState = normalizeTranscriptionProcessingState(
        readNullableString(record, ['transcription_processing_state', 'transcriptionProcessingState', 'transcription_state'])
    );
    const normalizedIsTranscribed = normalizeIsTranscribed(record.is_transcribed);
    if (!transcriptionProcessingState) {
        if (classificationResolutionState === 'pending') {
            transcriptionProcessingState = 'pending_classification';
        } else if (transcriptionEligibility === 'ineligible') {
            transcriptionProcessingState = 'classified_skip';
        } else if (normalizedIsTranscribed === true || hasTranscriptionText) {
            transcriptionProcessingState = 'transcribed';
        } else if (transcriptionError) {
            transcriptionProcessingState = 'transcription_error';
        } else if (record.to_transcribe === true || transcriptionEligibility === 'eligible') {
            transcriptionProcessingState = 'pending_transcription';
        }
    }

    return {
        ...record,
        attachments,
        primary_payload_media_kind: primaryPayloadMediaKind ?? null,
        primary_transcription_attachment_index: primaryAttachmentIndex ?? null,
        transcription_eligibility: transcriptionEligibility ?? null,
        classification_resolution_state: classificationResolutionState ?? null,
        transcription_processing_state: transcriptionProcessingState ?? null,
        transcription_skip_reason: transcriptionSkipReason ?? null,
        transcription_eligibility_basis: transcriptionEligibilityBasis ?? null,
        classification_rule_ref: classificationRuleRef ?? null,
        source_note_text: sourceNoteText ?? null,
        audio_track_state: audioTrackState ?? null,
        transcription_text: transcriptionText ?? '',
        transcription_error: transcriptionError ?? null,
        payload_media_kind: primaryPayloadMediaKind ?? null,
        primary_attachment_index: primaryAttachmentIndex ?? null,
        transcription_state: transcriptionProcessingState ?? null,
        classification_state: classificationResolutionState ?? null,
        eligibility: transcriptionEligibility ?? null,
        skip_reason: transcriptionSkipReason ?? null,
        source_note: sourceNoteText ?? null,
        payloadMediaKind: primaryPayloadMediaKind ?? null,
        primaryTranscriptionAttachmentIndex: primaryAttachmentIndex ?? null,
        transcriptionEligibility: transcriptionEligibility ?? null,
        classificationResolutionState: classificationResolutionState ?? null,
        transcriptionProcessingState: transcriptionProcessingState ?? null,
        transcriptionSkipReason: transcriptionSkipReason ?? null,
        transcriptionEligibilityBasis: transcriptionEligibilityBasis ?? null,
        classificationRuleRef: classificationRuleRef ?? null,
        sourceNoteText: sourceNoteText ?? null,
        audioTrackState: audioTrackState ?? null,
        is_transcribed: normalizedIsTranscribed ?? (transcriptionProcessingState === 'transcribed'),
    };
};

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseSessionTimestamp = (value: unknown): number => {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (!normalized) return 0;
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) {
            return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
        }
        const parsed = Date.parse(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
};

const compareSessionsListOrder = (left: VoiceBotSession, right: VoiceBotSession): number => {
    const leftCreatedTs = parseSessionTimestamp(left.created_at);
    const rightCreatedTs = parseSessionTimestamp(right.created_at);
    if (leftCreatedTs !== rightCreatedTs) {
        return rightCreatedTs - leftCreatedTs;
    }

    const leftLastVoiceTs = parseSessionTimestamp(left.last_voice_timestamp);
    const rightLastVoiceTs = parseSessionTimestamp(right.last_voice_timestamp);
    if (leftLastVoiceTs !== rightLastVoiceTs) {
        return rightLastVoiceTs - leftLastVoiceTs;
    }

    return String(right._id ?? '').localeCompare(String(left._id ?? ''));
};

const normalizeSessionAttachment = (value: unknown): VoiceSessionAttachment | null => {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    const uri = normalizeAttachmentUri(item.uri);
    const url = normalizeAttachmentUri(item.url) ?? uri;
    const directUri = normalizeAttachmentUri(item.direct_uri);
    return {
        _id: String(item._id ?? `${item.message_oid ?? 'msg'}::${item.file_id ?? item.name ?? Math.random().toString(36).slice(2)}`),
        message_id: item.message_id != null ? String(item.message_id) : null,
        message_oid: item.message_oid != null ? String(item.message_oid) : null,
        message_timestamp: item.message_timestamp != null ? Number(item.message_timestamp) : null,
        message_type: item.message_type != null ? String(item.message_type) : null,
        kind: item.kind != null ? String(item.kind) : null,
        source: item.source != null ? String(item.source) : null,
        source_type: item.source_type != null ? String(item.source_type) : null,
        uri,
        url,
        name: item.name != null ? String(item.name) : null,
        mimeType: item.mimeType != null ? String(item.mimeType) : (item.mime_type != null ? String(item.mime_type) : null),
        size: toFiniteNumber(item.size),
        width: toFiniteNumber(item.width),
        height: toFiniteNumber(item.height),
        caption: item.caption != null ? String(item.caption) : null,
        file_id: item.file_id != null ? String(item.file_id) : null,
        file_unique_id: item.file_unique_id != null ? String(item.file_unique_id) : null,
        direct_uri: directUri,
    };
};

const buildSessionAttachmentsFromMessages = (messages: VoiceBotMessage[]): VoiceSessionAttachment[] => {
    const attachments: VoiceSessionAttachment[] = [];
    for (const message of messages) {
        if (voiceMessageLinkUtils.isMessageDeleted(message)) continue;
        const messageRecord = message as unknown as Record<string, unknown>;
        const messageAttachments = Array.isArray(messageRecord.attachments) ? messageRecord.attachments : [];
        if (messageAttachments.length === 0) continue;

        const messageTimestamp = message.message_timestamp != null ? Number(message.message_timestamp) : 0;
        const messageId = message.message_id != null ? String(message.message_id) : null;
        const messageObjectId = message._id != null ? String(message._id) : null;
        const messageSessionId = messageRecord.session_id != null ? String(messageRecord.session_id) : null;
        const sourceType = message.source_type != null ? String(message.source_type) : null;
        const messageType = messageRecord.message_type != null ? String(messageRecord.message_type) : null;
        const fallbackFileId = messageRecord.file_id != null ? String(messageRecord.file_id) : null;
        const captionFallback = typeof (messageRecord.text) === 'string' ? String(messageRecord.text) : '';
        for (let attachmentIndex = 0; attachmentIndex < messageAttachments.length; attachmentIndex++) {
            const attachment = messageAttachments[attachmentIndex];
            if (!attachment || typeof attachment !== 'object') continue;
            const item = attachment as Record<string, unknown>;
            const fileId = item.file_id != null ? String(item.file_id) : fallbackFileId;
            const isTelegram = (item.source != null ? String(item.source) : null) === 'telegram' || sourceType === 'telegram';
            let uri = normalizeAttachmentUri(item.uri ?? item.url);
            let url = normalizeAttachmentUri(item.url ?? item.uri) ?? uri;
            let directUri = normalizeAttachmentUri(item.direct_uri);
            if (isTelegram && messageObjectId && fileId) {
                uri = `/api/voicebot/message_attachment/${messageObjectId}/${attachmentIndex}`;
                url = uri;
                if (messageSessionId && item.file_unique_id != null) {
                    directUri = `/api/voicebot/public_attachment/${messageSessionId}/${String(item.file_unique_id)}`;
                }
            }
            if (!uri && !url && !fileId) continue;
            attachments.push({
                _id: `${messageObjectId || messageId || 'unknown'}::${String(item.uri ?? item.name ?? fileId ?? attachmentIndex)}`,
                message_id: messageId,
                message_oid: messageObjectId,
                message_timestamp: Number.isFinite(messageTimestamp) ? messageTimestamp : 0,
                message_type: messageType,
                kind: item.kind != null ? String(item.kind) : messageType,
                source: item.source != null ? String(item.source) : null,
                source_type: sourceType,
                uri,
                url,
                name: item.name != null ? String(item.name) : (item.filename != null ? String(item.filename) : null),
                mimeType: item.mimeType != null ? String(item.mimeType) : (item.mime_type != null ? String(item.mime_type) : null),
                size: toFiniteNumber(item.size),
                width: toFiniteNumber(item.width),
                height: toFiniteNumber(item.height),
                caption: item.caption != null ? String(item.caption) : captionFallback,
                file_id: fileId,
                file_unique_id: item.file_unique_id != null ? String(item.file_unique_id) : null,
                direct_uri: directUri,
            });
        }
    }
    attachments.sort((left, right) => {
        const leftTs = Number(left.message_timestamp ?? 0);
        const rightTs = Number(right.message_timestamp ?? 0);
        if (leftTs !== rightTs) return leftTs - rightTs;
        return `${left.message_id ?? ''}`.localeCompare(`${right.message_id ?? ''}`);
    });
    return attachments;
};

const normalizeSessionResponse = (response: unknown): VoiceBotSessionResponse => {
    const payload = response as Record<string, unknown>;
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const rawMessages = Array.isArray(data.session_messages) ? data.session_messages : [];
    const messages = rawMessages
        .map((msg) => normalizeVoiceBotMessage(msg))
        .filter((msg): msg is VoiceBotMessage => msg !== null)
        .filter((msg) => !voiceMessageLinkUtils.isMessageDeleted(msg));
    const explicitAttachments = Array.isArray(data.session_attachments)
        ? data.session_attachments.map(normalizeSessionAttachment).filter((item): item is VoiceSessionAttachment => item !== null)
        : [];
    const sessionAttachments = explicitAttachments.length > 0
        ? explicitAttachments
        : buildSessionAttachmentsFromMessages(messages);
    return {
        voice_bot_session: data.voice_bot_session as VoiceBotSession,
        session_messages: messages,
        session_attachments: sessionAttachments,
        socket_token: (data.socket_token as string | null) ?? null,
        socket_port: (data.socket_port as number | null) ?? null,
    };
};

export const useVoiceBotStore = create<VoiceBotStoreShape>((set, get) => ({
    currentSessionId: null,
    voiceBotSession: null,
    voiceBotMessages: [],
    voiceMesagesData: [],
    sessionAttachments: [],
    possibleTasks: [],
    possibleTasksLoadedAt: null,
    sessionLogEvents: [],
    socketToken: null,
    socketPort: null,
    socket: null,
    highlightedMessageId: null,
    sessionTasksRefreshToken: 0,
    sessionCodexRefreshToken: 0,
    task_types: null,
    voiceBotSessionsList: [],
    prepared_projects: null,
    persons_list: null,
    performers_list: null,
    performers_for_tasks_list: null,
    isSessionsListLoading: false,
    sessionsListLoadedAt: null,
    sessionsListIncludeDeleted: null,

    updateSessionName: async (sessionId, newName) => {
        try {
            await voicebotHttp.request('voicebot/sessions/update_name', { session_id: sessionId, session_name: newName });
            set((state) => ({
                voiceBotSession: state.voiceBotSession?._id === sessionId ? { ...state.voiceBotSession, session_name: newName } : state.voiceBotSession,
                voiceBotSessionsList: state.voiceBotSessionsList.map((session) =>
                    session._id === sessionId ? { ...session, session_name: newName } : session
                ),
            }));
        } catch (e) {
            console.error('Ошибка при обновлении названия встречи', e);
        }
    },

    updateSessionDialogueTag: async (sessionId, dialogueTag) => {
        try {
            await voicebotHttp.request('voicebot/sessions/update_dialogue_tag', { session_id: sessionId, dialogue_tag: dialogueTag });
            set((state) => ({
                voiceBotSession: state.voiceBotSession?._id === sessionId ? { ...state.voiceBotSession, dialogue_tag: dialogueTag } : state.voiceBotSession,
                voiceBotSessionsList: state.voiceBotSessionsList.map((session) =>
                    session._id === sessionId ? { ...session, dialogue_tag: dialogueTag } : session
                ),
            }));
        } catch (e) {
            console.error('Ошибка при обновлении dialogue_tag сессии', e);
        }
    },

    sendSessionToCrm: async (sessionId) => {
        try {
            await voicebotHttp.request('voicebot/sessions/send_to_crm', { session_id: sessionId });
            set((state) => ({
                voiceBotSession: state.voiceBotSession?._id === sessionId ? { ...state.voiceBotSession, show_in_crm: true } : state.voiceBotSession,
                voiceBotSessionsList: state.voiceBotSessionsList.map((session) =>
                    session._id === sessionId ? { ...session, show_in_crm: true } : session
                ),
            }));
            return true;
        } catch (e) {
            console.error('Ошибка при отправке сессии в CRM', e);
            throw e;
        }
    },

    sendSessionToCrmWithMcp: async (sessionId) => {
        const processingKey = `crm-processing-${sessionId}`;
        try {
            message.open({
                key: processingKey,
                type: 'loading',
                content: 'Сессия обрабатывается',
                duration: 0,
            });

            const agentsMcpServerUrl = voicebotRuntimeConfig.resolveAgentsMcpServerUrl();
            if (!agentsMcpServerUrl) {
                message.open({
                    key: processingKey,
                    type: 'error',
                    content: 'Не настроен MCP URL агента',
                    duration: 4,
                });
                return;
            }

            const sessionData = await get().getSessionData(sessionId);
            const sessionMessages = sessionData?.session_messages || [];
            const transcriptionText = buildTranscriptionText(sessionMessages as VoiceBotMessage[]);
            if (!transcriptionText) {
                message.open({
                    key: processingKey,
                    type: 'error',
                    content: 'Нет текста для обработки агентом',
                    duration: 4,
                });
                return;
            }

            const { sendMCPCall, waitForCompletion } = useMCPRequestStore.getState();
            const requestId = sendMCPCall(
                agentsMcpServerUrl,
                'create_tasks',
                { message: transcriptionText },
                false
            );
            const result = await waitForCompletion(requestId, 15 * 60 * 1000);
            if (!result || result.status !== 'complete') {
                throw new Error(result?.error ?? 'Не удалось завершить обработку');
            }

            const final = result.result as { isError?: boolean; content?: Array<{ text?: string }>; error?: string } | undefined;
            if (final?.isError) {
                const errorText = final.content?.[0]?.text || final.error || 'Ошибка обработки';
                throw new Error(errorText);
            }

            const tasksText = final?.content?.[0]?.text || '';
            let tasks: Array<Record<string, unknown>> = [];
            if (typeof tasksText === 'string' && tasksText.trim() !== '') {
                try {
                    const parsed = JSON.parse(tasksText);
                    if (!Array.isArray(parsed)) {
                        throw new Error('create_tasks result is not an array');
                    }
                    tasks = parsed as Array<Record<string, unknown>>;
                } catch (parseError) {
                    throw new Error('Не удалось распарсить результат агента');
                }
            } else {
                throw new Error('Пустой результат агента');
            }

            await voicebotHttp.request('voicebot/sessions/save_create_tasks', {
                session_id: sessionId,
                tasks,
            });

            await get().sendSessionToCrm(sessionId);

            message.open({
                key: processingKey,
                type: 'success',
                content: 'Обработка завершена',
                duration: 2,
            });
        } catch (error) {
            console.error('Ошибка при отправке сессии в CRM:', error);
            message.open({
                key: processingKey,
                type: 'error',
                content: 'Ошибка при отправке в CRM',
            });
        }
    },

    fetchVoiceBotSession: async (sessionId) => {
        const prevSessionId = get().currentSessionId;
        const response = await voicebotHttp.request<unknown>('voicebot/sessions/get', { session_id: sessionId });
        const normalized = normalizeSessionResponse(response);
        const sortedMessages = messageListUtils.sort(normalized.session_messages);
        const processed = transformVoiceBotMessagesToGroups(sortedMessages);

        set({
            voiceBotSession: normalized.voice_bot_session,
            voiceBotMessages: sortedMessages,
            voiceMesagesData: processed,
            sessionAttachments: normalized.session_attachments ?? buildSessionAttachmentsFromMessages(sortedMessages),
            possibleTasks: [],
            possibleTasksLoadedAt: Date.now(),
            sessionLogEvents: [],
            socketToken: normalized.socket_token ?? null,
            socketPort: normalized.socket_port ?? null,
            currentSessionId: sessionId,
            sessionTasksRefreshToken: 0,
            sessionCodexRefreshToken: 0,
        });

        if (!get().socket && normalized.socket_token) {
            const socket = getVoicebotSocket(normalized.socket_token);

            socket.on('connect', () => {
                console.log('Connected to voice bot socket');
                const activeSessionId = get().currentSessionId;
                if (activeSessionId) {
                    socket.emit(SOCKET_EVENTS.SUBSCRIBE_ON_SESSION, { session_id: activeSessionId });
                    void get().fetchVoiceBotSession(activeSessionId).catch((error) => {
                        console.error('Failed to rehydrate voice session after reconnect:', error);
                    });
                }
            });

            socket.on('disconnect', (reason) => {
                console.log('Disconnected from voice bot socket:', reason);
                set({ socket: null });
            });

            socket.on('message_update', (data: { message_id?: string; message?: VoiceBotMessage; _id?: string }) => {
                if (!data?.message) return;
                const normalizedIncoming = normalizeVoiceBotMessage(data.message);
                if (!normalizedIncoming) return;
                set((state) => {
                    const updatedMessages = messageListUtils.upsert(state.voiceBotMessages, normalizedIncoming);
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups(updatedMessages);
                    const updatedAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                    return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments: updatedAttachments };
                });
            });

            socket.on('new_message', (data: VoiceBotMessage) => {
                const normalizedIncoming = normalizeVoiceBotMessage(data);
                if (!normalizedIncoming) return;
                const existingMessage = get().voiceBotMessages.find(
                    (msg) => msg._id === normalizedIncoming.message_id || msg._id === normalizedIncoming._id
                );
                if (existingMessage) return;

                set((state) => {
                    const updatedMessages = messageListUtils.upsert(state.voiceBotMessages, normalizedIncoming);
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups(updatedMessages);
                    const updatedAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                    return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments: updatedAttachments };
                });
            });

            socket.on('session_update', (data: Partial<VoiceBotSession> & { taskflow_refresh?: VoiceSessionTaskflowRefreshHint | null }) => {
                const refreshHint = data?.taskflow_refresh && typeof data.taskflow_refresh === 'object'
                    ? data.taskflow_refresh as VoiceSessionTaskflowRefreshHint
                    : null;
                const eventSessionId = String(data?.session_id || data?._id || '').trim();
                const activeSessionId = String(get().currentSessionId || '').trim();
                const sessionPatch = { ...data };
                delete sessionPatch.taskflow_refresh;

                set((state) => {
                    const nextState: Partial<VoiceBotStoreShape> = {
                        voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, ...sessionPatch } : state.voiceBotSession,
                    };
                    if (refreshHint?.tasks) {
                        nextState.sessionTasksRefreshToken = state.sessionTasksRefreshToken + 1;
                    }
                    if (refreshHint?.codex) {
                        nextState.sessionCodexRefreshToken = state.sessionCodexRefreshToken + 1;
                    }
                    return nextState;
                });

                const shouldRefreshPossibleTasks = Boolean(refreshHint?.possible_tasks);
                const shouldRefreshSummary = Boolean(refreshHint?.summary);
                const shouldRefreshReview = Boolean(refreshHint?.tasks || refreshHint?.possible_tasks);
                if (activeSessionId && (!eventSessionId || eventSessionId === activeSessionId)) {
                    if (shouldRefreshPossibleTasks) {
                        const correlationId = typeof refreshHint?.correlation_id === 'string' && refreshHint.correlation_id.trim()
                            ? refreshHint.correlation_id.trim()
                            : null;
                        const clickedAtMs = typeof refreshHint?.clicked_at_ms === 'number' && Number.isFinite(refreshHint.clicked_at_ms)
                            ? refreshHint.clicked_at_ms
                            : null;

                        console.info('taskflow_refresh_received', {
                            session_id: activeSessionId,
                            reason: refreshHint?.reason || null,
                            correlation_id: correlationId,
                            clicked_at_ms: clickedAtMs,
                            e2e_from_click_ms: clickedAtMs !== null ? Date.now() - clickedAtMs : null,
                        });

                        if (consumePendingPossibleTasksRefreshCorrelation(activeSessionId, correlationId)) {
                            console.info('possible_tasks_refresh_skipped_self_echo', {
                                session_id: activeSessionId,
                                correlation_id: correlationId,
                            });
                        } else {
                            void get().fetchSessionPossibleTasks(activeSessionId, { silent: true })
                                .then((items) => {
                                    console.info('possible_tasks_refreshed', {
                                        session_id: activeSessionId,
                                        correlation_id: correlationId,
                                        clicked_at_ms: clickedAtMs,
                                        e2e_from_click_ms: clickedAtMs !== null ? Date.now() - clickedAtMs : null,
                                        items_count: items.length,
                                    });
                                })
                                .catch((error) => {
                                    console.error('Failed to refresh voice session possible tasks after realtime hint:', error);
                                });
                        }
                    }

                    if (shouldRefreshSummary || shouldRefreshReview) {
                        void get().getSessionData(activeSessionId)
                            .then((sessionData) => {
                                set((state) => {
                                    if (state.currentSessionId !== activeSessionId) {
                                        return state;
                                    }
                                    return {
                                        voiceBotSession: sessionData.voice_bot_session,
                                    };
                                });
                            })
                            .catch((error) => {
                                const target = shouldRefreshSummary ? 'summary/review' : 'review';
                                console.error(`Failed to refresh voice session ${target} after realtime hint:`, error);
                            });
                    }
                }
            });

            socket.on(
                'session_status',
                (data: { session_id?: string; status?: string; timestamp?: number }) => {
                    const eventSessionId = String(data?.session_id || '').trim();
                    const currentSessionId = String(get().currentSessionId || '').trim();
                    if (!eventSessionId || !currentSessionId || eventSessionId !== currentSessionId) return;

                    if (data?.status === 'done_queued') {
                        const doneAtIso = new Date(
                            Number.isFinite(data?.timestamp) ? Number(data.timestamp) : Date.now()
                        ).toISOString();
                        set((state) => ({
                            voiceBotSession: state.voiceBotSession
                                ? {
                                    ...state.voiceBotSession,
                                    is_active: false,
                                    to_finalize: true,
                                    done_at: doneAtIso,
                                    updated_at: doneAtIso,
                                }
                                : state.voiceBotSession,
                            voiceBotSessionsList: state.voiceBotSessionsList.map((session) =>
                                String(session._id || '').trim() === eventSessionId
                                    ? {
                                        ...session,
                                        is_active: false,
                                        to_finalize: true,
                                        done_at: doneAtIso,
                                        updated_at: doneAtIso,
                                    }
                                    : session
                            ),
                        }));
                    }
                }
            );

            set({ socket });
        }

        if (prevSessionId && prevSessionId !== sessionId && get().socket) {
            get().socket?.emit(SOCKET_EVENTS.UNSUBSCRIBE_FROM_SESSION, { session_id: prevSessionId });
        }
        get().socket?.emit(SOCKET_EVENTS.SUBSCRIBE_ON_SESSION, { session_id: sessionId });

        if (!get().performers_list) {
            void get().fetchPerformersList();
        }

        void get().fetchSessionPossibleTasks(sessionId, { silent: true }).catch((error) => {
            console.error('Failed to refresh draft tasks after loading session:', error);
        });
    },

    fetchActiveSession: async () => {
        try {
            const response = await voicebotHttp.request<Record<string, unknown>>('voicebot/active_session', {});
            const active = response?.active_session;
            if (active && typeof active === 'object') {
                return active as Record<string, unknown>;
            }
            return null;
        } catch (error) {
            console.error('Ошибка при получении active-session:', error);
            return null;
        }
    },

    activateSession: async (sessionId) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return false;
        const maxAttempts = 3;
        let blockedByInactiveSession = false;

        const isSessionInactiveConflict = (error: unknown): boolean => {
            if (!axios.isAxiosError(error)) return false;
            if (Number(error.response?.status) !== 409) return false;
            const responseData = error.response?.data as Record<string, unknown> | undefined;
            const responseError = String(responseData?.error || '').trim().toLowerCase();
            return responseError === 'session_inactive';
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await voicebotHttp.request('voicebot/activate_session', { session_id: normalizedSessionId });
                return true;
            } catch (error) {
                if (isSessionInactiveConflict(error)) {
                    blockedByInactiveSession = true;
                }
                const shouldRetry = attempt < maxAttempts && voicebotHttp.isTransientError(error);
                if (!shouldRetry) {
                    console.error('Ошибка при активации сессии:', error);
                    break;
                }
                const retryDelayMs = 250 * attempt;
                console.warn('Повтор активации сессии после сетевой ошибки', {
                    sessionId: normalizedSessionId,
                    attempt,
                    maxAttempts,
                    retryDelayMs,
                });
                await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
            }
        }

        if (blockedByInactiveSession) {
            console.warn('Локальный fallback активации отменен: сессия уже закрыта на сервере', {
                sessionId: normalizedSessionId,
            });
            return false;
        }

        const currentSessionId = String(get().voiceBotSession?._id || '').trim();
        if (currentSessionId && currentSessionId === normalizedSessionId) {
            console.warn('Локальный fallback активации: используем текущую открытую сессию', {
                sessionId: normalizedSessionId,
            });
            return true;
        }

        return false;
    },

    fetchSessionPossibleTasks: async (sessionId, options) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return [];

        try {
            const response = await voicebotHttp.request<unknown>(
                'voicebot/session_tasks',
                { session_id: normalizedSessionId, bucket: 'Draft' },
                Boolean(options?.silent)
            );
            const fallbackProjectId = String(get().voiceBotSession?.project_id || '').trim();
            const items = parsePossibleTasksResponse(response, fallbackProjectId);

            set((state) => {
                if (state.currentSessionId !== normalizedSessionId) return state;
                return {
                    possibleTasks: items,
                    possibleTasksLoadedAt: Date.now(),
                };
            });

            return items;
        } catch (error) {
            set((state) => {
                if (state.currentSessionId !== normalizedSessionId) return state;
                return {
                    possibleTasks: [],
                    possibleTasksLoadedAt: Date.now(),
                };
            });

            if (!options?.silent) {
                console.error('Ошибка при загрузке черновиков задач:', error);
                message.error('Не удалось загрузить черновики задач');
            }

            return [];
        }
    },

    saveSessionPossibleTasks: async (sessionId, tasks, options) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return [];

        const defaultProjectId = String(get().voiceBotSession?.project_id || '').trim();
        const normalizedTasks = parsePossibleTasksResponse(tasks, defaultProjectId);
        let canonicalTasks = normalizedTasks;
        registerPendingPossibleTasksRefreshCorrelation(normalizedSessionId, options?.refreshCorrelationId);

        try {
            const response = await voicebotHttp.request<unknown>(
                'voicebot/save_possible_tasks',
                {
                    session_id: normalizedSessionId,
                    tasks: normalizedTasks,
                    refresh_mode: options?.refreshMode ?? 'full_recompute',
                    refresh_correlation_id: options?.refreshCorrelationId,
                    refresh_clicked_at_ms: options?.refreshClickedAtMs,
                },
                Boolean(options?.silent)
            );
            const responseTasks = parsePossibleTasksResponse(response, defaultProjectId);
            if (responseTasks.length > 0) {
                canonicalTasks = responseTasks;
            }
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка при сохранении черновиков задач:', error);
                message.error('Не удалось сохранить черновики задач');
            }
            throw error;
        }

        set((state) => {
            if (state.currentSessionId !== normalizedSessionId) return state;
            return {
                possibleTasks: canonicalTasks,
                possibleTasksLoadedAt: Date.now(),
            };
        });

        return canonicalTasks;
    },

    createPossibleTasksForSession: async (sessionId, options) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) {
            throw new Error('session_id is required');
        }
        registerPendingPossibleTasksRefreshCorrelation(normalizedSessionId, options?.refreshCorrelationId);
        const response = await voicebotHttp.request<unknown>(
            'voicebot/generate_possible_tasks',
            {
                session_id: normalizedSessionId,
                refresh_correlation_id: options?.refreshCorrelationId,
                refresh_clicked_at_ms: options?.refreshClickedAtMs,
            }
        );
        const responseRecord =
            response && typeof response === 'object'
                ? response as Record<string, unknown>
                : null;
        const savedTasks = parsePossibleTasksResponse(
            responseRecord?.items ?? responseRecord,
            String(get().voiceBotSession?.project_id || '').trim()
        );

        set((state) => {
            if (state.currentSessionId !== normalizedSessionId) return state;
            const currentSession = state.voiceBotSession;
            const nextSession =
                currentSession && typeof currentSession === 'object'
                    ? {
                        ...currentSession,
                        ...(typeof responseRecord?.summary_md_text === 'string' && responseRecord.summary_md_text.trim()
                            ? { summary_md_text: responseRecord.summary_md_text.trim() }
                            : {}),
                        ...(typeof responseRecord?.review_md_text === 'string' && responseRecord.review_md_text.trim()
                            ? { review_md_text: responseRecord.review_md_text.trim() }
                            : {}),
                        ...(typeof responseRecord?.session_name === 'string' && responseRecord.session_name.trim()
                            ? { session_name: responseRecord.session_name.trim() }
                            : {}),
                        ...(typeof responseRecord?.project_id === 'string' && responseRecord.project_id.trim()
                            ? { project_id: responseRecord.project_id.trim() }
                            : {}),
                    }
                    : currentSession;
            return {
                voiceBotSession: nextSession,
                possibleTasks: savedTasks,
                possibleTasksLoadedAt: Date.now(),
            };
        });

        return {
            requestId: typeof responseRecord?.request_id === 'string' && responseRecord.request_id.trim()
                ? responseRecord.request_id.trim()
                : `backend:${normalizedSessionId}`,
            tasks: savedTasks,
        };
    },

    triggerSessionReadyToSummarize: async (sessionId) => {
        try {
            return await voicebotHttp.request<Record<string, unknown>>('voicebot/trigger_session_ready_to_summarize', {
                session_id: sessionId,
            });
        } catch (error) {
            const backendError = axios.isAxiosError(error)
                ? (error.response?.data as { error?: unknown } | undefined)?.error
                : null;
            const backendErrorText = typeof backendError === 'string' ? backendError : '';
            const fallbackError = error instanceof Error ? error.message : String(error);
            const errorText = backendErrorText || fallbackError || 'Не удалось запустить Summarize';
            console.error('Ошибка при ручном запуске Summarize:', error);
            throw new Error(errorText);
        }
    },

    saveSessionSummary: async (payload, options) => {
        try {
            const response = await voicebotHttp.request<{ summary?: { md_text?: string; updated_at?: string } }>(
                'voicebot/save_summary',
                payload,
                Boolean(options?.silent)
            );
            const savedText = typeof response?.summary?.md_text === 'string' ? response.summary.md_text : payload.md_text;
            const savedAt = typeof response?.summary?.updated_at === 'string'
                ? response.summary.updated_at
                : new Date().toISOString();

            set((state) => ({
                voiceBotSession: state.voiceBotSession
                    ? {
                        ...state.voiceBotSession,
                        summary_md_text: savedText,
                        summary_saved_at: savedAt,
                        updated_at: savedAt,
                    }
                    : state.voiceBotSession,
            }));

            return { md_text: savedText, updated_at: savedAt };
        } catch (error) {
            if (!options?.silent) {
                const backendError = axios.isAxiosError(error)
                    ? (error.response?.data as { error?: unknown } | undefined)?.error
                    : null;
                const backendErrorText = typeof backendError === 'string' ? backendError : '';
                const fallbackError = error instanceof Error ? error.message : '';
                const errorText = backendErrorText || fallbackError || 'Не удалось сохранить summary';
                console.error('Ошибка при сохранении summary:', error);
                message.error(errorText);
            }
            throw error;
        }
    },

    fetchSessionLog: async (sessionId, options) => {
        try {
            const response = await voicebotHttp.request<{ events?: VoiceSessionLogEvent[] }>('voicebot/session_log', { session_id: sessionId });
            const events = Array.isArray(response?.events) ? response.events : [];
            set({ sessionLogEvents: events });
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка при загрузке лога сессии:', error);
            }
            if (!options?.silent) {
                message.error('Не удалось загрузить лог сессии');
            }
            set({ sessionLogEvents: [] });
            throw error;
        }
    },

    fetchSessionCodexTasks: async (sessionId) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return [];
        const sessionSourceRefs = buildVoiceSessionTaskSourceRefs(normalizedSessionId, get().voiceBotSession);
        try {
            const response = await voicebotHttp.request<CodexTask[]>('voicebot/codex_tasks', {
                session_id: normalizedSessionId,
            });
            if (!Array.isArray(response)) return [];
            const filteredTasks = response.filter(
                (task) => ticketMatchesVoiceSessionSourceRefs(task, sessionSourceRefs)
            );
            return codexTaskTimeline.sortNewestFirst(filteredTasks);
        } catch (error) {
            console.error('Ошибка при загрузке Codex-задач сессии:', error);
            throw error;
        }
    },

    editTranscriptChunk: async (payload, options) => {
        const body = {
            session_id: payload.session_id,
            message_id: payload.message_id,
            segment_oid: payload.segment_oid,
            text: payload.new_text,
            reason: payload.reason,
        };
        try {
            await voicebotHttp.request('voicebot/edit_transcript_chunk', body, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка при изменении сегмента транскрипции:', error);
                message.error('Не удалось обновить сегмент');
            }
            throw error;
        }
    },

    editCategorizationChunk: async (payload, options) => {
        const body = {
            session_id: payload.session_id,
            message_id: payload.message_id,
            row_oid: payload.row_oid,
            new_text: payload.new_text,
            reason: payload.reason,
        };
        try {
            await voicebotHttp.request('voicebot/edit_categorization_chunk', body, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка при изменении строки категоризации:', error);
                message.error('Не удалось обновить строку категоризации');
            }
            throw error;
        }
    },

    deleteTranscriptChunk: async (payload, options) => {
        try {
            await voicebotHttp.request('voicebot/delete_transcript_chunk', payload, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка при удалении сегмента транскрипции:', error);
                message.error('Не удалось удалить сегмент');
            }
            throw error;
        }
    },

    deleteCategorizationChunk: async (payload, options) => {
        try {
            await voicebotHttp.request('voicebot/delete_categorization_chunk', payload, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка при удалении строки категоризации:', error);
                message.error('Не удалось удалить строку категоризации');
            }
            throw error;
        }
    },

    rollbackSessionEvent: async (payload, options) => {
        try {
            await voicebotHttp.request('voicebot/rollback_event', payload, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка rollback_event:', error);
                message.error('Rollback не выполнен');
            }
            throw error;
        }
    },

    resendNotifyEvent: async (payload, options) => {
        try {
            await voicebotHttp.request('voicebot/resend_notify_event', payload, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка resend_notify_event:', error);
                message.error('Resend не выполнен');
            }
            throw error;
        }
    },

    retryCategorizationEvent: async (payload, options) => {
        try {
            await voicebotHttp.request('voicebot/retry_categorization_event', payload, Boolean(options?.silent));
        } catch (error) {
            if (!options?.silent) {
                console.error('Ошибка retry_categorization_event:', error);
                message.error('Retry не выполнен');
            }
            throw error;
        }
    },

    getMessageDataById: (messageId) => {
        const { voiceBotMessages } = get();
        if (!Array.isArray(voiceBotMessages)) return null;
        return voiceBotMessages.find((msg) => msg._id === messageId || msg.message_id === messageId) ?? null;
    },

    updateSessionProject: async (sessionId, projectId) => {
        try {
            await voicebotHttp.request('voicebot/sessions/update_project', { session_id: sessionId, project_id: projectId });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, project_id: projectId } : state.voiceBotSession,
            }));
        } catch (e) {
            console.error('Ошибка при обновлении project_id сессии', e);
        }
    },

    finishSession: async (sessionId) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return;

        try {
            await voicebotHttp.request('voicebot/session_done', { session_id: normalizedSessionId });
            const doneAtIso = new Date().toISOString();
            set((state) => ({
                voiceBotSession:
                    state.voiceBotSession && String(state.voiceBotSession._id || '').trim() === normalizedSessionId
                        ? {
                            ...state.voiceBotSession,
                            is_active: false,
                            to_finalize: true,
                            done_at: doneAtIso,
                            updated_at: doneAtIso,
                        }
                        : state.voiceBotSession,
                voiceBotSessionsList: state.voiceBotSessionsList.map((session) =>
                    String(session._id || '').trim() === normalizedSessionId
                        ? {
                            ...session,
                            is_active: false,
                            to_finalize: true,
                            done_at: doneAtIso,
                            updated_at: doneAtIso,
                        }
                        : session
                ),
            }));
        } catch (error) {
            const axiosErrorData = axios.isAxiosError(error)
                ? (error.response?.data as Record<string, unknown> | undefined)
                : null;
            const backendError = typeof axiosErrorData?.error === 'string' ? axiosErrorData.error.trim() : '';
            const fallbackError = error instanceof Error ? error.message : '';
            const errorText = backendError || fallbackError;
            message.error(errorText ? `Done failed: ${errorText}` : 'Done failed');
            throw error;
        }
    },

    updateSessionAccessLevel: async (sessionId, accessLevel) => {
        try {
            await voicebotHttp.request('voicebot/sessions/update_access_level', { session_id: sessionId, access_level: accessLevel });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, access_level: accessLevel } : state.voiceBotSession,
            }));
        } catch (e) {
            console.error('Ошибка при обновлении уровня доступа сессии', e);
        }
    },

    restartCorruptedSession: async (sessionId) => {
        try {
            return await voicebotHttp.request('voicebot/restart_corrupted_session', { session_id: sessionId });
        } catch (e) {
            console.error('Ошибка при перезапуске поломанной сессии', e);
            throw e;
        }
    },

    setHighlightedMessageId: (messageId) => {
        set({ highlightedMessageId: messageId });
    },

    getSessionData: async (sessionId) => {
        try {
            const response = await voicebotHttp.request('voicebot/sessions/get', { session_id: sessionId });
            return normalizeSessionResponse(response);
        } catch (error) {
            console.error('Ошибка при получении данных сессии:', error);
            throw error;
        }
    },

    fetchVoiceBotSessionsList: async (options) => {
        const includeDeleted = options?.includeDeleted === true;
        const { force = false } = options ?? {};
        const { isSessionsListLoading } = get();
        if (isSessionsListLoading && !force) return;

        set({ isSessionsListLoading: true });
        try {
            const response = await voicebotHttp.request<VoiceBotSession[]>('voicebot/sessions/list', {
                include_deleted: includeDeleted,
            });
            if (response && Array.isArray(response)) {
                const sorted = [...response].sort(compareSessionsListOrder);
                set({
                    voiceBotSessionsList: sorted,
                    sessionsListLoadedAt: Date.now(),
                    sessionsListIncludeDeleted: includeDeleted,
                });
            } else {
                console.error('Ошибка при получении списка сессий:', response);
                set({ voiceBotSessionsList: [], sessionsListIncludeDeleted: includeDeleted });
            }
        } catch (error) {
            console.error('Ошибка при получении списка сессий:', error);
            set({ voiceBotSessionsList: [], sessionsListIncludeDeleted: includeDeleted });
        } finally {
            set({ isSessionsListLoading: false });
        }
    },

    postProcessSession: async (sessionId) => {
        try {
            const socket = get().socket;
            if (socket && sessionId) {
                socket.emit(SOCKET_EVENTS.POST_PROCESS_SESSION, { session_id: sessionId });
            }
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, is_postprocessing: true } : state.voiceBotSession,
            }));
        } catch (e) {
            console.error('Ошибка при постобработке сессии', e);
        }
    },

    createTasksFromChunks: async (sessionId, chunks) => {
        try {
            const socket = get().socket;
            if (!socket || !sessionId || !chunks || chunks.length === 0) return;

            await new Promise<void>((resolve, reject) => {
                socket.emit(
                    SOCKET_EVENTS.CREATE_TASKS_FROM_CHUNKS,
                    { session_id: sessionId, chunks_to_process: chunks },
                    (response?: { ok?: boolean; error?: string }) => {
                        if (response?.ok) {
                            resolve();
                            return;
                        }
                        reject(new Error(String(response?.error || 'internal_error')));
                    }
                );
            });
        } catch (e) {
            console.error('Ошибка при создании задач из chunks:', e);
            throw e;
        }
    },

    createTasksFromRows: async (sessionId, rows) => {
        if (!sessionId || rows.length === 0) return;
        const chunks_to_process = rows.map((row) => ({ text: row.text || '' }));
        await get().createTasksFromChunks(sessionId, chunks_to_process);
    },

    fetchTaskTypes: async () => {
        try {
            const data = await voicebotHttp.request<TaskTypeNode[]>('voicebot/task_types');
            if (data && Array.isArray(data)) {
                set({ task_types: data });
                return data;
            }
            console.error('Ошибка при получении типов задач:', data);
            return [];
        } catch (e) {
            console.error('Ошибка при получении типов задач:', e);
            return [];
        }
    },

    fetchPreparedProjects: async () => {
        try {
            const data = await voicebotHttp.request<VoiceBotProject[]>('voicebot/projects');
            if (data && Array.isArray(data)) {
                set({ prepared_projects: data });
            } else {
                console.error('Ошибка при получении подготовленных проектов:', data);
                set({ prepared_projects: [] });
            }
        } catch (error) {
            console.error('Ошибка при получении подготовленных проектов:', error);
            set({ prepared_projects: [] });
        }
    },

    fetchPersonsList: async () => {
        try {
            const data = await voicebotHttp.request<VoicebotPerson[]>('voicebot/persons/list');
            if (data && Array.isArray(data)) {
                set({ persons_list: data });
                return data;
            }
            console.error('Ошибка при получении списка персон:', data);
            set({ persons_list: [] });
            return [];
        } catch (e) {
            console.error('Ошибка при получении списка персон:', e);
            set({ persons_list: [] });
            return [];
        }
    },

    createPerson: async (personData) => {
        try {
            const response = await voicebotHttp.request<VoicebotPerson>('voicebot/persons/create', personData);
            await get().fetchPersonsList();
            return response;
        } catch (e) {
            console.error('Ошибка при создании персоны:', e);
            throw e;
        }
    },

    updateSessionParticipants: async (sessionId, participantIds) => {
        try {
            await voicebotHttp.request('voicebot/sessions/update_participants', { session_id: sessionId, participant_ids: participantIds });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, participants: participantIds } : state.voiceBotSession,
            }));
            return true;
        } catch (e) {
            console.error('Ошибка при обновлении участников сессии:', e);
            throw e;
        }
    },

    uploadAudioFile: async (file, sessionId, opt) => {
        try {
            const backendUrl = voicebotRuntimeConfig.getBackendUrl();
            const { authToken } = useAuthStore.getState();
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('session_id', sessionId);

            const requestConfig: AxiosRequestConfig<FormData> = {
                headers: {
                    'X-Authorization': authToken ?? '',
                },
                withCredentials: true,
            };

            // Byte-level progress for large uploads (UI)
            if (opt?.onUploadProgress) {
                requestConfig.onUploadProgress = opt.onUploadProgress;
            }

            const response = await axios.post(`${backendUrl}/voicebot/uploads/audio`, formData, requestConfig);
            return response.data;
        } catch (e) {
            console.error('Ошибка при загрузке аудио файла:', e);
            throw e;
        }
    },

    uploadSessionImageAttachment: async (file, sessionId) => {
        try {
            const backendUrl = voicebotRuntimeConfig.getBackendUrl();
            const { authToken } = useAuthStore.getState();
            const formData = new FormData();
            formData.append('attachment', file);
            formData.append('session_id', sessionId);

            const response = await axios.post(`${backendUrl}/voicebot/upload_attachment`, formData, {
                headers: {
                    'X-Authorization': authToken ?? '',
                },
                withCredentials: true,
            });

            const attachment = (response.data as { attachment?: Record<string, unknown> })?.attachment;
            if (!attachment || typeof attachment !== 'object') {
                throw new Error('Upload attachment response is missing attachment payload');
            }
            return attachment;
        } catch (e) {
            console.error('Ошибка при загрузке изображения в сессию:', e);
            throw e;
        }
    },

    addSessionTextChunk: async (sessionId, text) => {
        const normalizedSessionId = String(sessionId || '').trim();
        const normalizedText = String(text || '').trim();
        if (!normalizedSessionId || !normalizedText) return;

        try {
            await voicebotHttp.request('voicebot/add_text', {
                session_id: normalizedSessionId,
                text: normalizedText,
            });
            await get().fetchVoiceBotSession(normalizedSessionId);
        } catch (e) {
            console.error('Ошибка при добавлении текстового чанка:', e);
            throw e;
        }
    },

    addSessionImageChunk: async (sessionId, payload) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return;
        const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl.trim() : '';
        if (!dataUrl) return;
        const targetMessageId = typeof payload?.targetMessageId === 'string'
            ? payload.targetMessageId.trim()
            : '';

        const mimeType = typeof payload?.mimeType === 'string' && payload.mimeType.trim()
            ? payload.mimeType.trim()
            : 'image/png';
        const name = typeof payload?.name === 'string' && payload.name.trim()
            ? payload.name.trim()
            : `pasted-${Date.now()}.png`;
        const caption = typeof payload?.caption === 'string' ? payload.caption.trim() : '';
        const fallbackText = caption || '[Image]';

        try {
            const blobResponse = await fetch(dataUrl);
            const blob = await blobResponse.blob();
            const uploadMimeType = blob.type || mimeType;
            const uploadFile = new File([blob], name, { type: uploadMimeType });
            const uploadedAttachment = await get().uploadSessionImageAttachment(uploadFile, normalizedSessionId);

            await voicebotHttp.request('voicebot/add_text', {
                session_id: normalizedSessionId,
                text: fallbackText,
                kind: 'image',
                ...(targetMessageId ? { image_anchor_linked_message_id: targetMessageId } : {}),
                attachments: [
                    {
                        ...uploadedAttachment,
                        kind: 'image',
                        source: 'web',
                        name,
                        mime_type: uploadMimeType,
                        size: payload?.size ?? blob.size ?? null,
                        caption: caption || null,
                    },
                ],
            });
            await get().fetchVoiceBotSession(normalizedSessionId);
        } catch (e) {
            console.error('Ошибка при добавлении изображения в сессию:', e);
            throw e;
        }
    },

    updateSessionAllowedUsers: async (sessionId, allowedUserIds) => {
        try {
            await voicebotHttp.request('voicebot/sessions/update_allowed_users', {
                session_id: sessionId,
                allowed_user_ids: allowedUserIds,
            });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, allowed_users: allowedUserIds } : state.voiceBotSession,
            }));
            return true;
        } catch (e) {
            console.error('Ошибка при обновлении списка пользователей с доступом:', e);
            throw e;
        }
    },

    fetchPerformersList: async (includeIds = []) => {
        try {
            const normalizedIncludeIds = voicebotRuntimeConfig.normalizeIncludeIds(includeIds);
            const payload = normalizedIncludeIds.length > 0
                ? { include_ids: normalizedIncludeIds }
                : {};
            const data = await voicebotHttp.request<Array<Record<string, unknown>>>('voicebot/auth/list-users', payload);
            if (data && Array.isArray(data)) {
                set({ performers_list: data });
                return data;
            }
            console.error('Ошибка при получении списка пользователей:', data);
            return [];
        } catch (e) {
            console.error('Ошибка при получении списка пользователей:', e);
            return [];
        }
    },

    fetchPerformersForTasksList: async (includeIds = []) => {
        try {
            const normalizedIncludeIds = voicebotRuntimeConfig.normalizeIncludeIds(includeIds);
            const payload = normalizedIncludeIds.length > 0
                ? { include_ids: normalizedIncludeIds }
                : {};
            const data = await voicebotHttp.request<Array<Record<string, unknown>>>('voicebot/persons/list_performers', payload);
            if (data && Array.isArray(data)) {
                const performersWithCodex = ensureCodexPerformerRecords(data);
                set({ performers_for_tasks_list: performersWithCodex });
                return performersWithCodex;
            }
            console.error('Ошибка при получении списка исполнителей:', data);
            return [];
        } catch (e) {
            console.error('Ошибка при получении списка исполнителей:', e);
            return [];
        }
    },

    confirmSelectedTickets: async (selectedTicketIds, updatedTickets = null) => {
        try {
            const { ticketsModal } = useSessionsUIStore.getState();
            const { prepared_projects } = get();
            const ticketsSource = updatedTickets || ticketsModal.tickets;
            const selectedTicketIdSet = new Set(selectedTicketIds.map((value) => String(value || '').trim()).filter(Boolean));
            const selectedTickets = ticketsSource
                ? ticketsSource.filter((ticket) => {
                    const locators = collectPossibleTaskLocators(ticket);
                    return locators.some((locator) => selectedTicketIdSet.has(locator));
                })
                : [];

            const preparedTickets: Array<Record<string, unknown>> = selectedTickets.map((ticket) => ({
                ...ticket,
                project: (() => {
                    const project = prepared_projects?.find((p) => p._id === ticket.project_id);
                    return project?.name || project?.title || null;
                })(),
            }));

            console.info('[voice.possible_tasks] process_possible_tasks.request', {
                sessionId: get().currentSessionId,
                selectedRowIds: selectedTicketIds,
                selectedCount: selectedTicketIds.length,
                payload: preparedTickets.map((ticket) => ({
                    row_id: String(ticket.row_id || ticket.id || '').trim(),
                    performer_id: String(ticket.performer_id || '').trim(),
                    project_id: String(ticket.project_id || '').trim(),
                    priority: String(ticket.priority || '').trim(),
                })),
            });

            const response = await voicebotHttp.request<Record<string, unknown>>(
                'voicebot/process_possible_tasks',
                {
                    tickets: preparedTickets,
                    session_id: get().currentSessionId,
                }
            );
            const createdTaskIds = Array.isArray(response?.created_task_ids)
                ? response.created_task_ids
                    .map((value) => (typeof value === 'string' ? value.trim() : ''))
                    .filter(Boolean)
                : [];
            const removedRowIds = createdTaskIds;
            const rowErrors = extractVoiceTaskCreateRowErrors(response);

            console.info('[voice.possible_tasks] process_possible_tasks.response', {
                sessionId: get().currentSessionId,
                operationStatus: String(response?.operation_status || ''),
                createdTaskIds,
                removedRowIds,
                rowErrorsCount: rowErrors.length,
            });

            if (createdTaskIds.length > 0) {
                set((state) => {
                    return {
                        ...state,
                        possibleTasks: filterPossibleTasksByLocators(state.possibleTasks, removedRowIds),
                        possibleTasksLoadedAt: Date.now(),
                    };
                });
                message.success(`Создано ${createdTaskIds.length} задач`);
            }

            if (rowErrors.length > 0) {
                const backendError = extractVoiceTaskCreateErrorText(response) || 'Не удалось создать задачи';
                throw new VoiceTaskCreateValidationError(backendError, rowErrors);
            }

            useSessionsUIStore.getState().closeTicketsModal();
            return { createdTaskIds, removedRowIds, rowErrors: [] };
        } catch (e) {
            if (isVoiceTaskCreateValidationError(e)) {
                throw e;
            }
            const backendPayload = axios.isAxiosError(e)
                ? (e.response?.data as unknown)
                : null;
            const rowErrors = extractVoiceTaskCreateRowErrors(backendPayload);
            console.error('[voice.possible_tasks] process_possible_tasks.failed', {
                sessionId: get().currentSessionId,
                selectedRowIds: selectedTicketIds,
                backendPayload,
                rowErrorsCount: rowErrors.length,
                error: e,
            });
            if (rowErrors.length > 0) {
                const backendError = extractVoiceTaskCreateErrorText(backendPayload) || 'Не удалось создать задачи';
                throw new VoiceTaskCreateValidationError(backendError, rowErrors);
            }
            console.error('Ошибка при создании задач:', e);
            message.error('Ошибка при создании задач');
            throw e;
        }
    },

    rejectAllTickets: () => {
        message.info('Создание задач отменено');
        useSessionsUIStore.getState().closeTicketsModal();
    },

    deleteTaskFromSession: async (taskId) => {
        try {
            const sessionId = get().currentSessionId;
            if (!sessionId) {
                message.error('Сессия не выбрана');
                return false;
            }

            await voicebotHttp.request('voicebot/delete_task_from_session', { session_id: sessionId, row_id: taskId });

            set((state) => {
                return {
                    ...state,
                    possibleTasks: filterPossibleTasksByLocators(state.possibleTasks, [taskId]),
                    possibleTasksLoadedAt: Date.now(),
                };
            });

            message.success('Задача удалена');
            return true;
        } catch (e) {
            console.error('Ошибка при удалении задачи:', e);
            message.error('Ошибка при удалении задачи');
            return false;
        }
    },

    deleteSession: async (sessionId) => {
        try {
            await voicebotHttp.request('voicebot/sessions/delete', { session_id: sessionId }, true);
            const includeDeleted = get().sessionsListIncludeDeleted === true;
            await get().fetchVoiceBotSessionsList({ force: true, includeDeleted });
            return true;
        } catch (e) {
            console.error('Ошибка при удалении сессии:', e);
            throw e;
        }
    },

    mergeSessions: async ({ sessionIds, targetSessionId, confirmationPhrase, operationId }) => {
        try {
            const response = await voicebotHttp.request<Record<string, unknown>>('voicebot/sessions/merge', {
                session_ids: sessionIds,
                target_session_id: targetSessionId,
                confirmation_phrase: confirmationPhrase,
                operation_id: operationId,
            }, true);
            const includeDeleted = get().sessionsListIncludeDeleted === true;
            await get().fetchVoiceBotSessionsList({ force: true, includeDeleted });
            return response;
        } catch (error) {
            console.error('Ошибка при слиянии сессий:', error);
            throw error;
        }
    },

    downloadTranscription: async (sessionId) => {
        try {
            const backendUrl = voicebotRuntimeConfig.getBackendUrl();
            const { authToken } = useAuthStore.getState();
            const response = await fetch(`${backendUrl}/voicebot/transcription/download/${sessionId}`, {
                method: 'GET',
                headers: {
                    'X-Authorization': authToken ?? '',
                },
            });

            if (!response.ok) {
                throw new Error('Ошибка при скачивании транскрипции');
            }

            const contentDisposition = response.headers.get('content-disposition');
            let filename = 'transcription.md';
            if (contentDisposition) {
                const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;,\s]+)/);
                if (utf8Match && utf8Match[1]) {
                    filename = decodeURIComponent(utf8Match[1]);
                } else {
                    const standardMatch = contentDisposition.match(/filename="([^"]+)"/);
                    if (standardMatch && standardMatch[1]) {
                        filename = standardMatch[1];
                    } else {
                        const altMatch = contentDisposition.match(/filename=([^;,\s]+)/);
                        if (altMatch && altMatch[1]) {
                            filename = altMatch[1].trim();
                        }
                    }
                }
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            message.success('Транскрипция успешно скачана');
        } catch (error) {
            console.error('Error downloading transcription:', error);
            message.error('Ошибка при скачивании транскрипции');
        }
    },

    fetchProjectTopics: async (projectId, sessionId = null) => {
        try {
            const requestData: Record<string, unknown> = { project_id: projectId };
            if (sessionId) requestData.session_id = sessionId;
            return await voicebotHttp.request('voicebot/topics', requestData);
        } catch (error) {
            console.error('Ошибка при получении топиков:', error);
            throw error;
        }
    },

    runCustomPrompt: async (prompt, input, model = 'gpt-5', sessionId = null, inputType = 'categorization') => {
        try {
            const response = await voicebotHttp.request<Record<string, unknown>>('voicebot/LLMGate/run_prompt', {
                prompt,
                input,
                model,
                store: false,
                session_id: sessionId,
            });

            if (!response) {
                throw new Error('Не удалось получить ответ от сервера');
            }

            if ((response as { success?: boolean; error?: string }).success === false) {
                throw new Error((response as { error?: string }).error || 'Ошибка при выполнении промпта');
            }

            if (sessionId && (response as { success?: boolean }).success) {
                try {
                    await voicebotHttp.request('voicebot/save_custom_prompt_result', {
                        session_id: sessionId,
                        prompt,
                        input_type: inputType,
                        result: response,
                    });
                } catch (saveError) {
                    console.error('Ошибка при сохранении результата промпта:', saveError);
                }
            }

            return response;
        } catch (error) {
            console.error('Ошибка при запуске промпта:', error);
            throw error;
        }
    },
}));
