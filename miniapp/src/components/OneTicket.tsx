import { useEffect, type ReactNode } from 'react';
import dayjs from 'dayjs';
import { Collapse, ConfigProvider } from 'antd';
import { ArrowLeftOutlined, ClockCircleOutlined, StopOutlined } from '@ant-design/icons';
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

const OneTicket = () => {
    const { selectedTicket, setSelectedTicket, setActiveActionSheet } = useKanban();

    useEffect(() => {
        if (!selectedTicket) return;
    }, [selectedTicket]);

    if (!selectedTicket) {
        return null;
    }

    const ticket: Ticket = selectedTicket;
    const safeTicketDescription = sanitizeTicketDescriptionHtml(ticket.description);

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
                    <div
                        dangerouslySetInnerHTML={{
                            __html: safeTicketDescription,
                        }}
                    />
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
