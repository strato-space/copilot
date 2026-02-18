import { create } from 'zustand';
import { useRequest } from './request';

export const useFilesPreview = create((set, get) => {
    const api_request = useRequest.getState().api_request;

    return {
        // Состояние для содержимого файлов
        fileContents: {}, // { fileId: { content, loading, error, contentType } }

        // Загрузка содержимого файла
        fetchFileContent: async (fileId) => {
            try {
                // Устанавливаем состояние загрузки
                set(state => ({
                    fileContents: {
                        ...state.fileContents,
                        [fileId]: {
                            ...state.fileContents[fileId],
                            loading: true,
                            error: null
                        }
                    }
                }));

                const response = await api_request('voicebot/get_file_content', { file_id: fileId });

                // Логируем ответ для отладки
                console.log('Backend response for file', fileId, ':', {
                    success: response?.success,
                    content_type: response?.content_type,
                    content_length: response?.content?.length || 0,
                    content_preview: response?.content?.substring(0, 100) + '...',
                    size: response?.size,
                    mime_type: response?.mime_type,
                    file_name: response?.file_name
                });

                if (response?.success && response?.content) {
                    let content = '';

                    if (response.content_type === 'binary_base64') {
                        // Для бинарных файлов сохраняем base64 как есть - декодирование будет в компоненте
                        content = response.content;
                    } else if (response.content_type === 'text') {
                        // Обратная совместимость
                        content = response.content;
                    } else if (response.content_type === 'link') {
                        throw new Error(response.message || 'Файл доступен только по ссылке');
                    } else {
                        throw new Error('Неподдерживаемый тип содержимого файла');
                    }

                    // Сохраняем успешно загруженное содержимое
                    set(state => ({
                        fileContents: {
                            ...state.fileContents,
                            [fileId]: {
                                content,
                                contentType: response.content_type,
                                loading: false,
                                error: null
                            }
                        }
                    }));

                    return { content, contentType: response.content_type };
                } else {
                    throw new Error(response?.message || 'Не удалось загрузить содержимое файла');
                }
            } catch (err) {
                console.error('Error fetching file content:', err);
                const errorMessage = err.message || 'Неизвестная ошибка';

                // Сохраняем ошибку
                set(state => ({
                    fileContents: {
                        ...state.fileContents,
                        [fileId]: {
                            ...state.fileContents[fileId],
                            loading: false,
                            error: errorMessage
                        }
                    }
                }));

                throw err;
            }
        },

        // Получение содержимого файла из кэша
        getFileContent: (fileId) => {
            return get().fileContents[fileId] || { content: '', loading: false, error: null, contentType: null };
        },

        // Очистка содержимого файла
        clearFileContent: (fileId) => {
            set(state => {
                const newFileContents = { ...state.fileContents };
                delete newFileContents[fileId];
                return { fileContents: newFileContents };
            });
        },

        // Очистка всего кэша
        clearAllFileContents: () => {
            set({ fileContents: {} });
        }
    };
});