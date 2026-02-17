import { useEffect, useMemo, useState } from 'react';
import { Empty, Image, List, Space, Tag, Typography } from 'antd';
import axios from 'axios';

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
            <div className="flex h-[220px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
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
            <div className="flex h-[220px] items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
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
        <div className="h-[220px]">
            <Image
                src={resolvedSrc}
                alt={name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
        <div className="p-3">
            <List
                dataSource={sortedAttachments}
                locale={{
                    emptyText: <Empty description="Скриншоты/вложения отсутствуют" />,
                }}
                grid={{ gutter: [12, 12], xs: 1, sm: 2, lg: 3, xl: 4 }}
                renderItem={(item) => (
                    <List.Item>
                        <div className="h-full rounded border border-gray-200 bg-white">
                            <AttachmentPreview attachment={item} />
                            <div className="p-2">
                                <Title level={5} ellipsis={{ tooltip: item.caption || 'Без подписи' }}>
                                    {item.caption || 'Без подписи'}
                                </Title>
                                <Space size={4} direction="vertical" className="w-full">
                                    <Text type="secondary">
                                        Сообщение: {item.message_id || '—'} · {formatTimestamp(item.message_timestamp) || '—'}
                                    </Text>
                                    <Text type="secondary" className="text-[12px]" ellipsis={{ tooltip: item.uri || item.url || undefined }}>
                                        {item.uri || item.url || 'Нет источника'}
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
                )}
            />
        </div>
    );
}
