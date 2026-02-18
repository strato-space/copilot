import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useContext = create(
    persist(
        (set, get) => ({
            // Состояние
            contextItems: [], // Массив элементов контекста

            // Действия
            addFileToContext: (file) => {
                console.log('Adding file to context:', file);

                const { contextItems } = get();

                // Проверяем, не добавлен ли уже этот файл
                const existingFile = contextItems.find(
                    item => item.type === 'file' &&
                        item.data._id === file._id
                );

                if (existingFile) {
                    return; // Файл уже в контексте
                }

                const contextItem = {
                    id: `file_${file._id}_${Date.now()}`,
                    type: 'file',
                    data: file,
                    title: file.file_name,
                    description: `Файл: ${file.file_name}`,
                    addedAt: new Date().toISOString()
                };

                set({
                    contextItems: [...contextItems, contextItem]
                });
            },

            addSessionToContext: (session) => {
                console.log('Adding session to context:', session);
                const { contextItems } = get();

                // Проверяем, не добавлена ли уже эта сессия
                const existingSession = contextItems.find(
                    item => item.type === 'session' &&
                        item.data._id === session._id
                );

                if (existingSession) {
                    return; // Сессия уже в контексте
                }

                const contextItem = {
                    id: `session_${session._id}_${Date.now()}`,
                    type: 'session',
                    data: { _id: session._id },
                    title: session.session_name || `Сессия ${session._id}`,
                    description: `Транскрипция: ${session.session_name || session._id}`,
                    addedAt: new Date().toISOString()
                };

                set({
                    contextItems: [...contextItems, contextItem]
                });
            },

            addTextToContext: (text, source = null) => {
                const { contextItems } = get();

                // Обрезаем текст если он слишком длинный
                const trimmedText = text.length > 500 ?
                    text.substring(0, 500) + '...' : text;

                const contextItem = {
                    id: `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'text',
                    data: {
                        text: text,
                        source: source
                    },
                    title: trimmedText.length > 50 ?
                        trimmedText.substring(0, 50) + '...' : trimmedText,
                    description: `Текстовый фрагмент${source ? ` из ${source.name}` : ''}`,
                    addedAt: new Date().toISOString()
                };

                set({
                    contextItems: [...contextItems, contextItem]
                });
            },

            removeFromContext: (itemId) => {
                const { contextItems } = get();
                set({
                    contextItems: contextItems.filter(item => item.id !== itemId)
                });
            },

            clearContext: () => {
                set({
                    contextItems: []
                });
            },

            // Получить весь контекст в виде строки для отправки на обработку
            getContextAsString: () => {
                const { contextItems } = get();

                return contextItems.map(item => {
                    switch (item.type) {
                        case 'file':
                            return `[ФАЙЛ: ${item.data.filename || item.data.name}]`;
                        case 'session':
                            return `[ТРАНСКРИПЦИЯ: ${item.data.title || item.data.id}]`;
                        case 'text':
                            return `[ТЕКСТ]: ${item.data.text}`;
                        default:
                            return `[${item.type.toUpperCase()}]: ${item.title}`;
                    }
                }).join('\n\n');
            },

            getContextItems: () => {
                return get().contextItems;
            },

            prepareContextForRequest: () => {
                const { contextItems } = get();
                return contextItems.map(item => {
                    switch (item.type) {
                        case 'file':
                            return {
                                type: 'file',
                                file_id: item.data.file_id,
                                url: item.data.web_view_link,
                                mime_type: item.data.mime_type,
                            };
                        case 'session':
                            return {
                                type: 'session',
                                _id: item.data._id,
                            };
                        case 'text':
                            return {
                                type: 'text',
                                text: item.data.text,
                                source: item.data.source
                            };
                        default:
                            return {
                                type: item.type,
                                data: item.data
                            };
                    }
                });
            },

            // Получить количество элементов в контексте
            getContextCount: () => {
                const { contextItems } = get();
                return contextItems.length;
            }
        }),
        {
            name: 'context-storage', // Ключ для localStorage
            partialize: (state) => ({
                contextItems: state.contextItems
            }) // Сохраняем только contextItems
        }
    )
);

export { useContext };
