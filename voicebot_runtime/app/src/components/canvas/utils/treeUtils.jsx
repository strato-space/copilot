import React from 'react';
import { Checkbox, Tooltip } from 'antd';
import {
    ProjectOutlined,
    FolderOutlined,
    FileOutlined
} from '@ant-design/icons';

// Функция для получения инициалов
export const getInitials = (fullName) => {
    if (!fullName) return '';
    const parts = fullName.split(' ');
    if (parts.length === 1) return parts[0]; // Только фамилия

    const surname = parts[0]; // Фамилия
    const initials = parts.slice(1)
        .map(name => name.charAt(0).toUpperCase())
        .join('.');

    return initials ? `${surname} ${initials}.` : surname;
};

// Функция для форматирования даты в формате dd.mm
export const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${day}.${month}`;
};

// Функция для получения расширения файла по MIME типу
export const getFileExtensionFromMimeType = (mimeType, filename = '') => {
    if (!mimeType) {
        // Если MIME тип отсутствует, не показываем расширение
        return '';
    }

    // Сопоставление MIME типов с расширениями
    const mimeToExtension = {
        // Документы
        'application/pdf': '.pdf',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'text/plain': '.txt',
        'text/html': '.html',
        'text/css': '.css',
        'application/rtf': '.rtf',
        'application/vnd.oasis.opendocument.text': '.odt',
        'application/vnd.oasis.opendocument.spreadsheet': '.ods',
        'application/vnd.oasis.opendocument.presentation': '.odp',
        // Google Apps
        'application/vnd.google-apps.document': '.gdoc',
        'application/vnd.google-apps.spreadsheet': '.gsheet',
        'application/vnd.google-apps.presentation': '.gslides',
        'application/vnd.google-apps.form': '.gform',
        'application/vnd.google-apps.drawing': '.gdraw',

        // Изображения
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
        'image/svg+xml': '.svg',
        'image/webp': '.webp',
        'image/tiff': '.tiff',
        'image/x-icon': '.ico',

        // Аудио
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/ogg': '.ogg',
        'audio/webm': '.webm',
        'audio/mp4': '.m4a',
        'audio/aac': '.aac',
        'audio/flac': '.flac',

        // Видео
        'video/mp4': '.mp4',
        'video/mpeg': '.mpeg',
        'video/quicktime': '.mov',
        'video/x-msvideo': '.avi',
        'video/webm': '.webm',
        'video/ogg': '.ogv',

        // Архивы
        'application/zip': '.zip',
        'application/x-rar-compressed': '.rar',
        'application/x-tar': '.tar',
        'application/gzip': '.gz',
        'application/x-7z-compressed': '.7z',

        // Программирование
        'application/javascript': '.js',
        'application/json': '.json',
        'application/xml': '.xml',
        'text/javascript': '.js',

        // Другие
        'application/octet-stream': '',
    };

    const extension = mimeToExtension[mimeType.toLowerCase()];
    if (extension !== undefined) {
        return extension;
    }

    // Если точного соответствия нет, пробуем определить по основному типу
    const mainType = mimeType.split('/')[0].toLowerCase();
    switch (mainType) {
        case 'text':
            return '.txt';
        case 'image':
            return '.img';
        case 'audio':
            return '.audio';
        case 'video':
            return '.video';
        default:
            // Если MIME тип неизвестен, не показываем расширение
            return '';
    }
};

// Функция для получения расширения файла (оставлена для совместимости)
export const getFileExtension = (filename) => {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : '';
};

// Функция для генерации иконок в дереве
export const getTreeIcon = (node, onAddToContext) => {
    switch (node.type) {
        case 'project':
            return <ProjectOutlined className="text-blue-500" />;
        case 'folder':
        case 'group':
        case 'sessions-folder':
            return <FolderOutlined className="text-yellow-500" />;
        case 'file':
            return <FileOutlined className="text-green-500" />;
        case 'session':
            return <FileOutlined className="text-purple-500" />;
        default:
            return null;
    }
};

// Функция для рендеринга заголовка файла или сессии
export const renderFileOrSessionTitle = (node, onAddToContext, isInContext = false) => {
    const isFile = node.type === 'file';
    const isSession = node.type === 'session';

    if (!isFile && !isSession) {
        return (
            <div className="flex items-center justify-between w-full group">
                <span className="flex-1 font-medium">{node.title}</span>
                <div className="flex items-center gap-1">
                    {(node.type === 'project' || node.type === 'group' || node.type === 'sessions-folder') && (
                        <span className="text-xs text-gray-500">
                            ({node.children?.length || 0} элементов)
                        </span>
                    )}
                </div>
            </div>
        );
    }

    // Получаем дату создания
    const createdDate = formatDate(node.data?.created_time || node.data?.created_at);

    // Для файлов - получаем расширение по MIME типу
    const fileExtension = isFile ? getFileExtensionFromMimeType(
        node.data?.mime_type || node.data?.mimeType,
        node.data?.file_name || node.title
    ) : '';

    // Для сессий - получаем количество сообщений (пробуем разные поля)
    const messageCount = isSession ?
        (node.data?.messages_count ||
            node.data?.message_count ||
            node.data?.messages?.length ||
            node.data?.total_messages ||
            0) : 0;

    const handleCheckboxChange = (e) => {
        e.stopPropagation();
        if (onAddToContext) {
            onAddToContext(node);
        }
    };

    return (
        <div className="flex items-start gap-2 w-full group">
            {/* Дата создания */}
            {createdDate && (
                <span className="text-xs text-gray-400 font-mono min-w-[35px]">
                    {createdDate}
                </span>
            )}

            {/* Название */}
            <Tooltip title={node.title} placement="top">
                <span className="text-xs w-[150px] overflow-hidden text-ellipsis whitespace-nowrap cursor-default">
                    {node.title}
                </span>
            </Tooltip>

            {/* Дополнительная информация */}
            <div className="flex items-center gap-2">

                {/* Checkbox для добавления в контекст */}
                {onAddToContext && (
                    <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                            checked={isInContext}
                            onChange={handleCheckboxChange}
                            size="small"
                            className="opacity-60 group-hover:opacity-100 transition-opacity"
                        />
                    </div>
                )}

                {/* Количество сообщений для сессии */}
                {isSession && messageCount > 0 && (
                    <span className="text-xs text-gray-500">
                        {messageCount}
                    </span>
                )}

                {/* Расширение файла */}
                {isFile && fileExtension && (
                    <span className="text-xs text-gray-500 font-mono">
                        {fileExtension}
                    </span>
                )}

            </div>
        </div>
    );
};

// Функция для форматирования данных дерева для отображения
export const formatTreeData = (treeData, onAddToContext = null, contextItems = []) => {
    if (!Array.isArray(treeData)) return [];

    return treeData.map(node => {
        // Проверяем, есть ли элемент в контексте
        const isInContext = contextItems.some(item => {
            if (node.type === 'file' && item.type === 'file') {
                return item.data?._id === node.data?._id;
            }
            if (node.type === 'session' && item.type === 'session') {
                return item.data?._id === node.data?._id;
            }
            return false;
        });

        return {
            ...node,
            icon: getTreeIcon(node, onAddToContext),
            title: renderFileOrSessionTitle(node, onAddToContext, isInContext),
            children: node.children ? formatTreeData(node.children, onAddToContext, contextItems) : undefined
        };
    });
};
