import React, { useState, useEffect } from 'react';
import { Typography, Spin, Alert, Button } from 'antd';
import { EyeOutlined, CodeOutlined, FileWordOutlined } from '@ant-design/icons';
import mammoth from 'mammoth';
import { useFilesPreview } from '../../store/files_preview';

const { Text } = Typography;

const DocxPreview = ({ file }) => {
    const [htmlContent, setHtmlContent] = useState('');
    const [rawContent, setRawContent] = useState('');
    const [parseError, setParseError] = useState(null);
    const [viewMode, setViewMode] = useState('preview'); // 'preview' или 'raw'

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
        if (content && contentType === 'binary_base64') {
            parseDocxFile(content);
        }
    }, [content, contentType]);

    const parseDocxFile = async (base64Content) => {
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

            // Проверяем валидность base64 строки
            const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
            if (!base64Regex.test(cleanBase64Content)) {
                setParseError(`Некорректный формат base64 данных. Длина: ${cleanBase64Content.length}, первые символы: "${cleanBase64Content.substring(0, 50)}..."`);
                return;
            }

            // Конвертируем base64 обратно в ArrayBuffer для mammoth
            let binaryString;
            try {
                binaryString = atob(cleanBase64Content);
            } catch (atobError) {
                console.error('Base64 decode error:', atobError);
                setParseError(`Ошибка декодирования base64: ${atobError.message}`);
                return;
            }

            // Проверяем размер декодированных данных
            if (binaryString.length < 100) {
                setParseError(`Слишком маленький размер файла после декодирования: ${binaryString.length} байт. Возможно файл поврежден или не загружен полностью.`);
                return;
            }

            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Проверяем сигнатуру DOCX файла (ZIP архив)
            const signature = Array.from(bytes.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
            console.log('File signature:', signature);

            // DOCX файлы должны начинаться с ZIP signature: 50 4B 03 04 или 50 4B 05 06 или 50 4B 07 08
            if (!signature.toLowerCase().startsWith('504b')) {
                console.warn('Warning: File signature does not match ZIP format, but attempting to parse anyway');
            }

            // Парсим DOCX файл с помощью mammoth
            const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });

            setHtmlContent(result.value);

            // Сохраняем также текстовую версию для режима "raw"
            const textResult = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
            setRawContent(textResult.value);

            // Логируем предупреждения mammoth если есть
            if (result.messages && result.messages.length > 0) {
                console.warn('Mammoth conversion warnings:', result.messages);
            }

        } catch (err) {
            console.error('Error parsing DOCX file:', err);
            setParseError('Ошибка при парсинге DOCX файла: ' + err.message);
        }
    };

    const refetchContent = () => {
        if (file && file.file_id) {
            setHtmlContent('');
            setRawContent('');
            setParseError(null);

            fetchFileContent(file.file_id).catch(() => {
                // Ошибка уже обрабатывается в store
            });
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Spin size="large" />
                <Text className="ml-2">Загрузка DOCX файла...</Text>
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
                type="error"
                showIcon
            />
        );
    }

    if (parseError) {
        return (
            <Alert
                message="Ошибка парсинга DOCX файла"
                description={
                    <div className="space-y-3">
                        <p>{parseError}</p>
                        <div className="space-y-2">
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
                                    className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                                >
                                    Открыть в Google Docs
                                </a>
                            )}
                        </div>
                    </div>
                }
                type="warning"
                showIcon
            />
        );
    }

    if (!content) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                <FileWordOutlined className="text-6xl mb-4" />
                <Text type="secondary">Файл пустой или недоступен</Text>
            </div>
        );
    }

    if (!htmlContent && !rawContent) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                <FileWordOutlined className="text-6xl mb-4" />
                <Text type="secondary">DOCX файл не содержит читаемого содержимого</Text>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">
            {/* Переключатель режимов и информация */}
            <div className="flex justify-between items-center mb-3 border-b pb-2 px-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <FileWordOutlined className="text-blue-500" />
                    <Text strong>DOCX документ:</Text>
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
                            Текст
                        </Button>
                    </Button.Group>
                </div>

                <div className="text-sm text-gray-500">
                    {viewMode === 'preview' ? 'HTML версия' : 'Текстовая версия'}
                </div>
            </div>

            {/* Содержимое документа */}
            <div className="overflow-auto w-full p-4" style={{ height: 'calc(100vh - 60px)' }}>
                {viewMode === 'preview' ? (
                    <div
                        className="prose prose-sm max-w-none docx-content"
                        dangerouslySetInnerHTML={{
                            __html: htmlContent
                        }}
                    />
                ) : (
                    <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded border font-mono">
                        {rawContent}
                    </pre>
                )}
            </div>

            {/* Информация о файле */}
            <div className="mt-3 pt-3 border-t text-xs text-gray-500 px-4 flex-shrink-0">
                <Text type="secondary">
                    Размер: {file.file_size ? `${Math.round(file.file_size / 1024)} KB` : 'Неизвестно'} |
                    Символов: {rawContent.length} |
                    Режим: {viewMode === 'preview' ? 'HTML' : 'Текст'}
                </Text>
            </div>

            <style jsx>{`
                .docx-content {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                    line-height: 1.6;
                }
                .docx-content h1, .docx-content h2, .docx-content h3, .docx-content h4, .docx-content h5, .docx-content h6 {
                    margin-top: 1.5em;
                    margin-bottom: 0.5em;
                    font-weight: 600;
                }
                .docx-content p {
                    margin-bottom: 1em;
                }
                .docx-content ul, .docx-content ol {
                    margin: 1em 0;
                    padding-left: 2em;
                }
                .docx-content table {
                    border-collapse: collapse;
                    width: 100%;
                    margin: 1em 0;
                }
                .docx-content table td, .docx-content table th {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: left;
                }
                .docx-content table th {
                    background-color: #f5f5f5;
                    font-weight: 600;
                }
                .docx-content strong {
                    font-weight: 600;
                }
                .docx-content em {
                    font-style: italic;
                }
            `}</style>
        </div>
    );
};

export default DocxPreview;
