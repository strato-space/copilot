import React from 'react';
import { Alert } from 'antd';
import {
    FileTextOutlined,
    FileExcelOutlined,
    FileImageOutlined,
    FormOutlined,
    PictureOutlined
} from '@ant-design/icons';

const GoogleFilePreview = ({ file }) => {
    const getGoogleFileTypeDisplayName = (mimeType) => {
        const googleDisplayNames = {
            'application/vnd.google-apps.document': 'Docs',
            'application/vnd.google-apps.spreadsheet': 'Sheets',
            'application/vnd.google-apps.presentation': 'Slides',
            'application/vnd.google-apps.form': 'Forms',
            'application/vnd.google-apps.drawing': 'Drawings'
        };
        return googleDisplayNames[mimeType] || 'Workspace';
    };

    const getFileIcon = (mimeType) => {
        const iconMap = {
            'application/vnd.google-apps.document': <FileTextOutlined className="text-blue-500" />,
            'application/vnd.google-apps.spreadsheet': <FileExcelOutlined className="text-green-600" />,
            'application/vnd.google-apps.presentation': <FileImageOutlined className="text-orange-500" />,
            'application/vnd.google-apps.form': <FormOutlined className="text-purple-500" />,
            'application/vnd.google-apps.drawing': <PictureOutlined className="text-red-500" />
        };
        return iconMap[mimeType] || <FileTextOutlined className="text-gray-400" />;
    };

    const getGoogleEmbedUrl = (fileId, mimeType) => {
        if (!fileId) return null;

        switch (mimeType) {
            case 'application/vnd.google-apps.document':
                return `https://docs.google.com/document/d/${fileId}/preview`;
            case 'application/vnd.google-apps.spreadsheet':
                return `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
            case 'application/vnd.google-apps.presentation':
                return `https://docs.google.com/presentation/d/${fileId}/preview`;
            default:
                return null;
        }
    };

    const embedUrl = getGoogleEmbedUrl(file.file_id, file.mime_type);
    const displayName = getGoogleFileTypeDisplayName(file.mime_type);
    const icon = getFileIcon(file.mime_type);

    if (embedUrl) {
        return (
            <div className="h-full w-full flex flex-col">
                {/* Заголовок с информацией */}
                <div className="flex justify-between items-center mb-3 border-b pb-2 px-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        {icon}
                        <span className="font-medium">Google {displayName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {file.web_view_link && (
                            <a
                                href={file.web_view_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-600 text-sm"
                            >
                                Открыть в новой вкладке ↗
                            </a>
                        )}
                    </div>
                </div>

                {/* Встроенный документ */}
                <div className="flex-1 w-full">
                    <iframe
                        src={embedUrl}
                        className="w-full h-full border-0"
                        title={`Google ${displayName} - ${file.file_name}`}
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                    />
                </div>

                {/* Информация о файле */}
                <div className="mt-3 pt-3 border-t text-xs text-gray-500 px-4 flex-shrink-0">
                    <span>
                        Google {displayName} |
                        Изменен: {file.modified_time ? new Date(file.modified_time).toLocaleDateString('ru-RU') : 'неизвестно'}
                    </span>
                </div>
            </div>
        );
    } else {
        // Fallback для неподдерживаемых типов Google файлов
        return (
            <div className="p-8">
                <div className="text-center">
                    <div className="text-6xl mb-4">
                        <span className="text-6xl">{icon}</span>
                    </div>
                    <Alert
                        message={`Google ${displayName}`}
                        description={
                            <div className="space-y-3">
                                <p>Встраивание недоступно для данного типа Google документа.</p>
                                <div className="space-y-2">
                                    {file.web_view_link && (
                                        <div>
                                            <a
                                                href={file.web_view_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-block px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors mr-2"
                                            >
                                                Открыть в Google {displayName}
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
    }
};

export default GoogleFilePreview;
