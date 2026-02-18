import React, { useState } from 'react';
import { Card, Button, Tooltip, Badge, Typography, Empty, Space, Collapse, Tag } from 'antd';
import {
    DeleteOutlined,
    ClearOutlined,
    FileOutlined,
    AudioOutlined,
    FileTextOutlined,
    CopyOutlined,
    DownloadOutlined,
    EyeOutlined
} from '@ant-design/icons';
import { useContext } from '../../store/context';

const { Text, Paragraph } = Typography;
const { Panel } = Collapse;

const ContextDisplay = () => {
    const {
        contextItems,
        removeFromContext,
        clearContext,
        getContextAsString,
        getContextCount
    } = useContext();

    const [expandedItems, setExpandedItems] = useState([]);

    // CSS для принудительного скролла
    const scrollContainerStyle = {
        height: '700px',
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'scroll',
        overflowX: 'hidden',
        border: '1px solid #f0f0f0',
        borderRadius: '6px',
        padding: '8px'
    };

    const handleExpandChange = (keys) => {
        setExpandedItems(keys);
    };

    const handleCopyContext = async () => {
        const contextString = getContextAsString();
        try {
            await navigator.clipboard.writeText(contextString);
            // Можно добавить notification об успешном копировании
        } catch (err) {
            console.error('Failed to copy context:', err);
        }
    };

    const handleExportContext = () => {
        const contextString = getContextAsString();
        const blob = new Blob([contextString], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `context_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const getItemIcon = (type) => {
        switch (type) {
            case 'file':
                return <FileOutlined className="text-blue-500" />;
            case 'session':
                return <AudioOutlined className="text-purple-500" />;
            case 'text':
                return <FileTextOutlined className="text-green-500" />;
            default:
                return <FileOutlined className="text-gray-500" />;
        }
    };

    const getItemTypeLabel = (type) => {
        switch (type) {
            case 'file':
                return 'Файл';
            case 'session':
                return 'Транскрипция';
            case 'text':
                return 'Текст';
            default:
                return 'Элемент';
        }
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Определение типа файла по расширению и mime-типу (из FilePreview)
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

            // Google Workspace
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

    // Получение человекочитаемого названия типа файла
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
            image: 'Изображение',
            document: 'Документ',
            code: 'Код',
            markdown: 'Markdown',
            text: 'Текстовый файл',
            unknown: 'Неизвестный'
        };
        return displayNames[type] || type;
    };

    const renderContextItem = (item) => {
        const isText = item.type === 'text';

        return (
            <Card
                key={item.id}
                size="small"
                className="mb-3 hover:shadow-md transition-shadow"
                styles={{ body: { padding: '12px' } }}
            >
                <div className="space-y-3">
                    {/* Заголовок элемента с кнопкой удаления */}
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="flex-shrink-0 text-lg">
                                {getItemIcon(item.type)}
                            </div>
                            <Text strong className="text-sm truncate">
                                {item.title}
                            </Text>
                        </div>
                        <Tooltip title="Удалить из контекста">
                            <Button
                                type="text"
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => removeFromContext(item.id)}
                                className="text-red-500 hover:text-red-700 flex-shrink-0"
                            />
                        </Tooltip>
                    </div>

                    {/* Тег с типом и описание */}
                    <div className="space-y-2">
                        <Tag size="small" color={
                            item.type === 'file' ? 'blue' :
                                item.type === 'session' ? 'purple' : 'green'
                        }>
                            {getItemTypeLabel(item.type)}
                        </Tag>
                        <Text type="secondary" className="text-xs block">
                            {item.description}
                        </Text>
                    </div>

                    {/* Дополнительная информация */}
                    <div className="space-y-2">
                        {/* Отображение содержимого файла */}
                        {item.type === 'file' && item.data && (
                            <div className="text-xs text-gray-600 space-y-1">
                                {item.data.file_size && (
                                    <div>Размер: {Math.round(item.data.file_size / 1024)} KB</div>
                                )}
                                {(item.data.mime_type || item.data.file_name) && (
                                    <div>Тип: {getFileTypeDisplayName(getFileType(item.data.file_name, item.data.mime_type))}</div>
                                )}
                            </div>
                        )}

                        {/* Отображение информации о сессии */}
                        {item.type === 'session' && item.data && (
                            <div className="text-xs text-gray-600 space-y-1">
                                {item.data.project?.name && (
                                    <div>Проект: {item.data.project.name}</div>
                                )}
                                {item.data.created_at && (
                                    <div>Создано: {formatDate(item.data.created_at)}</div>
                                )}
                            </div>
                        )}

                        {/* Развернутый текст для текстовых фрагментов */}
                        {isText && (
                            <div>
                                <Collapse
                                    ghost
                                    size="small"
                                    activeKey={expandedItems}
                                    onChange={handleExpandChange}
                                    className="custom-collapse"
                                >
                                    <Panel
                                        header={
                                            <Text className="text-xs text-blue-600">
                                                {expandedItems.includes(item.id) ? 'Скрыть текст' : 'Показать текст'}
                                            </Text>
                                        }
                                        key={item.id}
                                        showArrow={true}
                                    >
                                        <div className="bg-gray-50 p-3 rounded-md text-xs max-h-40 overflow-y-auto">
                                            <Paragraph
                                                className="text-xs mb-0 whitespace-pre-wrap"
                                                copyable={{
                                                    text: item.data.text,
                                                    tooltips: ['Копировать', 'Скопировано!']
                                                }}
                                            >
                                                {item.data.text}
                                            </Paragraph>
                                        </div>
                                        {item.data.source && (
                                            <div className="mt-2 text-xs text-gray-500">
                                                Источник: {item.data.source.name}
                                            </div>
                                        )}
                                    </Panel>
                                </Collapse>
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        );
    };

    if (contextItems.length === 0) {
        return (
            <Card
                title={
                    <div className="flex items-center gap-2">
                        <FileTextOutlined />
                        <span>Контекст</span>
                        <Badge count={0} className="ml-2" />
                    </div>
                }
                size="small"
                className="h-full flex flex-col"
                styles={{
                    body: {
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '12px'
                    }
                }}
            >
                <Empty
                    description="Контекст пуст"
                    className="text-xs"
                />
            </Card>
        );
    }
    console.log('Rendering ContextDisplay with items:', contextItems);
    return (
        <Card
            title={
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <FileTextOutlined />
                        <span>Контекст</span>
                        <Badge count={getContextCount()} className="ml-2" />
                    </div>
                    <Space size="small">
                        <Tooltip title="Копировать весь контекст">
                            <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={handleCopyContext}
                            />
                        </Tooltip>
                        <Tooltip title="Экспортировать контекст">
                            <Button
                                type="text"
                                size="small"
                                icon={<DownloadOutlined />}
                                onClick={handleExportContext}
                            />
                        </Tooltip>
                        <Tooltip title="Очистить весь контекст">
                            <Button
                                type="text"
                                size="small"
                                icon={<ClearOutlined />}
                                onClick={clearContext}
                                className="text-red-500 hover:text-red-700"
                            />
                        </Tooltip>
                    </Space>
                </div>
            }
            size="small"
            className="h-full"
            styles={{
                body: {
                    padding: '12px',
                    height: 'calc(100% - 57px)'
                }
            }}
        >
            <div
                style={scrollContainerStyle}
                className="space-y-2"
            >
                {contextItems.map(item => renderContextItem(item))}
            </div>
        </Card>
    );
};

export default ContextDisplay;
