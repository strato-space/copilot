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
    VoiceBotSession,
    VoiceMessageGroup,
    VoiceMessageRow,
    TaskTypeNode,
    VoiceBotProject,
    VoicebotPerson,
    CreateTaskChunk,
    VoiceBotSessionResponse,
    VoiceSessionAttachment,
    VoiceSessionLogEvent,
    CodexTask,
} from '../types/voice';
import { getVoicebotSocket, SOCKET_EVENTS } from '../services/socket';
import { normalizeTimelineRangeSeconds } from '../utils/voiceTimeline';
import { ensureCodexPerformerRecords } from '../utils/codexPerformer';
import {
    buildVoiceSessionTaskSourceRefs,
    normalizeVoiceSessionSourceRefs,
    ticketMatchesVoiceSessionSourceRefs,
} from '../utils/voiceSessionTaskSource';
import {
    extractVoiceTaskCreateErrorText,
    extractVoiceTaskCreateRowErrors,
    VoiceTaskCreateValidationError,
} from '../utils/voiceTaskCreation';
import { voicebotRuntimeConfig } from './voicebotRuntimeConfig';
import { voicebotHttp } from './voicebotHttp';
import { codexTaskTimeline } from './codexTaskTimeline';

export {
    buildVoiceSessionTaskSourceRefs,
    normalizeVoiceSessionSourceRefs,
    ticketMatchesVoiceSessionSourceRefs,
};

interface VoiceBotSessionDataSlice {
    currentSessionId: string | null;
    voiceBotSession: VoiceBotSession | null;
    voiceBotMessages: VoiceBotMessage[];
    voiceMesagesData: VoiceMessageGroup[];
    sessionAttachments: VoiceSessionAttachment[];
    sessionLogEvents: VoiceSessionLogEvent[];
    highlightedMessageId: string | null;
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
    finishSession: (sessionId: string) => void;
    updateSessionAccessLevel: (sessionId: string, accessLevel: string) => Promise<void>;
    restartCorruptedSession: (sessionId: string) => Promise<unknown>;
    setHighlightedMessageId: (messageId: string | null) => void;
    getSessionData: (sessionId: string) => Promise<VoiceBotSessionResponse>;
}

interface VoiceBotSessionProcessingActionsSlice {
    sendSessionToCrm: (sessionId: string) => Promise<boolean>;
    sendSessionToCrmWithMcp: (sessionId: string) => Promise<void>;
    triggerSessionReadyToSummarize: (sessionId: string) => Promise<Record<string, unknown>>;
    fetchSessionLog: (sessionId: string, options?: { silent?: boolean }) => Promise<void>;
    fetchSessionCodexTasks: (sessionId: string) => Promise<CodexTask[]>;
    editTranscriptChunk: (
        payload: { session_id: string; message_id: string; segment_oid: string; new_text: string; reason?: string },
        options?: { silent?: boolean }
    ) => Promise<void>;
    deleteTranscriptChunk: (
        payload: { session_id: string; message_id: string; segment_oid: string; reason?: string },
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
    createTasksFromChunks: (sessionId: string, chunks: CreateTaskChunk[]) => void;
    createTasksFromRows: (sessionId: string, rows: Array<{ text?: string }>) => void;
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
    confirmSelectedTickets: (selectedTicketIds: string[], updatedTickets?: Array<Record<string, unknown>> | null) => Promise<boolean>;
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

const buildTranscriptionText = (messages: VoiceBotMessage[]): string => {
    const lines = messages
        .map((msg) => {
            const rawText = typeof msg.transcription_text === 'string' ? msg.transcription_text.trim() : '';
            if (rawText) return rawText;
            if (Array.isArray(msg.categorization)) {
                const chunks = msg.categorization
                    .map((chunk) => (typeof chunk.text === 'string' ? chunk.text.trim() : ''))
                    .filter(Boolean);
                if (chunks.length > 0) return chunks.join(' ');
            }
            return '';
        })
        .filter(Boolean);
    return lines.join('\n');
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
        const ownImageRows = voiceMessageLinkUtils.getRowsByMessageRefs(imageRowsByMessageRef, messageRefs);
        const record = voiceMessageLinkUtils.getMessageRecord(msg);
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

        const categorizationRows: VoiceMessageRow[] = (msg.categorization || []).map((cat) => {
            const { startSeconds, endSeconds } = normalizeTimelineRangeSeconds(cat.start, cat.end);
            let avatar = 'U';
            const speaker = typeof cat.speaker === 'string' ? cat.speaker : '';
            if (speaker && speaker !== 'Unknown' && speaker.length > 0) {
                avatar = speaker[0]?.toUpperCase() ?? 'U';
            }
            return {
                timeStart: startSeconds,
                timeEnd: endSeconds,
                avatar,
                name: cat.speaker,
                text: typeof cat.text === 'string' ? cat.text.trim() : '',
                kind: 'categorization' as const,
                goal: cat.related_goal || '',
                patt: cat.new_pattern_detected || '',
                flag: cat.quality_flag || '',
                keywords: cat.topic_keywords || '',
                message_id: primaryMessageRef || undefined,
            };
        }).filter((row) => typeof row.text === 'string' && row.text.trim().length > 0);

        let rows: VoiceMessageRow[] = categorizationRows;
        if (rows.length === 0) {
            if (ownImageRows.length > 0) {
                rows = ownImageRows;
            } else {
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
                            message_id: primaryMessageRef || undefined,
                        },
                    ];
                }
            }
        } else if (ownImageRows.length > 0) {
            rows = [...ownImageRows, ...rows];
        }

        if (linkedAnchorRows.length > 0) {
            rows = [...linkedAnchorRows, ...rows];
        }
        if (explicitLinkedRows.length > 0) {
            rows = [...explicitLinkedRows, ...rows];
        }

        const explicitAnchorMessageId = explicitLinkedEntries[0]?.anchorMessageRef ?? '';
        const materialAnchorMessageId = imageAnchorRef || explicitAnchorMessageId || (ownImageRows.length > 0 ? primaryMessageRef : '');
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
        }

        return [
            {
                message_id: primaryMessageRef || undefined,
                message_timestamp: msg.message_timestamp,
                material_group_id: materialGroupId || undefined,
                material_anchor_message_id: materialAnchorMessageId || undefined,
                material_target_message_id: materialTargetMessageId || undefined,
                original_message: msg,
                rows,
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

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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
    const rawMessages = (data.session_messages as VoiceBotMessage[]) || [];
    const messages = rawMessages.filter((msg) => !voiceMessageLinkUtils.isMessageDeleted(msg));
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
    sessionLogEvents: [],
    socketToken: null,
    socketPort: null,
    socket: null,
    highlightedMessageId: null,
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
            sessionLogEvents: [],
            socketToken: normalized.socket_token ?? null,
            socketPort: normalized.socket_port ?? null,
            currentSessionId: sessionId,
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
                set((state) => {
                    const updatedMessages = messageListUtils.upsert(state.voiceBotMessages, data.message as VoiceBotMessage);
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups(updatedMessages);
                    const updatedAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                    return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments: updatedAttachments };
                });
            });

            socket.on('new_message', (data: VoiceBotMessage) => {
                const existingMessage = get().voiceBotMessages.find(
                    (msg) => msg._id === data.message_id || msg._id === data._id
                );
                if (existingMessage) return;

                set((state) => {
                    const updatedMessages = messageListUtils.upsert(state.voiceBotMessages, data);
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups(updatedMessages);
                    const updatedAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                    return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments: updatedAttachments };
                });
            });

            socket.on('session_update', (data: Partial<VoiceBotSession>) => {
                set((state) => ({
                    voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, ...data } : state.voiceBotSession,
                }));
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

            socket.on('tickets_prepared', (data: Record<string, unknown>) => {
                const { openTicketsModal } = useSessionsUIStore.getState();
                openTicketsModal(data as { tickets?: Array<Record<string, unknown>> });
            });

            set({ socket });
        }

        if (prevSessionId && prevSessionId !== sessionId && get().socket) {
            get().socket?.emit(SOCKET_EVENTS.UNSUBSCRIBE_FROM_SESSION, { session_id: prevSessionId });
        }
        get().socket?.emit(SOCKET_EVENTS.SUBSCRIBE_ON_SESSION, { session_id: sessionId });

        if (!get().performers_list) {
            void get().fetchPerformersList();
        }
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

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await voicebotHttp.request('voicebot/activate_session', { session_id: normalizedSessionId });
                return true;
            } catch (error) {
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

        const currentSessionId = String(get().voiceBotSession?._id || '').trim();
        if (currentSessionId && currentSessionId === normalizedSessionId) {
            console.warn('Локальный fallback активации: используем текущую открытую сессию', {
                sessionId: normalizedSessionId,
            });
            return true;
        }

        return false;
    },

    triggerSessionReadyToSummarize: async (sessionId) => {
        try {
            return await voicebotHttp.request<Record<string, unknown>>('voicebot/trigger_session_ready_to_summarize', {
                session_id: sessionId,
            });
        } catch (error) {
            console.error('Ошибка при ручном запуске Summarize:', error);
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

    finishSession: (sessionId) => {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId) return;

        void (async () => {
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
            }
        })();
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
        const { isSessionsListLoading, sessionsListIncludeDeleted } = get();
        if (isSessionsListLoading && !force) return;

        set({ isSessionsListLoading: true });
        try {
            const response = await voicebotHttp.request<VoiceBotSession[]>('voicebot/sessions/list', {
                include_deleted: includeDeleted,
            });
            if (response && Array.isArray(response)) {
                const sorted = [...response].sort((a, b) => {
                    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
                    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                    return bTime - aTime;
                });
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

    createTasksFromChunks: (sessionId, chunks) => {
        try {
            const socket = get().socket;
            if (socket && sessionId && chunks && chunks.length > 0) {
                socket.emit(SOCKET_EVENTS.CREATE_TASKS_FROM_CHUNKS, { session_id: sessionId, chunks_to_process: chunks });
            }
        } catch (e) {
            console.error('Ошибка при создании задач из chunks:', e);
        }
    },

    createTasksFromRows: (sessionId, rows) => {
        if (!sessionId || rows.length === 0) return;
        const chunks_to_process = rows.map((row) => ({ text: row.text || '' }));
        get().createTasksFromChunks(sessionId, chunks_to_process);
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
            const selectedTickets = ticketsSource ? ticketsSource.filter((ticket) => selectedTicketIds.includes(ticket.id as string)) : [];

            const preparedTickets = selectedTickets.map((ticket) => ({
                ...ticket,
                project: (() => {
                    const project = prepared_projects?.find((p) => p._id === ticket.project_id);
                    return project?.name || project?.title || null;
                })(),
            }));

            await voicebotHttp.request('voicebot/create_tickets', { tickets: preparedTickets, session_id: get().currentSessionId });
            message.success(`Создано ${selectedTicketIds.length} задач`);
            useSessionsUIStore.getState().closeTicketsModal();
            return true;
        } catch (e) {
            const backendPayload = axios.isAxiosError(e)
                ? (e.response?.data as unknown)
                : null;
            const rowErrors = extractVoiceTaskCreateRowErrors(backendPayload);
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

            await voicebotHttp.request('voicebot/delete_task_from_session', { session_id: sessionId, task_id: taskId });

            set((state) => {
                if (!state.voiceBotSession) {
                    return state;
                }
                const processorsData = state.voiceBotSession.processors_data as Record<string, unknown> | undefined;
                const createTasks = processorsData?.CREATE_TASKS as
                    | { data?: Array<Record<string, unknown>> }
                    | undefined;
                if (!createTasks?.data) {
                    return state;
                }
                return {
                    ...state,
                    voiceBotSession: {
                        ...state.voiceBotSession,
                        processors_data: {
                            ...processorsData,
                            CREATE_TASKS: {
                                ...createTasks,
                                data: createTasks.data.filter((task) => {
                                    const byId = typeof task.id === 'string' ? task.id : '';
                                    const byAiId = typeof task.task_id_from_ai === 'string' ? task.task_id_from_ai : '';
                                    const byLegacyAiId = typeof task['Task ID'] === 'string' ? task['Task ID'] : '';
                                    return byId !== taskId && byAiId !== taskId && byLegacyAiId !== taskId;
                                }),
                            },
                        },
                    },
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
