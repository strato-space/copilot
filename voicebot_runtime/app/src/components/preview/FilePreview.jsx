import React, { useRef } from 'react';
import { Card, Typography, Alert, Spin, Button } from 'antd';
import {
    FileTextOutlined,
    FileExcelOutlined,
    FilePdfOutlined,
    FileImageOutlined,
    FileWordOutlined,
    FileOutlined,
    FolderOpenOutlined
} from '@ant-design/icons';

import MarkdownPreview from './MarkdownPreview';
import ExcelPreview from './ExcelPreview';
import DocxPreview from './DocxPreview';
import GoogleFilePreview from './GoogleFilePreview';
import SessionPreview from './SessionPreview';
import TextSelectionHandler from '../canvas/TextSelectionHandler';
import { useProjectFiles } from '../../store/project_files';
import { useRequest } from '../../store/request';

const { Title, Text } = Typography;

const FilePreview = () => {
    const { selectedFile, selectedSession } = useProjectFiles();
    const { loading } = useRequest();
    const previewContainerRef = useRef(null);

    // Если выбрана сессия, показываем SessionPreview
    if (selectedSession) {
        return <SessionPreview />;
    }

    const file = selectedFile;
    if (loading) {
        return (
            <Card className="h-full">
                <div className="flex items-center justify-center h-96">
                    <Spin size="large" />
                </div>
            </Card>
        );
    }

    if (!file) {
        return (
            <Card className="h-full">
                <div className="flex flex-col items-center justify-center h-96 text-gray-500">
                    <FileOutlined className="text-6xl mb-4" />
                    <Text type="secondary">Выберите файл для предварительного просмотра</Text>
                </div>
            </Card>
        );
    }

    // Определение типа файла по расширению и mime-типу
    const getFileType = (fileName, mimeType) => {
        // Сначала проверяем mime-тип для Google Workspace файлов
        if (mimeType) {
            const mimeTypeMap = {
                'application/vnd.google-apps.document': 'google-doc',
                'application/vnd.google-apps.spreadsheet': 'google-sheet',
                'application/vnd.google-apps.presentation': 'google-slide',
                'application/vnd.google-apps.form': 'google-form',
                'application/vnd.google-apps.drawing': 'google-drawing',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
                'application/pdf': 'pdf',
                'text/plain': 'text',
                'text/markdown': 'markdown',
                'image/jpeg': 'image',
                'image/png': 'image',
                'image/gif': 'image',
                'image/svg+xml': 'image'
            };

            if (mimeTypeMap[mimeType]) {
                return mimeTypeMap[mimeType];
            }
        }

        // Fallback на определение по расширению
        if (!fileName) return 'unknown';

        const extension = fileName.toLowerCase().split('.').pop();

        const typeMap = {
            // Markdown
            'md': 'markdown',
            'markdown': 'markdown',
            'txt': 'text',

            // Excel
            'xlsx': 'excel',
            'xls': 'excel',
            'csv': 'csv',

            // Images
            'jpg': 'image',
            'jpeg': 'image',
            'png': 'image',
            'gif': 'image',
            'svg': 'image',
            'webp': 'image',

            // PDF
            'pdf': 'pdf',

            // Documents  
            'doc': 'document',
            'docx': 'docx',
            'rtf': 'document',

            // Google Workspace (fallback по расширению - обычно не имеют расширений)
            'gdoc': 'google-doc',
            'gsheet': 'google-sheet',

            // Code
            'js': 'code',
            'jsx': 'code',
            'ts': 'code',
            'tsx': 'code',
            'html': 'code',
            'css': 'code',
            'json': 'code',
            'xml': 'code',
            'py': 'code',
            'java': 'code',
            'cpp': 'code',
            'c': 'code'
        };

        return typeMap[extension] || 'unknown';
    };

    // Получение иконки по типу файла
    const getFileIcon = (fileType) => {
        const iconMap = {
            markdown: <FileTextOutlined className="text-blue-500" />,
            text: <FileTextOutlined className="text-gray-500" />,
            excel: <FileExcelOutlined className="text-green-500" />,
            csv: <FileExcelOutlined className="text-green-500" />,
            docx: <FileWordOutlined className="text-blue-600" />,
            'google-doc': <FileWordOutlined className="text-blue-500" />,
            'google-sheet': <FileExcelOutlined className="text-green-600" />,
            'google-slide': <FileTextOutlined className="text-orange-500" />,
            'google-form': <FileTextOutlined className="text-purple-500" />,
            'google-drawing': <FileImageOutlined className="text-red-500" />,
            image: <FileImageOutlined className="text-purple-500" />,
            pdf: <FilePdfOutlined className="text-red-500" />,
            document: <FileTextOutlined className="text-blue-600" />,
            code: <FileTextOutlined className="text-orange-500" />,
            unknown: <FileOutlined className="text-gray-400" />
        };

        return iconMap[fileType] || iconMap.unknown;
    };

    const fileType = getFileType(file.file_name, file.mime_type);
    const fileIcon = getFileIcon(fileType);

    // Вспомогательная функция для отображения названий типов файлов
    const getFileTypeDisplayName = (type) => {
        const displayNames = {
            excel: 'Excel',
            csv: 'CSV',
            docx: 'Word документ',
            'google-doc': 'Google Docs',
            'google-sheet': 'Google Sheets',
            'google-slide': 'Google Slides',
            'google-form': 'Google Forms',
            'google-drawing': 'Google Drawings',
            pdf: 'PDF',
            image: 'изображение',
            document: 'документ',
            code: 'код',
            unknown: 'неизвестный'
        };
        return displayNames[type] || type;
    };

    // Рендер соответствующего компонента предварительного просмотра
    const renderPreview = () => {
        // Показываем предварительный просмотр для текстовых файлов
        if (fileType === 'markdown' || fileType === 'text') {
            return <MarkdownPreview file={file} />;
        }

        // Показываем предварительный просмотр для Excel файлов
        if (fileType === 'excel') {
            return <ExcelPreview file={file} />;
        }

        // Показываем предварительный просмотр для DOCX файлов
        if (fileType === 'docx') {
            return <DocxPreview file={file} />;
        }

        // Обработка Google Workspace файлов
        if (fileType.startsWith('google-')) {
            return <GoogleFilePreview file={file} />;
        }        // Для всех остальных файлов показываем заглушку с ссылкой

        return (
            <div className="p-8">
                <div className="text-center">
                    <div className="text-6xl mb-4 text-gray-300">
                        {fileIcon}
                    </div>
                    <Alert
                        message={`Файл типа "${getFileTypeDisplayName(fileType)}"`}
                        description={
                            <div className="space-y-3">
                                <p>Предварительный просмотр недоступен для данного типа файла.</p>
                                <div className="space-y-2">
                                    {file.web_view_link && (
                                        <div>
                                            <a
                                                href={file.web_view_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                                            >
                                                Открыть в Google Drive
                                            </a>
                                        </div>
                                    )}
                                    {file.web_content_link && (
                                        <div>
                                            <a
                                                href={file.web_content_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-block px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                                            >
                                                Скачать файл
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        }
                        type="info"
                        showIcon={false}
                        className="text-left"
                    />
                </div>
            </div>
        );
    };

    return (
        <Card
            title={
                <div className="flex items-center space-x-2">
                    {fileIcon}
                    <span className="truncate">{file.file_name}</span>
                    <div className="text-sm text-gray-500">
                        {file.file_size && `${Math.round(file.file_size / 1024)} KB`}
                    </div>
                </div>
            }
            extra={
                <div className='flex items-center gap-2'>
                    {file.web_view_link && (
                        <Button
                            type="link"
                            icon={<FolderOpenOutlined />}
                            href={file.web_view_link}
                            target="_blank"
                            className="p-0 h-auto"
                        >
                            Открыть в Google Drive
                        </Button>
                    )}

                </div>
            }
            className="h-full w-full overflow-hidden"
            styles={{ body: { height: 'calc(100vh - 60px)', overflow: 'hidden', padding: 0 } }}
        >
            <div ref={previewContainerRef} className="h-full w-full overflow-hidden p-4 relative">
                {renderPreview()}
                {/* TextSelectionHandler для обработки выделения текста */}
                <TextSelectionHandler
                    containerRef={previewContainerRef}
                    source={{
                        type: "file",
                        file_id: file.file_id,
                        name: file.file_name ?? 'Файл',
                        url: file.web_view_link,
                        mime_type: file.mime_type,
                    }}
                />
            </div>
        </Card>
    );
};

export default FilePreview;
