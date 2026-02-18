
import axios from 'axios';
import { create } from 'zustand'
import { io } from 'socket.io-client';

import update from "immutability-helper";
import _ from 'lodash'
import { useRequest } from './request';
import { useSessionsUI } from './sessionsUI';
import { useAuthUser } from "./AuthUser"
import { getMessageCategorizationRows } from '../utils/categorization';

import { message } from 'antd';

function transformVoiceBotMessagesToGroups(voiceBotMessages) {
    if (!Array.isArray(voiceBotMessages)) return [];
    return voiceBotMessages.map(msg => ({
        message_id: msg.message_id,
        message_timestamp: msg.message_timestamp,
        original_message: msg,
        rows: getMessageCategorizationRows(msg).map(cat => {
            let avatar = "U";
            const speaker = cat.speaker || cat.name || "Unknown";
            if (speaker !== "Unknown" && typeof speaker === "string" && speaker.length > 0) {
                avatar = speaker[0].toUpperCase();
            }
            return {
                timeStart: cat.timeStart || cat.start || "",
                timeEnd: cat.timeEnd || cat.end || "",
                avatar,
                name: cat.name || speaker,
                text: cat.text,
                goal: cat.goal || cat.related_goal || "",
                patt: cat.new_pattern_detected || "",
                flag: cat.flag || cat.quality_flag || "",
                keywords: cat.keywords || cat.topic_keywords || "",
                message_id: msg.message_id
            };
        }),
        summary: {
            text:
                (msg.processors_data?.summarization?.data?.[0]?.summary) ||
                ""
        },
        widgets: (() => {
            const custom_widgets = _.omit(msg.processors_data, ['transcription', 'summarization', 'categorization', 'questioning']);
            const widgets = {};
            for (const [key, value] of Object.entries(custom_widgets)) {
                if (value && value.data && Array.isArray(value.data)) {
                    widgets[key] = value.data.map(d => ({ ...d, message_id: msg.message_id })) ?? []
                }
            }
            return {
                questions: (msg.processors_data?.questioning?.data?.map(d => ({ ...d, message_id: msg.message_id })) || []),
                ...widgets
            }
        })()
    }));
}

const toSeconds = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const normalizeSessionAttachment = (message, attachment, attachmentIndex) => {
    if (!message || !attachment || typeof attachment !== "object") return null;
    const isTelegramSource = attachment.source === 'telegram' || message?.source_type === 'telegram';
    const telegramFileId = attachment.file_id || (
        isTelegramSource && (message?.message_type === 'screenshot' || message?.message_type === 'document')
            ? message?.file_id
            : null
    );
    const directUri = typeof attachment.direct_uri === "string" && attachment.direct_uri.trim()
        ? attachment.direct_uri.trim()
        : null;
    let uri = attachment.uri || attachment.url || attachment.link;
    let url = attachment.url || attachment.uri || attachment.link;

    // Never expose raw Telegram file links to the browser (they embed bot token). Use backend proxy instead.
    if (directUri) {
        uri = directUri;
        url = directUri;
    } else if (isTelegramSource && telegramFileId && message?._id != null && attachmentIndex != null) {
        const base = `${window.backend_url || ''}`.replace(/\/+$/, '');
        uri = `${base}/voicebot/message_attachment/${message._id}/${attachmentIndex}`;
        url = uri;
    }

    if (!uri && !url) return null;

    return {
        _id: attachment._id || `${message?._id || message.message_id || "message"}::${uri}`,
        message_id: message.message_id ?? null,
        message_oid: message._id ? message._id.toString() : null,
        message_timestamp: toSeconds(message.message_timestamp) ?? 0,
        message_type: message.message_type || null,
        kind: attachment.kind || message.message_type || null,
        source: attachment.source || null,
        source_type: message.source_type || null,
        uri,
        url,
        name: attachment.name || attachment.filename || null,
        mimeType: attachment.mimeType || attachment.mime_type || null,
        size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : null,
        width: Number.isFinite(Number(attachment.width)) ? Number(attachment.width) : null,
        height: Number.isFinite(Number(attachment.height)) ? Number(attachment.height) : null,
        caption: attachment.caption || message.text || "",
        file_id: attachment.file_id || null,
        file_unique_id: attachment.file_unique_id || null,
        direct_uri: directUri || null,
    };
};

const buildSessionAttachmentsFromMessages = (voiceBotMessages) => {
    if (!Array.isArray(voiceBotMessages)) return [];
    const result = [];

    for (const message of voiceBotMessages) {
        const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
        for (let attachmentIndex = 0; attachmentIndex < attachments.length; attachmentIndex++) {
            const attachment = attachments[attachmentIndex];
            const normalized = normalizeSessionAttachment(message, attachment, attachmentIndex);
            if (normalized) result.push(normalized);
        }
    }

    result.sort((a, b) => {
        if (a.message_timestamp !== b.message_timestamp) {
            return (a.message_timestamp || 0) - (b.message_timestamp || 0);
        }
        return `${a.message_id ?? ""}`.localeCompare(`${b.message_id ?? ""}`);
    });

    return result;
};

export const useVoiceBot = create((set, get) => {
    const api_request = useRequest.getState().api_request
    let socket = null;
    return ({
        currentSessionId: null,
        voiceBotSession: null,
        voiceBotMessages: null,
        voiceMesagesData: [],
        sessionAttachments: [],
        sessionLogEvents: [],
        socket_token: null,
        socket_port: null,
        socket: null,
        highlightedMessageId: null,
        sessionLoadStatus: "idle",
        sessionLoadError: null,
        // Дерево типов задач для выбора при создании задач
        task_types: null,

        updateSessionName: async (session_id, newName) => {
            // Отправка запроса на сервер для обновления названия встречи
            try {
                await api_request('voicebot/update_session_name', { session_id, session_name: newName });
                // После успешного обновления обновляем локальный стейт
                set(state => ({
                    // Обновляем текущую сессию если она открыта
                    voiceBotSession: state.voiceBotSession?._id === session_id ? {
                        ...state.voiceBotSession,
                        session_name: newName
                    } : state.voiceBotSession,
                    // Обновляем сессию в списке всех сессий
                    voiceBotSessionsList: state.voiceBotSessionsList?.map(session =>
                        session._id === session_id
                            ? { ...session, session_name: newName }
                            : session
                    ) || state.voiceBotSessionsList
                }));
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при обновлении названия встречи', e);
            }
        },

        updateSessionDialogueTag: async (session_id, dialogue_tag) => {
            try {
                await api_request('voicebot/update_session_dialogue_tag', { session_id, dialogue_tag });
                set(state => ({
                    voiceBotSession: state.voiceBotSession?._id === session_id
                        ? { ...state.voiceBotSession, dialogue_tag }
                        : state.voiceBotSession,
                    voiceBotSessionsList: state.voiceBotSessionsList?.map(session =>
                        session._id === session_id
                            ? { ...session, dialogue_tag }
                            : session
                    ) || state.voiceBotSessionsList
                }));
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при обновлении dialogue_tag сессии', e);
            }
        },

        sendSessionToCrm: async (session_id) => {
            try {
                await api_request('voicebot/send_to_crm', { session_id });
                set(state => ({
                    voiceBotSession: state.voiceBotSession?._id === session_id
                        ? { ...state.voiceBotSession, show_in_crm: true }
                        : state.voiceBotSession,
                    voiceBotSessionsList: state.voiceBotSessionsList?.map(session =>
                        session._id === session_id
                            ? { ...session, show_in_crm: true }
                            : session
                    ) || state.voiceBotSessionsList
                }));
                return true;
            } catch (e) {
                console.error('Ошибка при отправке сессии в CRM', e);
                throw e;
            }
        },

        fetchVoiceBotSession: async (session_id) => {
            const prevSessionId = get().currentSessionId;
            set({
                voiceBotSession: null,
                voiceBotMessages: null,
                voiceMesagesData: [],
                sessionAttachments: [],
                sessionLogEvents: [],
                sessionLoadStatus: "loading",
                sessionLoadError: null,
                currentSessionId: session_id,
            });
            const response = await api_request('voicebot/session', { session_id });
            if (!response) {
                const requestError = useRequest.getState().requestError || {};
                const notFound = Number(requestError.status || 0) === 404;
                set({
                    sessionLoadStatus: notFound ? "not_found" : "error",
                    sessionLoadError: {
                        status: requestError.status || null,
                        statusText: requestError.statusText || null,
                        data: requestError.data || null
                    },
                    voiceBotSession: null,
                    voiceBotMessages: null,
                    voiceMesagesData: [],
                    sessionAttachments: [],
                    socket: null,
                    socket_token: null,
                    socket_port: null
                });
                if (socket) {
                    socket.disconnect();
                    socket = null;
                }
                return;
            }
            const processed = transformVoiceBotMessagesToGroups(response.session_messages);
            const sessionAttachments = Array.isArray(response.session_attachments) && response.session_attachments.length > 0
                ? response.session_attachments
                : buildSessionAttachmentsFromMessages(response.session_messages);
            set(state => ({
                voiceBotSession: response.voice_bot_session,
                voiceBotMessages: response.session_messages,
                voiceMesagesData: processed,
                sessionAttachments,
                socket_token: response.socket_token,
                socket_port: response.socket_port,
                currentSessionId: session_id,
                sessionLoadStatus: "ready",
                sessionLoadError: null,
            }))

            if (!socket) {
                // Use the same origin (or configured backend_url) so HTTPS pages always use WSS
                // and we don't depend on explicit ports (reverse-proxy friendly).
                const socketUrl = window.backend_url || window.location.origin;

                socket = io(socketUrl, {
                    path: '/socket.io',
                    auth: {
                        token: response.socket_token
                    },
                    transports: ['websocket']
                });

                socket.on('connect', () => {
                    console.log('Connected to voice bot socket');
                });

                socket.on('disconnect', (reason) => {
                    console.log('Disconnected from voice bot socket:', reason);
                    set(state => ({ socket: null }));
                });

                socket.on('message_update', (data) => {
                    console.log('Received update from voice bot:', data);
                    set(state => {
                        // Найти сообщение по id и обновить его
                        const updatedMessages = state.voiceBotMessages.map(msg =>
                            msg.message_id === data.message_id || msg._id === data.message?._id ? data.message : msg
                        );
                        const sessionAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                        // Обновляем voiceMesagesData тоже
                        const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups([...updatedMessages]);
                        return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments };
                    });
                });

                socket.on('new_message', (data) => {
                    console.log('Received new message from voice bot:', data);
                    // проверить есть ли сообщение с таким же id
                    const existingMessage = get().voiceBotMessages.find(msg => msg._id === data.message_id || msg._id === data._id);
                    if (existingMessage) {
                        console.log('Received new message with existing id, skipping:', data.message_id);
                        return;
                    }

                    set(state => {
                    const updatedMessages = update(state.voiceBotMessages, {
                        $push: [data]
                    });
                    const sessionAttachments = buildSessionAttachmentsFromMessages(updatedMessages);
                    // Обновляем voiceMesagesData тоже
                    const updatedVoiceMesagesData = transformVoiceBotMessagesToGroups([...updatedMessages]);
                    return { voiceBotMessages: updatedMessages, voiceMesagesData: updatedVoiceMesagesData, sessionAttachments };
                });
                });

                socket.on('session_update', (data) => {
                    console.log('Received session update from voice bot:', data);
                    set(state => ({
                        voiceBotSession: {
                            ...state.voiceBotSession,
                            ...data
                        }
                    }));
                });


                socket.on('tickets_prepared', (data) => {
                    console.log('Tickets prepared:', data);
                    // Сохраняем полученные задачи и показываем модальное окно через sessionsUI
                    const { openTicketsModal } = useSessionsUI.getState();
                    openTicketsModal(data);
                });

                set(state => ({ socket }));
            }

            // Отписка от старой сессии, если session_id изменился
            if (prevSessionId && prevSessionId !== session_id && socket) {
                socket.emit('unsubscribe_from_session', { session_id: prevSessionId });
            }
            // Подписка на новую сессию
            socket.emit('subscribe_on_session', { session_id });

            // Загружаем список пользователей для управления доступом
            if (!get().performers_list) {
                get().fetchPerformersList();
            }
        },

        getMessageDataById: (message_id) => {
            const { voiceBotMessages } = get();
            if (!voiceBotMessages || !Array.isArray(voiceBotMessages)) return null;
            return voiceBotMessages.find(msg => msg._id === message_id || msg.message_id === message_id) || null;
        },

        // Сохранение project_id в сессию
        updateSessionProject: async (session_id, project_id) => {
            try {
                await api_request('voicebot/update_session_project', { session_id, project_id });
                set(state => ({
                    voiceBotSession: {
                        ...state.voiceBotSession,
                        project_id
                    }
                }));
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при обновлении project_id сессии', e);
            }
        },

        // Manual trigger: enqueue `session_ready_to_summarize` notify (also assigns PMO if project is missing)
        triggerSessionReadyToSummarize: async (session_id) => {
            try {
                const response = await api_request('voicebot/trigger_session_ready_to_summarize', { session_id });

                if (response?.project_id) {
                    set(state => ({
                        voiceBotSession: state.voiceBotSession?._id === session_id ? {
                            ...state.voiceBotSession,
                            project_id: response.project_id
                        } : state.voiceBotSession
                    }));
                }

                return response;
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при ручном запуске Summarize', e);
                throw e;
            }
        },

        fetchSessionLog: async (session_id, opt) => {
            if (!session_id) return null;
            const response = await api_request('voicebot/session_log', { session_oid: session_id }, opt);
            if (response?.success && Array.isArray(response.events)) {
                set({ sessionLogEvents: response.events });
            } else {
                set({ sessionLogEvents: [] });
            }
            return response;
        },

        editTranscriptChunk: async ({ session_id, message_id, segment_oid, new_text, reason }, opt) => {
            const payload = {
                session_oid: session_id,
                message_oid: message_id,
                segment_oid,
                new_text,
            };
            if (typeof reason === 'string' && reason.trim()) payload.reason = reason.trim();
            return await api_request('voicebot/edit_transcript_chunk', payload, opt);
        },

        deleteTranscriptChunk: async ({ session_id, message_id, segment_oid, reason }, opt) => {
            const payload = {
                session_oid: session_id,
                message_oid: message_id,
                segment_oid,
            };
            if (typeof reason === 'string' && reason.trim()) payload.reason = reason.trim();
            return await api_request('voicebot/delete_transcript_chunk', payload, opt);
        },

        rollbackSessionEvent: async ({ session_id, event_oid, reason }, opt) => {
            const payload = {
                session_oid: session_id,
                event_oid,
            };
            if (typeof reason === 'string' && reason.trim()) payload.reason = reason.trim();
            return await api_request('voicebot/rollback_event', payload, opt);
        },

        resendNotifyEvent: async ({ session_id, event_oid, reason }, opt) => {
            const payload = {
                session_oid: session_id,
                event_oid,
            };
            if (typeof reason === 'string' && reason.trim()) payload.reason = reason.trim();
            return await api_request('voicebot/resend_notify_event', payload, opt);
        },

        retryCategorizationEvent: async ({ session_id, event_oid, reason }, opt) => {
            const payload = {
                session_oid: session_id,
                event_oid,
            };
            if (typeof reason === 'string' && reason.trim()) payload.reason = reason.trim();
            return await api_request('voicebot/retry_categorization_event', payload, opt);
        },

        retryCategorizationChunk: async ({ session_id, message_id, segment_oid, reason }, opt) => {
            const payload = {
                session_oid: session_id,
                message_oid: message_id,
                segment_oid,
            };
            if (typeof reason === 'string' && reason.trim()) payload.reason = reason.trim();
            return await api_request('voicebot/retry_categorization_chunk', payload, opt);
        },

        // Завершение сессии через сокет
        finishSession: (session_id) => {
            const socket = get().socket;
            if (socket && session_id) {
                socket.emit('session_done', { session_id });
            }
        },

        fetchActiveSession: async () => {
            const response = await api_request('voicebot/active_session');
            return response?.active_session || null;
        },

        activateSession: async (session_id) => {
            if (!session_id) throw new Error('session_id is required');
            return await api_request('voicebot/activate_session', { session_id });
        },

        // Обновление уровня доступа к сессии
        updateSessionAccessLevel: async (session_id, access_level) => {
            try {
                await api_request('voicebot/update_session_access_level', { session_id, access_level });
                set(state => ({
                    voiceBotSession: {
                        ...state.voiceBotSession,
                        access_level
                    }
                }));
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при обновлении уровня доступа сессии', e);
            }
        },

        restartCorruptedSession: async (session_id) => {
            try {
                return await api_request('voicebot/restart_corrupted_session', { session_id });
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при перезапуске поломанной сессии', e);
                throw e;
            }
        },

        // Установка выделенного message_id для подсветки строк
        setHighlightedMessageId: (message_id) => {
            set({ highlightedMessageId: message_id });
        },

        // Получение данных сессии без обновления состояния (для использования в списке сессий)
        getSessionData: async (session_id) => {
            try {
                const response = await api_request('voicebot/session', { session_id });
                return {
                    voice_bot_session: response.voice_bot_session,
                    session_messages: response.session_messages
                };
            } catch (error) {
                console.error('Ошибка при получении данных сессии:', error);
                throw error;
            }
        },

        fetchVoiceBotSessionsList: async () => {
            const response = await api_request('voicebot/sessions');
            if (response && _.isArray(response)) {
                response.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                set({ voiceBotSessionsList: response });
            } else {
                console.error('Ошибка при получении списка сессий:', response);
            }
        },

        postProcessSession: async (session_id) => {
            try {
                const socket = get().socket;
                if (socket && session_id) {
                    socket.emit('post_process_session', { session_id });
                }
                set(state => ({
                    voiceBotSession: {
                        ...state.voiceBotSession,
                        is_postprocessing: true
                    }
                }));
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при постобработке сессии', e);
            }
        },

        // Создание задач из выделенных chunks
        createTasksFromChunks: (session_id, chunks_to_process) => {
            try {
                const socket = get().socket;
                if (socket && session_id && chunks_to_process && chunks_to_process.length > 0) {
                    socket.emit('create_tasks_from_chunks', { session_id, chunks_to_process });
                }
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Ошибка при создании задач из chunks:', e);
            }
        },

        // Создание задач из выделенных строк
        createTasksFromRows: (session_id, selectedCategorizationRows) => {
            if (!session_id || selectedCategorizationRows.length === 0) return;

            // Преобразуем selectedCategorizationRows в chunks_to_process формата [{text: "text of chunk"},...]
            const chunks_to_process = selectedCategorizationRows.map(row => ({
                text: row.text || ""
            }));

            // Отправляем событие через сокет
            get().createTasksFromChunks(session_id, chunks_to_process);
        },

        voiceBotSessionsList: [],
        prepared_projects: null,
        persons_list: null,

        // Загрузка дерева типов задач
        fetchTaskTypes: async () => {
            try {
                const data = await api_request('voicebot/task_types');
                if (data && Array.isArray(data)) {
                    set({ task_types: data });
                    return data;
                } else {
                    console.error('Ошибка при получении типов задач:', data);
                    return [];
                }
            } catch (e) {
                console.error('Ошибка при получении типов задач:', e);
                return [];
            }
        },

        fetchPreparedProjects: async () => {
            const data = await api_request('voicebot/projects');
            if (data && Array.isArray(data)) {
                set({ prepared_projects: data });
            } else {
                console.error('Ошибка при получении подготовленных проектов:', data);
            }
        },

        // Получение списка всех персон
        fetchPersonsList: async () => {
            try {
                const data = await api_request('persons/list');
                if (data && Array.isArray(data)) {
                    set({ persons_list: data });
                    return data;
                } else {
                    console.error('Ошибка при получении списка персон:', data);
                    return [];
                }
            } catch (e) {
                console.error('Ошибка при получении списка персон:', e);
                return [];
            }
        },

        // Создание новой персоны
        createPerson: async (personData) => {
            try {
                const response = await api_request('persons/create', personData);
                // Обновляем список персон после создания
                await get().fetchPersonsList();
                // Возвращаем созданную персону с _id
                return response;
            } catch (e) {
                console.error('Ошибка при создании персоны:', e);
                throw e;
            }
        },

        // Обновление участников сессии
        updateSessionParticipants: async (session_id, participant_ids) => {
            try {
                await api_request('voicebot/update_session_person', { session_id, participant_ids });
                // Обновляем локальный стейт
                set(state => ({
                    voiceBotSession: {
                        ...state.voiceBotSession,
                        participants: participant_ids
                    }
                }));
                return true;
            } catch (e) {
                console.error('Ошибка при обновлении участников сессии:', e);
                throw e;
            }
        },

        // Загрузка аудио файла
        uploadAudioFile: async (file, sessionId, opt) => {
            try {
                const sendAudioFile = useRequest.getState().sendAudioFile;
                const result = await sendAudioFile(file, sessionId, opt);
                return result;
            } catch (e) {
                console.error('Ошибка при загрузке аудио файла:', e);
                throw e;
            }
        },

        // Получение статуса обработки аудио файла
        // getUploadProgress: async (messageId) => {
        //     try {
        //         const status = await api_request(`voicebot/upload_progress/${messageId}`, {}, { method: 'GET' });
        //         return status;
        //     } catch (e) {
        //         console.error('Ошибка при получении статуса обработки:', e);
        //         throw e;
        //     }
        // },

        // Обновление списка пользователей с доступом к RESTRICTED сессии
        updateSessionAllowedUsers: async (session_id, allowed_user_ids) => {
            try {
                await api_request('voicebot/update_session_allowed_users', { session_id, allowed_user_ids });
                // Обновляем локальный стейт
                set(state => ({
                    voiceBotSession: {
                        ...state.voiceBotSession,
                        allowed_users: allowed_user_ids
                    }
                }));
                return true;
            } catch (e) {
                console.error('Ошибка при обновлении списка пользователей с доступом:', e);
                throw e;
            }
        },

        // Список пользователей (performers)
        performers_list: null,

        // Получение списка всех пользователей (performers)
        fetchPerformersList: async () => {
            try {
                const data = await api_request('auth/list-users');
                if (data && Array.isArray(data)) {
                    set({ performers_list: data });
                    return data;
                } else {
                    console.error('Ошибка при получении списка пользователей:', data);
                    return [];
                }
            } catch (e) {
                console.error('Ошибка при получении списка пользователей:', e);
                return [];
            }
        },

        // Список исполнителей (performers) для задач
        performers_for_tasks_list: null,

        // Получение списка исполнителей для задач
        fetchPerformersForTasksList: async () => {
            try {
                const data = await api_request('persons/list_performers');
                if (data && Array.isArray(data)) {
                    set({ performers_for_tasks_list: data });
                    return data;
                } else {
                    console.error('Ошибка при получении списка исполнителей:', data);
                    return [];
                }
            } catch (e) {
                console.error('Ошибка при получении списка исполнителей:', e);
                return [];
            }
        },

        // Подтверждение создания выбранных задач
        confirmSelectedTickets: async (selectedTicketIds, updatedTickets = null) => {
            try {
                // TODO: Заглушка - здесь будет запрос к backend для создания подтвержденных задач
                console.log('Создание задач:', selectedTicketIds);

                const { ticketsModal } = useSessionsUI.getState();
                const { prepared_projects } = get();
                const ticketsSource = updatedTickets || ticketsModal.tickets;
                const selectedTickets = ticketsSource
                    ? ticketsSource.filter(ticket => selectedTicketIds.includes(ticket.id))
                    : [];

                const preparedTickets = selectedTickets.map(ticket => {
                    return {
                        ...ticket,
                        project: prepared_projects?.find(p => p._id === ticket.project_id)?.name || null,
                    };
                });

                console.log('Выбранные тикеты:', preparedTickets);

                await api_request('voicebot/create_tickets', { tickets: preparedTickets, session_id: get().currentSessionId });

                message.success(`Создано ${selectedTicketIds.length} задач`);

                // Закрываем модальное окно через sessionsUI
                const { closeTicketsModal } = useSessionsUI.getState();
                closeTicketsModal();

                return true;
            } catch (e) {
                console.error('Ошибка при создании задач:', e);
                message.error('Ошибка при создании задач');
                throw e;
            }
        },

        // Отклонение всех задач
        rejectAllTickets: () => {
            message.info('Создание задач отменено');
            const { closeTicketsModal } = useSessionsUI.getState();
            closeTicketsModal();
        },

        // Удаление задачи из списка возможных задач
        deleteTaskFromSession: async (task_id) => {
            try {
                const session_id = get().currentSessionId;
                if (!session_id) {
                    message.error('Сессия не выбрана');
                    return false;
                }

                await api_request('voicebot/delete_task_from_session', {
                    session_id,
                    task_id
                });

                // Обновляем локальное состояние - удаляем задачу из списка
                set(state => {
                    if (!state.voiceBotSession?.processors_data?.CREATE_TASKS?.data) {
                        return state;
                    }

                    return {
                        ...state,
                        voiceBotSession: {
                            ...state.voiceBotSession,
                            processors_data: {
                                ...state.voiceBotSession.processors_data,
                                CREATE_TASKS: {
                                    ...state.voiceBotSession.processors_data.CREATE_TASKS,
                                    data: state.voiceBotSession.processors_data.CREATE_TASKS.data.filter(
                                        task => task.id !== task_id
                                    )
                                }
                            }
                        }
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

        // Удаление сессии
        deleteSession: async (session_id) => {
            try {
                await api_request('voicebot/delete_session', { session_id }, { silent: true });
                // Обновляем список сессий после удаления
                await get().fetchVoiceBotSessionsList();
                return true;
            } catch (e) {
                console.error('Ошибка при удалении сессии:', e);
                throw e;
            }
        },
        // Функция для скачивания транскрипции
        downloadTranscription: async (sessionId) => {
            try {

                const response = await fetch(`${window.backend_url}/transcription/download/${sessionId}`, {
                    method: 'GET',
                    headers: {
                        'X-Authorization': useAuthUser.getState().auth_token,
                    },
                });

                if (!response.ok) {
                    throw new Error('Ошибка при скачивании транскрипции');
                }

                // Получаем имя файла из заголовков
                const contentDisposition = response.headers.get('content-disposition');
                let filename = 'transcription.md';
                if (contentDisposition) {
                    // Сначала пробуем UTF-8 формат (filename*=UTF-8''...)
                    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;,\s]+)/);
                    if (utf8Match) {
                        filename = decodeURIComponent(utf8Match[1]);
                    } else {
                        // Пробуем стандартный формат (filename="...")
                        const standardMatch = contentDisposition.match(/filename="([^"]+)"/);
                        if (standardMatch) {
                            filename = standardMatch[1];
                        } else {
                            // Альтернативный способ парсинга без кавычек
                            const altMatch = contentDisposition.match(/filename=([^;,\s]+)/);
                            if (altMatch) {
                                filename = altMatch[1].trim();
                            }
                        }
                    }
                }

                // Получаем содержимое файла
                const blob = await response.blob();

                // Создаем ссылку для скачивания
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

        // Получение топиков проекта
        fetchProjectTopics: async (project_id, session_id = null) => {
            try {
                const requestData = { project_id };
                if (session_id) {
                    requestData.session_id = session_id;
                }

                const response = await api_request('voicebot/topics', requestData);
                return response;
            } catch (error) {
                console.error('Ошибка при получении топиков:', error);
                throw error;
            }
        },

        // Запуск произвольного промпта через LLMGate
        runCustomPrompt: async (prompt, input, model = 'gpt-5', sessionId = null, inputType = 'categorization') => {
            try {
                const response = await api_request('LLMGate/run_prompt', {
                    prompt,
                    input,
                    model,
                    store: false,
                    session_id: sessionId
                });

                // Проверяем, что ответ существует и успешен
                if (!response) {
                    throw new Error('Не удалось получить ответ от сервера');
                }

                if (response.success === false) {
                    throw new Error(response.error || 'Ошибка при выполнении промпта');
                }

                // Если есть session_id, сохраняем результат в сессию
                if (sessionId && response.success) {
                    try {
                        await api_request('voicebot/save_custom_prompt_result', {
                            session_id: sessionId,
                            prompt: prompt,
                            input_type: inputType,
                            result: response
                        });
                    } catch (saveError) {
                        console.error('Ошибка при сохранении результата промпта:', saveError);
                        // Не выбрасываем ошибку, так как основной запрос выполнен успешно
                    }
                }

                return response;
            } catch (error) {
                console.error('Ошибка при запуске промпта:', error);
                throw error;
            }
        }

    })
})
