import { useEffect, useMemo, useState } from 'react';
import { Empty, Image, List, Space, Tag, Typography, Button, Tooltip, message } from 'antd';
import axios from 'axios';
import { CopyOutlined } from '@ant-design/icons';

import { useAuthStore } from '../../store/authStore';
import type { VoiceSessionAttachment } from '../../types/voice';

const { Text, Title } = Typography;

const formatTimestamp = (value: unknown): string | null => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const dateMs = numeric > 1e11 ? numeric : numeric * 1000;
    return new Date(dateMs).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

const toInt = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};

const isImageAttachment = (attachment: VoiceSessionAttachment): boolean => {
    if (typeof attachment.mimeType === 'string' && attachment.mimeType.startsWith('image/')) return true;
    const source = `${attachment.direct_uri || attachment.uri || attachment.url || ''}`.toLowerCase();
    return /(\.png|\.jpe?g|\.webp|\.gif|\.bmp|\.svg)$/i.test(source);
};

const isMessageAttachmentProxyPath = (src: string): boolean => {
    try {
        const parsed = new URL(src, window.location.origin);
        return parsed.pathname.startsWith('/api/voicebot/message_attachment/') || parsed.pathname.startsWith('/voicebot/message_attachment/');
    } catch {
        return src.startsWith('/api/voicebot/message_attachment/') || src.startsWith('/voicebot/message_attachment/');
    }
};

const toAbsoluteUrl = (value: string | null | undefined): string | null => {
    if (!value) return null;
    try {
        return new URL(value, window.location.origin).toString();
    } catch {
        return value;
    }
};

const getDisplayAttachmentUrl = (attachment: VoiceSessionAttachment): string | null => {
    const preferred = attachment.direct_uri || attachment.uri || attachment.url || null;
    return toAbsoluteUrl(preferred);
};

const toUrlPreviewText = (rawUrl: string | null): string => {
    if (!rawUrl) return 'Нет источника';
    const trimmed = rawUrl.trim();
    if (!trimmed.toLowerCase().startsWith('data:')) return trimmed;
    const commaIndex = trimmed.indexOf(',');
    const header = commaIndex >= 0 ? trimmed.slice(0, commaIndex) : trimmed;
    if (header.toLowerCase().includes(';base64')) return `${header},...`;
    return header;
};

const copyTextToClipboard = async (raw: string): Promise<boolean> => {
    const text = raw.trim();
    if (!text) return false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }
    if (typeof document !== 'undefined') {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textArea);
        return copied;
    }
    return false;
};

function AttachmentPreview({ attachment }: { attachment: VoiceSessionAttachment }) {
    const [isBroken, setIsBroken] = useState(false);
    const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const authToken = useAuthStore((state) => state.authToken);

    const src = useMemo(
        () => (attachment.direct_uri || attachment.uri || attachment.url || null),
        [attachment.direct_uri, attachment.uri, attachment.url]
    );

    const isMessageAttachmentProxy = useMemo(() => (src ? isMessageAttachmentProxyPath(src) : false), [src]);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;

        setIsBroken(false);
        setIsLoading(false);
        setResolvedSrc(null);

        const run = async (): Promise<void> => {
            if (!src || !isImageAttachment(attachment)) return;

            if (!isMessageAttachmentProxy) {
                setResolvedSrc(src);
                return;
            }

            if (!authToken) {
                setIsBroken(true);
                return;
            }

            setIsLoading(true);
            try {
                const response = await axios.get<ArrayBuffer>(src, {
                    responseType: 'arraybuffer',
                    withCredentials: true,
                    headers: {
                        'X-Authorization': authToken,
                    },
                });
                if (cancelled) return;
                const blob = new Blob([response.data], {
                    type: attachment.mimeType || 'application/octet-stream',
                });
                objectUrl = URL.createObjectURL(blob);
                setResolvedSrc(objectUrl);
            } catch {
                if (!cancelled) setIsBroken(true);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void run();

        return () => {
            cancelled = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [attachment, authToken, isMessageAttachmentProxy, src]);

    const name = attachment.name || 'вложение';

    if (!src || !isImageAttachment(attachment) || isBroken) {
        return (
            <div className="flex h-[180px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                <Space direction="vertical" size={4} align="center">
                    <span>Превью недоступно</span>
                    <Text type="secondary" ellipsis={{ tooltip: name }}>
                        {name}
                    </Text>
                </Space>
            </div>
        );
    }

    if (isLoading || !resolvedSrc) {
        return (
            <div className="flex h-[180px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
                <Space direction="vertical" size={4} align="center">
                    <span>Загрузка превью...</span>
                    <Text type="secondary" ellipsis={{ tooltip: name }}>
                        {name}
                    </Text>
                </Space>
            </div>
        );
    }

    return (
        <div className="h-[180px] overflow-hidden rounded border border-gray-100 bg-gray-50 lg:h-[200px]">
            <Image
                src={resolvedSrc}
                alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                onError={() => setIsBroken(true)}
                preview={{
                    mask: 'Просмотреть',
                }}
            />
        </div>
    );
}

export default function Screenshort({ attachments = [] }: { attachments?: VoiceSessionAttachment[] }) {
    const sortedAttachments = useMemo(() => {
        const safe = attachments.filter((item) => item && typeof item === 'object');
        return [...safe].sort((left, right) => {
            const leftTs = toInt(left.message_timestamp);
            const rightTs = toInt(right.message_timestamp);
            if (leftTs !== rightTs) return (leftTs ?? 0) - (rightTs ?? 0);
            return `${left.message_id ?? ''}`.localeCompare(`${right.message_id ?? ''}`);
        });
    }, [attachments]);

    return (
        <div className="p-3 pb-28">
            <List
                dataSource={sortedAttachments}
                locale={{
                    emptyText: <Empty description="Скриншоты/вложения отсутствуют" />,
                }}
                grid={{ gutter: [12, 12], xs: 1, sm: 2, lg: 2, xl: 3, xxl: 3 }}
                renderItem={(item) => {
                    const displayUrl = getDisplayAttachmentUrl(item);
                    const displayUrlPreview = toUrlPreviewText(displayUrl);
                    const copyLink = async (): Promise<void> => {
                        if (!displayUrl) return;
                        try {
                            const copied = await copyTextToClipboard(displayUrl);
                            if (!copied) {
                                message.error('Copy is not supported in this browser');
                                return;
                            }
                            message.success('Copied');
                        } catch (error) {
                            console.error(error);
                            message.error('Failed to copy');
                        }
                    };

                    return (
                        <List.Item>
                            <div className="h-full overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
                                <AttachmentPreview attachment={item} />
                                <div className="p-3">
                                    <Title level={5} className="!mb-2" ellipsis={{ tooltip: item.caption || 'Без подписи' }}>
                                        {item.caption || 'Без подписи'}
                                    </Title>
                                    <Space size={4} direction="vertical" className="w-full">
                                        <Text type="secondary" className="text-[12px]">
                                            {formatTimestamp(item.message_timestamp) || '—'}
                                        </Text>
                                        <div className="group relative rounded border border-gray-200 bg-gray-50 px-2 py-1.5 pr-8">
                                            <Text type="secondary" className="block break-all text-[11px] leading-4">
                                                {displayUrlPreview}
                                            </Text>
                                            {displayUrl ? (
                                                <Tooltip title="Copy link">
                                                    <Button
                                                        size="small"
                                                        type="text"
                                                        icon={<CopyOutlined />}
                                                        onClick={() => {
                                                            void copyLink();
                                                        }}
                                                        className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
                                                    />
                                                </Tooltip>
                                            ) : null}
                                        </div>
                                        <Text type="secondary" className="text-[11px]" ellipsis={{ tooltip: item.message_id || undefined }}>
                                            Message ID: {item.message_id || '—'}
                                        </Text>
                                        <Space wrap size={6}>
                                            {item.kind && <Tag>{item.kind}</Tag>}
                                            {item.source && <Tag>{item.source}</Tag>}
                                            {typeof item.size === 'number' && item.size > 0 && (
                                                <Tag>{Math.max(1, Math.round(item.size / 1024))} KB</Tag>
                                            )}
                                        </Space>
                                    </Space>
                                </div>
                            </div>
                        </List.Item>
                    );
                }}
            />
        </div>
    );
}
