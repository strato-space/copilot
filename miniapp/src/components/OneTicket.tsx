import { createElement, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { Collapse, ConfigProvider } from 'antd';
import {
    ArrowLeftOutlined,
    ClockCircleOutlined,
    StopOutlined,
    DownloadOutlined,
    UploadOutlined,
    PaperClipOutlined,
} from '@ant-design/icons';
import _ from 'lodash';
import sanitizeHtml from 'sanitize-html';

import constants from '../constants';
import { useKanban } from '../store/kanban';
import type { Ticket } from '../types/kanban';

const ticketDescriptionSanitizerOptions: sanitizeHtml.IOptions = {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        a: ['href', 'name', 'target', 'rel'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: {
        ...sanitizeHtml.defaults.allowedSchemesByTag,
        img: ['http', 'https'],
    },
    allowProtocolRelative: false,
    transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
};

export const sanitizeTicketDescriptionHtml = (description?: string | null): string => {
    if (!description) {
        return '';
    }

    return sanitizeHtml(description, ticketDescriptionSanitizerOptions);
};

const safeDescriptionAttributes = new Set([
    'href',
    'name',
    'target',
    'rel',
    'src',
    'srcset',
    'alt',
    'title',
    'width',
    'height',
    'loading',
    'class',
]);

const renderSanitizedHtmlNode = (node: ChildNode, key: string): ReactNode => {
    if (node.nodeType === 3) {
        return node.textContent ?? '';
    }
    if (node.nodeType !== 1) {
        return null;
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    const props: Record<string, string> = { key };
    for (const attribute of Array.from(element.attributes)) {
        const attributeName = attribute.name.toLowerCase();
        if (!safeDescriptionAttributes.has(attributeName)) {
            continue;
        }
        if (attributeName === 'class') {
            props.className = attribute.value;
            continue;
        }
        props[attributeName] = attribute.value;
    }

    const children = Array.from(element.childNodes)
        .map((child, index) => renderSanitizedHtmlNode(child, `${key}-${index}`))
        .filter((child): child is Exclude<ReactNode, boolean | null | undefined> =>
            child !== null && child !== undefined && child !== false
        );

    return createElement(tagName, props, ...children);
};

const renderSanitizedHtml = (sanitizedHtml: string): ReactNode[] => {
    if (!sanitizedHtml) {
        return [];
    }
    if (typeof DOMParser === 'undefined') {
        return [sanitizedHtml];
    }

    const parsed = new DOMParser().parseFromString(`<div>${sanitizedHtml}</div>`, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!root) {
        return [sanitizedHtml];
    }

    return Array.from(root.childNodes)
        .map((child, index) => renderSanitizedHtmlNode(child, `root-${index}`))
        .filter((child): child is Exclude<ReactNode, boolean | null | undefined> =>
            child !== null && child !== undefined && child !== false
        );
};

const OneTicket = () => {
    const { selectedTicket, setSelectedTicket, setActiveActionSheet, uploadTicketAttachment } = useKanban();
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!selectedTicket) return;
    }, [selectedTicket]);

    if (!selectedTicket) {
        return null;
    }

    const ticket: Ticket = selectedTicket;
    const safeTicketDescription = sanitizeTicketDescriptionHtml(ticket.description);
    const safeTicketDescriptionNodes = renderSanitizedHtml(safeTicketDescription);
    const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];

    const taskType = ticket.task_type;
    const executionPlanItems = Array.isArray(taskType?.execution_plan) ? taskType.execution_plan : [];

    const collapseItems = [] as Array<{ key: string; label: ReactNode; children: ReactNode }>;
    if (taskType && typeof taskType === 'object') {
        const parentTitle = (taskType as { parent?: { title?: string } }).parent?.title;
        if (parentTitle || taskType.title) {
            collapseItems.push({
                key: 'task_type',
                label: <div className="font-semibold">Тип задачи:</div>,
                children: (
                    <div>
                        <div>
                            {parentTitle ? `${parentTitle}: ` : ''}
                            {taskType.title}
                        </div>
                    </div>
                ),
            });
        }

        if (taskType.description) {
            collapseItems.push({
                key: 'type_description',
                label: <div className="font-semibold">Пояснения к типу:</div>,
                children: <div>{taskType.description}</div>,
            });
        }

        if (executionPlanItems.length > 0) {
            collapseItems.push({
                key: 'type_plan',
                label: <div className="font-semibold">План выполнения:</div>,
                children: (
                    <div className="flex flex-col gap-2">
                        {executionPlanItems.map((item) => (
                            <div key={(item as { id?: string; _id?: string }).id ?? (item as { _id?: string })._id ?? _.uniqueId()}>
                                {(item as { title?: string }).title}
                            </div>
                        ))}
                    </div>
                ),
            });
        }
    }

    const resolveAttachmentDownloadUrl = (attachment: {
        download_url?: string;
        attachment_id: string;
    }): string => attachment.download_url ?? `${window.backend_url}/tickets/attachment/${ticket._id}/${attachment.attachment_id}`;

    const formatFileSize = (size: number): string => {
        if (!Number.isFinite(size) || size <= 0) return '0 B';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };

    const openFileDialog = (): void => {
        fileInputRef.current?.click();
    };

    const handleAttachmentFileSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        try {
            setIsUploadingAttachment(true);
            await uploadTicketAttachment(ticket._id, file);
        } catch (error) {
            console.error('Failed to upload miniapp attachment', error);
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    return (
        <>
            <div className="flex flex-col items-start justify-between gap-2 self-stretch px-4 py-2 pb-22">
                <div className="inline-flex items-center justify-between gap-2 self-stretch">
                    <ArrowLeftOutlined onClick={() => setSelectedTicket(null)} />
                    <div className="w-40 text-right text-[11px] font-normal leading-none text-[#808080]">
                        Обновлено: {ticket.updated_at ? dayjs(ticket.updated_at).format('HH:mm, DD.MM.YY') : '---'}
                    </div>
                </div>
                <div className="self-stretch text-sm font-bold leading-tight text-white">{ticket.name}</div>
                <div className="inline-flex items-center justify-start gap-2 self-stretch">
                    <div className="grow shrink basis-0 text-[11px] font-normal leading-none text-[#b3b3b3]">
                        {[ticket.project, ticket.type].filter(Boolean).join(' • ')}
                    </div>
                </div>
                <div className="inline-flex items-center justify-between gap-2 self-stretch">
                    <div className="flex gap-2">
                        {ticket.priority ? (
                            <div className="flex h-5 items-center justify-center gap-2.5 rounded-sm bg-[#ff3141]/20 px-1">
                                <div className="text-[11px] font-bold leading-none text-[#e6e6e6]">{ticket.priority}</div>
                            </div>
                        ) : null}
                        <div className="flex h-5 items-center justify-center gap-2.5 rounded-sm bg-[#3086ff]/20 px-1">
                            <div className="text-[11px] font-bold leading-none text-[#3086ff]">
                                {(constants.simplified_crm_statuses as Record<string, string>)[ticket.task_status]}
                            </div>
                        </div>
                    </div>
                </div>
                {collapseItems.length > 0 ? (
                    <ConfigProvider
                        theme={{
                            token: {
                                colorText: '#fff',
                                colorTextDescription: '#fff',
                                colorTextPlaceholder: 'rgba(255,255,255,0.4)',
                                colorBorder: '#000',
                            },
                            components: {
                                Collapse: {
                                    contentPadding: '8px 0',
                                    headerPadding: '8px 0',
                                },
                            },
                        }}
                    >
                        <Collapse items={collapseItems} bordered={false} defaultActiveKey={collapseItems.map((item) => item.key)} />
                    </ConfigProvider>
                ) : null}

                <div className="one-ticket-description break-all pb-20">
                    <div className="font-bold">Описание задачи:</div>
                    <div>{safeTicketDescriptionNodes}</div>
                </div>

                <div className="w-full pb-20">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="font-bold">Вложения</div>
                        <button
                            type="button"
                            className="flex items-center gap-2 rounded-md border border-[#3086ff] bg-[#3086ff] px-3 py-1 text-sm text-white disabled:opacity-60"
                            onClick={openFileDialog}
                            disabled={isUploadingAttachment}
                        >
                            <UploadOutlined />
                            {isUploadingAttachment ? 'Загрузка...' : 'Добавить'}
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            onChange={(event) => {
                                void handleAttachmentFileSelected(event);
                            }}
                        />
                    </div>
                    {attachments.length < 1 ? (
                        <div className="rounded-md border border-dashed border-[#2b2b2b] p-3 text-xs text-[#b3b3b3]">
                            Пока нет вложений
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {attachments.map((attachment) => (
                                <div
                                    key={attachment.attachment_id}
                                    className="flex items-center justify-between gap-2 rounded-md border border-[#2b2b2b] bg-[#111] px-3 py-2"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-sm text-white">
                                            <PaperClipOutlined />
                                            <span className="truncate">{attachment.file_name}</span>
                                        </div>
                                        <div className="text-[11px] text-[#b3b3b3]">{formatFileSize(attachment.file_size)}</div>
                                    </div>
                                    <a
                                        href={resolveAttachmentDownloadUrl(attachment)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 rounded-md border border-[#2b2b2b] bg-[#1a1a1a] px-2 py-1 text-xs text-white"
                                    >
                                        <DownloadOutlined />
                                        Скачать
                                    </a>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            <div className="fixed bottom-0 left-0 z-30 w-full">
                <div className="absolute bottom-0 left-0 flex w-full flex-col border-t border-[#2b2b2b] bg-[#0a0a0a]">
                    <div className="flex h-20 items-center justify-between px-4">
                        <div className="flex gap-4">
                            <div
                                className="flex h-10 w-10 items-center justify-center rounded-full border border-[#2b2b2b] bg-[#1a1a1a] p-3"
                                onClick={() => setActiveActionSheet(constants.action_sheets.TRACK_TIME)}
                            >
                                <ClockCircleOutlined className="h-5 w-5" />
                            </div>
                            {ticket.task_status !== constants.task_statuses.PERIODIC ? (
                                <div
                                    className="flex h-10 w-10 items-center justify-center rounded-full border border-[#2b2b2b] bg-[#1a1a1a]"
                                    onClick={() => setActiveActionSheet(constants.action_sheets.REJECT_TICKET)}
                                >
                                    <StopOutlined />
                                </div>
                            ) : null}
                        </div>
                        {ticket.task_status !== constants.task_statuses.PERIODIC ? (
                            <div
                                className="flex h-12 w-[216px] items-center justify-center gap-2 rounded-full border border-[#3086ff] bg-[#3086ff] p-3"
                                onClick={() => setActiveActionSheet(constants.action_sheets.CHANGE_STATUS)}
                            >
                                <div className="text-center text-lg font-normal leading-[24px] text-white">Change status</div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </>
    );
};

export default OneTicket;
