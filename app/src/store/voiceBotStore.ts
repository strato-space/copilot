import axios from 'axios';
import { create } from 'zustand';
import update from 'immutability-helper';
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
    TaskTypeNode,
    VoiceBotProject,
    VoicebotPerson,
    CreateTaskChunk,
    VoiceBotSessionResponse,
    VoiceSessionAttachment,
    VoiceSessionLogEvent,
} from '../types/voice';
import { getVoicebotSocket, SOCKET_EVENTS } from '../services/socket';

interface VoiceBotState {
    currentSessionId: string | null;
    voiceBotSession: VoiceBotSession | null;
    voiceBotMessages: VoiceBotMessage[];
    voiceMesagesData: VoiceMessageGroup[];
    sessionAttachments: VoiceSessionAttachment[];
    sessionLogEvents: VoiceSessionLogEvent[];
    socketToken: string | null;
    socketPort: number | null;
    socket: Socket | null;
    highlightedMessageId: string | null;
    task_types: TaskTypeNode[] | null;
    voiceBotSessionsList: VoiceBotSession[];
    prepared_projects: VoiceBotProject[] | null;
    persons_list: VoicebotPerson[] | null;
    performers_list: Array<Record<string, unknown>> | null;
    performers_for_tasks_list: Array<Record<string, unknown>> | null;
    isSessionsListLoading: boolean;
    sessionsListLoadedAt: number | null;

    updateSessionName: (sessionId: string, newName: string) => Promise<void>;
    updateSessionDialogueTag: (sessionId: string, dialogueTag: string) => Promise<void>;
    sendSessionToCrm: (sessionId: string) => Promise<boolean>;
    sendSessionToCrmWithMcp: (sessionId: string) => Promise<void>;
    fetchVoiceBotSession: (sessionId: string) => Promise<void>;
    fetchActiveSession: () => Promise<Record<string, unknown> | null>;
    activateSession: (sessionId: string) => Promise<boolean>;
    fetchSessionLog: (sessionId: string, options?: { silent?: boolean }) => Promise<void>;
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
    updateSessionProject: (sessionId: string, projectId: string | null) => Promise<void>;
    finishSession: (sessionId: string) => void;
    updateSessionAccessLevel: (sessionId: string, accessLevel: string) => Promise<void>;
    restartCorruptedSession: (sessionId: string) => Promise<unknown>;
    setHighlightedMessageId: (messageId: string | null) => void;
    getSessionData: (sessionId: string) => Promise<VoiceBotSessionResponse>;
    fetchVoiceBotSessionsList: (options?: { force?: boolean }) => Promise<void>;
    postProcessSession: (sessionId: string) => Promise<void>;
    createTasksFromChunks: (sessionId: string, chunks: CreateTaskChunk[]) => void;
    createTasksFromRows: (sessionId: string, rows: Array<{ text?: string }>) => void;
    fetchTaskTypes: () => Promise<TaskTypeNode[]>;
    fetchPreparedProjects: () => Promise<void>;
    fetchPersonsList: () => Promise<VoicebotPerson[]>;
    createPerson: (personData: Record<string, unknown>) => Promise<VoicebotPerson>;
    updateSessionParticipants: (sessionId: string, participantIds: string[]) => Promise<boolean>;
    uploadAudioFile: (file: File, sessionId: string) => Promise<unknown>;
    updateSessionAllowedUsers: (sessionId: string, allowedUserIds: string[]) => Promise<boolean>;
    fetchPerformersList: () => Promise<Array<Record<string, unknown>>>;
    fetchPerformersForTasksList: () => Promise<Array<Record<string, unknown>>>;
    confirmSelectedTickets: (selectedTicketIds: string[], updatedTickets?: Array<Record<string, unknown>> | null) => Promise<boolean>;
    rejectAllTickets: () => void;
    deleteTaskFromSession: (taskId: string) => Promise<boolean>;
    deleteSession: (sessionId: string) => Promise<boolean>;
    downloadTranscription: (sessionId: string) => Promise<void>;
    fetchProjectTopics: (projectId: string, sessionId?: string | null) => Promise<unknown>;
    runCustomPrompt: (
        prompt: string,
        input: unknown,
        model?: string,
        sessionId?: string | null,
        inputType?: string
    ) => Promise<unknown>;
}

const getBackendUrl = (): string => {
    if (typeof window !== 'undefined') {
        const win = window as { backend_url?: string };
        if (win.backend_url) return win.backend_url;
    }
    return import.meta.env.VITE_VOICEBOT_BASE_URL ?? '/api';
};

const getProxyConfig = (): { url: string; auth: string } | null => {
    if (typeof window !== 'undefined') {
        const win = window as { proxy_url?: string; proxy_auth?: string };
        if (win.proxy_url && win.proxy_auth) {
            return { url: win.proxy_url, auth: win.proxy_auth };
        }
    }
    return null;
};

const resolveAgentsMcpServerUrl = (): string | null => {
    if (typeof window !== 'undefined') {
        const win = window as { agents_api_url?: string };
        if (win.agents_api_url) return win.agents_api_url;
    }
    const envUrl = import.meta.env.VITE_AGENTS_API_URL as string | undefined;
    return envUrl || null;
};

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

const voicebotRequest = async <T = unknown>(url: string, data: unknown = {}, silent = false): Promise<T> => {
    const backendUrl = getBackendUrl();
    const proxyConfig = getProxyConfig();
    const { authToken } = useAuthStore.getState();

    if (proxyConfig) {
        const response = await axios.post<T>(proxyConfig.url, data, {
            headers: {
                'Content-Type': 'application/json',
                'X-Proxy-Auth': proxyConfig.auth,
                'X-Proxy-Target-URL': `${backendUrl}/${url}`,
                'X-Authorization': authToken ?? '',
            },
            withCredentials: true,
        });
        return response.data;
    }

    const response = await axios.post<T>(`${backendUrl}/${url}`, data, {
        headers: {
            'X-Authorization': authToken ?? '',
        },
        withCredentials: true,
    });

    if (!silent && response.status >= 400) {
        throw new Error('Failed to fetch! Try again.');
    }

    return response.data;
};

const transformVoiceBotMessagesToGroups = (voiceBotMessages: VoiceBotMessage[]): VoiceMessageGroup[] => {
    if (!Array.isArray(voiceBotMessages)) return [];
    return voiceBotMessages.map((msg) => ({
        message_id: msg.message_id,
        message_timestamp: msg.message_timestamp,
        original_message: msg,
        rows: (msg.categorization || []).map((cat) => {
            let avatar = 'U';
            const speaker = typeof cat.speaker === 'string' ? cat.speaker : '';
            if (speaker && speaker !== 'Unknown' && speaker.length > 0) {
                avatar = speaker[0]?.toUpperCase() ?? 'U';
            }
            return {
                timeStart: cat.start,
                timeEnd: cat.end,
                avatar,
                name: cat.speaker,
                text: cat.text,
                goal: cat.related_goal || '',
                patt: cat.new_pattern_detected || '',
                flag: cat.quality_flag || '',
                keywords: cat.topic_keywords || '',
                message_id: msg.message_id,
            };
        }),
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
    }));
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
    const messages = (data.session_messages as VoiceBotMessage[]) || [];
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

export const useVoiceBotStore = create<VoiceBotState>((set, get) => ({
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

    updateSessionName: async (sessionId, newName) => {
        try {
            await voicebotRequest('voicebot/sessions/update_name', { session_id: sessionId, session_name: newName });
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
            await voicebotRequest('voicebot/sessions/update_dialogue_tag', { session_id: sessionId, dialogue_tag: dialogueTag });
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
            await voicebotRequest('voicebot/sessions/send_to_crm', { session_id: sessionId });
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

            const agentsMcpServerUrl = resolveAgentsMcpServerUrl();
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

            await voicebotRequest('voicebot/sessions/save_create_tasks', {
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
        const response = await voicebotRequest<unknown>('voicebot/sessions/get', { session_id: sessionId });
        const normalized = normalizeSessionResponse(response);
        const processed = transformVoiceBotMessagesToGroups(normalized.session_messages);

        set({
            voiceBotSession: normalized.voice_bot_session,
            voiceBotMessages: normalized.session_messages,
            voiceMesagesData: processed,
            sessionAttachments: normalized.session_attachments ?? [],
            sessionLogEvents: [],
            socketToken: normalized.socket_token ?? null,
            socketPort: normalized.socket_port ?? null,
            currentSessionId: sessionId,
        });

        if (!get().socket && normalized.socket_token) {
            const socket = getVoicebotSocket(normalized.socket_token);

            socket.on('connect', () => {
                console.log('Connected to voice bot socket');
            });

            socket.on('disconnect', (reason) => {
                console.log('Disconnected from voice bot socket:', reason);
                set({ socket: null });
            });

            socket.on('message_update', (data: { message_id?: string; message?: VoiceBotMessage; _id?: string }) => {
                set((state) => {
                    const updatedMessages = state.voiceBotMessages.map((msg) =>
                        msg.message_id === data.message_id || msg._id === data.message?._id ? (data.message ?? msg) : msg
                    );
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups([...updatedMessages]);
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
                    const updatedMessages = update(state.voiceBotMessages, { $push: [data] });
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups([...updatedMessages]);
                    const updatedAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                    return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments: updatedAttachments };
                });
            });

            socket.on('session_update', (data: Partial<VoiceBotSession>) => {
                set((state) => ({
                    voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, ...data } : state.voiceBotSession,
                }));
            });

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
            const response = await voicebotRequest<Record<string, unknown>>('voicebot/active_session', {});
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
        try {
            await voicebotRequest('voicebot/activate_session', { session_id: sessionId });
            return true;
        } catch (error) {
            console.error('Ошибка при активации сессии:', error);
            return false;
        }
    },

    fetchSessionLog: async (sessionId, options) => {
        try {
            const response = await voicebotRequest<{ events?: VoiceSessionLogEvent[] }>('voicebot/session_log', { session_id: sessionId });
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

    editTranscriptChunk: async (payload, options) => {
        const body = {
            session_id: payload.session_id,
            message_id: payload.message_id,
            segment_oid: payload.segment_oid,
            text: payload.new_text,
            reason: payload.reason,
        };
        try {
            await voicebotRequest('voicebot/edit_transcript_chunk', body, Boolean(options?.silent));
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
            await voicebotRequest('voicebot/delete_transcript_chunk', payload, Boolean(options?.silent));
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
            await voicebotRequest('voicebot/rollback_event', payload, Boolean(options?.silent));
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
            await voicebotRequest('voicebot/resend_notify_event', payload, Boolean(options?.silent));
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
            await voicebotRequest('voicebot/retry_categorization_event', payload, Boolean(options?.silent));
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
            await voicebotRequest('voicebot/sessions/update_project', { session_id: sessionId, project_id: projectId });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, project_id: projectId } : state.voiceBotSession,
            }));
        } catch (e) {
            console.error('Ошибка при обновлении project_id сессии', e);
        }
    },

    finishSession: (sessionId) => {
        const socket = get().socket;
        if (socket && sessionId) {
            socket.emit(SOCKET_EVENTS.SESSION_DONE, { session_id: sessionId });
        }
    },

    updateSessionAccessLevel: async (sessionId, accessLevel) => {
        try {
            await voicebotRequest('voicebot/sessions/update_access_level', { session_id: sessionId, access_level: accessLevel });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, access_level: accessLevel } : state.voiceBotSession,
            }));
        } catch (e) {
            console.error('Ошибка при обновлении уровня доступа сессии', e);
        }
    },

    restartCorruptedSession: async (sessionId) => {
        try {
            return await voicebotRequest('voicebot/restart_corrupted_session', { session_id: sessionId });
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
            const response = await voicebotRequest('voicebot/sessions/get', { session_id: sessionId });
            return normalizeSessionResponse(response);
        } catch (error) {
            console.error('Ошибка при получении данных сессии:', error);
            throw error;
        }
    },

    fetchVoiceBotSessionsList: async (options) => {
        const { force = false } = options ?? {};
        const { isSessionsListLoading, sessionsListLoadedAt } = get();
        if (isSessionsListLoading) return;
        if (!force && sessionsListLoadedAt) return;

        set({ isSessionsListLoading: true });
        try {
            const response = await voicebotRequest<VoiceBotSession[]>('voicebot/sessions/list');
            if (response && Array.isArray(response)) {
                const sorted = [...response].sort((a, b) => {
                    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
                    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                    return bTime - aTime;
                });
                set({ voiceBotSessionsList: sorted, sessionsListLoadedAt: Date.now() });
            } else {
                console.error('Ошибка при получении списка сессий:', response);
                set({ voiceBotSessionsList: [] });
            }
        } catch (error) {
            console.error('Ошибка при получении списка сессий:', error);
            set({ voiceBotSessionsList: [] });
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
            const data = await voicebotRequest<TaskTypeNode[]>('voicebot/task_types');
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
            const data = await voicebotRequest<VoiceBotProject[]>('voicebot/projects');
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
            const data = await voicebotRequest<VoicebotPerson[]>('voicebot/persons/list');
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
            const response = await voicebotRequest<VoicebotPerson>('voicebot/persons/create', personData);
            await get().fetchPersonsList();
            return response;
        } catch (e) {
            console.error('Ошибка при создании персоны:', e);
            throw e;
        }
    },

    updateSessionParticipants: async (sessionId, participantIds) => {
        try {
            await voicebotRequest('voicebot/sessions/update_participants', { session_id: sessionId, participant_ids: participantIds });
            set((state) => ({
                voiceBotSession: state.voiceBotSession ? { ...state.voiceBotSession, participants: participantIds } : state.voiceBotSession,
            }));
            return true;
        } catch (e) {
            console.error('Ошибка при обновлении участников сессии:', e);
            throw e;
        }
    },

    uploadAudioFile: async (file, sessionId) => {
        try {
            const backendUrl = getBackendUrl();
            const { authToken } = useAuthStore.getState();
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('session_id', sessionId);

            const response = await axios.post(`${backendUrl}/voicebot/uploads/audio`, formData, {
                headers: {
                    'X-Authorization': authToken ?? '',
                    'Content-Type': 'multipart/form-data',
                },
                withCredentials: true,
            });
            return response.data;
        } catch (e) {
            console.error('Ошибка при загрузке аудио файла:', e);
            throw e;
        }
    },

    updateSessionAllowedUsers: async (sessionId, allowedUserIds) => {
        try {
            await voicebotRequest('voicebot/sessions/update_allowed_users', {
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

    fetchPerformersList: async () => {
        try {
            const data = await voicebotRequest<Array<Record<string, unknown>>>('voicebot/auth/list-users');
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

    fetchPerformersForTasksList: async () => {
        try {
            const data = await voicebotRequest<Array<Record<string, unknown>>>('voicebot/persons/list_performers');
            if (data && Array.isArray(data)) {
                set({ performers_for_tasks_list: data });
                return data;
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
                project: prepared_projects?.find((p) => p._id === ticket.project_id)?.name || null,
            }));

            await voicebotRequest('voicebot/create_tickets', { tickets: preparedTickets, session_id: get().currentSessionId });
            message.success(`Создано ${selectedTicketIds.length} задач`);
            useSessionsUIStore.getState().closeTicketsModal();
            return true;
        } catch (e) {
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

            await voicebotRequest('voicebot/delete_task_from_session', { session_id: sessionId, task_id: taskId });

            set((state) => {
                if (!state.voiceBotSession) {
                    return state;
                }
                const processorsData = state.voiceBotSession.processors_data as Record<string, unknown> | undefined;
                const createTasks = processorsData?.CREATE_TASKS as { data?: Array<{ id: string }> } | undefined;
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
                                data: createTasks.data.filter((task) => task.id !== taskId),
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
            await voicebotRequest('voicebot/sessions/delete', { session_id: sessionId }, true);
            await get().fetchVoiceBotSessionsList({ force: true });
            return true;
        } catch (e) {
            console.error('Ошибка при удалении сессии:', e);
            throw e;
        }
    },

    downloadTranscription: async (sessionId) => {
        try {
            const backendUrl = getBackendUrl();
            const { authToken } = useAuthStore.getState();
            const response = await fetch(`${backendUrl}/transcription/download/${sessionId}`, {
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
            return await voicebotRequest('voicebot/topics', requestData);
        } catch (error) {
            console.error('Ошибка при получении топиков:', error);
            throw error;
        }
    },

    runCustomPrompt: async (prompt, input, model = 'gpt-5', sessionId = null, inputType = 'categorization') => {
        try {
            const response = await voicebotRequest<Record<string, unknown>>('voicebot/LLMGate/run_prompt', {
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
                    await voicebotRequest('voicebot/save_custom_prompt_result', {
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
