import React, { useState, useEffect } from 'react';
import { Card, Typography, Spin, Alert, Button } from 'antd';
import { EyeOutlined, CodeOutlined } from '@ant-design/icons';
import { useFilesPreview } from '../../store/files_preview';

const { Text } = Typography;

const MarkdownPreview = ({ file }) => {
    const [viewMode, setViewMode] = useState('preview'); // 'preview' или 'raw'
    const [decodedContent, setDecodedContent] = useState('');
    const [parseError, setParseError] = useState(null);

    // Используем store для управления состоянием файлов
    const { fetchFileContent, getFileContent } = useFilesPreview();

    // Получаем данные из store
    const fileData = getFileContent(file?.file_id);
    const { content = '', loading = false, error = null, contentType = null } = fileData;

    useEffect(() => {
        if (file && file.file_id && !content && !loading && !error) {
            fetchFileContent(file.file_id).catch(() => {
                // Ошибка уже обрабатывается в store
            });
        }
    }, [file, content, loading, error, fetchFileContent]);

    useEffect(() => {
        if (content) {
            if (contentType === 'binary_base64') {
                decodeBase64Content(content);
            } else {
                // Если контент уже в текстовом формате
                setDecodedContent(content);
                setParseError(null);
            }
        }
    }, [content, contentType]);

    const decodeBase64Content = (base64Content) => {
        try {
            setParseError(null);

            // Проверяем, что содержимое файла не пустое
            if (!base64Content || base64Content === 'e30=') {
                setParseError(
                    'Файл не был загружен с Google Drive. ' +
                    'Бэкенд вернул пустое содержимое (e30= = {}). ' +
                    'Проблема может быть в правах доступа к Google Drive API или в методе загрузки файла на сервере.'
                );
                return;
            }

            // Очищаем base64 строку от возможных символов переноса строк и пробелов
            const cleanBase64Content = base64Content.replace(/\s/g, '');

            // Декодируем base64 в текст
            const decodedText = atob(cleanBase64Content);
            setDecodedContent(decodedText);

        } catch (err) {
            console.error('Error decoding base64 content:', err);
            setParseError('Ошибка при декодировании содержимого файла: ' + err.message);
        }
    };

    const refetchContent = () => {
        if (file && file.file_id) {
            setDecodedContent('');
            setParseError(null);
            fetchFileContent(file.file_id).catch(() => {
                // Ошибка уже обрабатывается в store
            });
        }
    };

    // Простой рендерер Markdown (базовая поддержка)
    const renderMarkdown = (text) => {
        if (!text) return '';

        let html = text
            // Заголовки
            .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
            .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>')
            .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')

            // Жирный и курсивный текст
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')

            // Код
            .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">$1</code>')

            // Ссылки
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 underline" target="_blank" rel="noopener noreferrer">$1</a>')

            // Списки (упрощенная версия)
            .replace(/^- (.*$)/gm, '<li class="ml-4">• $1</li>')
            .replace(/^(\d+)\. (.*$)/gm, '<li class="ml-4">$1. $2</li>')

            // Переносы строк
            .replace(/\n\n/g, '</p><p class="mb-2">')
            .replace(/\n/g, '<br/>');

        // Оборачиваем в параграфы
        html = `<p class="mb-2">${html}</p>`;

        return html;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Spin size="large" />
                <Text className="ml-2">Загрузка содержимого файла...</Text>
            </div>
        );
    }

    if (error) {
        return (
            <Alert
                message="Ошибка загрузки файла"
                description={
                    <div>
                        <p>{error}</p>
                        <Button
                            type="link"
                            onClick={refetchContent}
                            className="p-0"
                        >
                            Попробовать еще раз
                        </Button>
                        <br />
                        <a
                            href={file.web_view_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 underline"
                        >
                            Открыть в Google Drive
                        </a>
                    </div>
                }
                type="error"
                showIcon
            />
        );
    }

    if (parseError) {
        return (
            <Alert
                message="Ошибка обработки файла"
                description={
                    <div>
                        <p>{parseError}</p>
                        <Button
                            type="link"
                            onClick={refetchContent}
                            className="p-0"
                        >
                            Попробовать еще раз
                        </Button>
                        <br />
                        {file.web_view_link && (
                            <a
                                href={file.web_view_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 underline"
                            >
                                Открыть в Google Drive
                            </a>
                        )}
                    </div>
                }
                type="warning"
                showIcon
            />
        );
    }

    return (
        <div className="h-full">
            {/* Переключатель режимов */}
            <div className="flex justify-end mb-3 border-b pb-2">
                <Button.Group>
                    <Button
                        type={viewMode === 'preview' ? 'primary' : 'default'}
                        icon={<EyeOutlined />}
                        onClick={() => setViewMode('preview')}
                        size="small"
                    >
                        Предварительный просмотр
                    </Button>
                    <Button
                        type={viewMode === 'raw' ? 'primary' : 'default'}
                        icon={<CodeOutlined />}
                        onClick={() => setViewMode('raw')}
                        size="small"
                    >
                        Исходный код
                    </Button>
                </Button.Group>
            </div>

            {/* Содержимое */}
            <div className="max-h-96 overflow-y-auto">
                {viewMode === 'preview' ? (
                    <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{
                            __html: renderMarkdown(decodedContent)
                        }}
                    />
                ) : (
                    <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded border font-mono">
                        {decodedContent}
                    </pre>
                )}
            </div>

            {/* Информация о файле */}
            <div className="mt-4 pt-3 border-t text-xs text-gray-500">
                <Text type="secondary">
                    Размер: {file.file_size ? `${Math.round(file.file_size / 1024)} KB` : 'Неизвестно'} |
                    Строк: {decodedContent.split('\n').length} |
                    Символов: {decodedContent.length}
                </Text>
            </div>
        </div>
    );
};

export default MarkdownPreview;
