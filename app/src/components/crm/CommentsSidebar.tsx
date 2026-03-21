import { useRef, useEffect, useMemo } from 'react';
import dayjs from 'dayjs';
import { Form, Input, Button, Drawer, Spin, Empty } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import type { Comment as CommentType, Ticket } from '../../types/crm';

interface CommentFormValues {
    comment: string;
}

const toLookupValue = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    if (typeof record.$oid === 'string') return record.$oid;
    if (typeof record._id === 'string') return record._id;
    if (typeof record.toString === 'function') {
        const directValue = record.toString();
        if (directValue && directValue !== '[object Object]') return directValue;
    }
    return '';
};

const resolveTicketDbId = (ticket: Ticket | null | undefined): string => toLookupValue(ticket?._id).trim();
const resolveTicketPublicId = (ticket: Ticket | null | undefined): string => toLookupValue(ticket?.id).trim();

const CommentsSidebar = () => {
    const {
        tickets,
        saveComment,
        ensureTicketDetails,
        isTicketDetailLoaded,
        isTicketDetailLoading,
        getCustomerByProject,
        getProjectGroupByProject,
        getProjectByName,
    } = useKanbanStore();
    const { commentedTicket, setCommentedTicket } = useCRMStore();

    const resolvedCommentedTicket = useMemo(() => {
        if (!commentedTicket) return null;
        const dbId = resolveTicketDbId(commentedTicket);
        const publicId = resolveTicketPublicId(commentedTicket);
        return (
            tickets.find((ticket) => {
                const ticketDbId = resolveTicketDbId(ticket);
                if (dbId && ticketDbId === dbId) return true;
                if (!dbId && publicId && resolveTicketPublicId(ticket) === publicId) return true;
                return false;
            }) ?? commentedTicket
        );
    }, [commentedTicket, tickets]);

    useEffect(() => {
        if (!resolvedCommentedTicket) return;
        if (isTicketDetailLoaded(resolvedCommentedTicket)) return;
        void ensureTicketDetails(resolvedCommentedTicket);
    }, [ensureTicketDetails, isTicketDetailLoaded, resolvedCommentedTicket]);

    const isHydratingDetail = Boolean(
        resolvedCommentedTicket && !isTicketDetailLoaded(resolvedCommentedTicket)
    );
    const isDetailLoading =
        isHydratingDetail || isTicketDetailLoading(resolvedCommentedTicket ?? commentedTicket ?? null);

    const customerName = resolvedCommentedTicket ? getCustomerByProject(resolvedCommentedTicket.project) : '';
    const projectGroupName = resolvedCommentedTicket ? getProjectGroupByProject(resolvedCommentedTicket.project) : '';
    const projectName = resolvedCommentedTicket
        ? getProjectByName(resolvedCommentedTicket.project)?.name || resolvedCommentedTicket.project
        : '';

    const formRef = useRef<ReturnType<typeof Form.useForm>[0]>(null);

    useEffect(() => {
        if (formRef.current) formRef.current.resetFields();
    }, [resolvedCommentedTicket]);

    const [form] = Form.useForm<CommentFormValues>();

    return (
        <Drawer
            width={400}
            onClose={() => setCommentedTicket(null)}
            open={commentedTicket !== null}
            closeIcon={<CloseOutlined />}
            title={
                resolvedCommentedTicket ? (
                    <div className="flex flex-col gap-1">
                        <div className="text-[16px] w-[324px]">{resolvedCommentedTicket.name}</div>
                        <div className="text-[14px] text-slate-500">{projectName}</div>
                        <div className="text-[12px] text-slate-400">
                            {projectGroupName || '—'} / {customerName || '—'}
                        </div>
                    </div>
                ) : (
                    ''
                )
            }
            footer={
                <div className="flex justify-between px-2">
                    <Button
                        size="large"
                        type="primary"
                        disabled={!resolvedCommentedTicket || isDetailLoading}
                        onClick={() => {
                            form.submit();
                        }}
                    >
                        Отправить комментарий
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col w-full h-full relative">
                <div className="flex flex-col h-[400px] overflow-auto gap-4">
                    {isDetailLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <Spin size="default" />
                        </div>
                    ) : Array.isArray(resolvedCommentedTicket?.comments_list) &&
                      resolvedCommentedTicket.comments_list.length > 0 ? (
                        resolvedCommentedTicket.comments_list.map((comment: CommentType, index: number) => (
                            <div key={comment._id ?? index} className="flex flex-col">
                                <div className="flex justify-between">
                                    <div className="text-[12px] text-slate-500">
                                        {comment.author?.real_name ?? comment.author?.name ?? 'Admin'}
                                    </div>
                                    <div className="text-[12px] text-slate-500">
                                        {dayjs(comment.created_at).format('DD.MM HH:mm')}
                                    </div>
                                </div>
                                <div className="flex text-[14px]">{comment.comment}</div>
                            </div>
                        ))
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Комментариев пока нет" />
                        </div>
                    )}
                </div>
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={{ comment: '' }}
                    onFinish={(values) => {
                        if (resolvedCommentedTicket) {
                            saveComment(resolvedCommentedTicket, values.comment);
                            setCommentedTicket(null);
                        }
                    }}
                    className="absolute -bottom-6 left-0 right-0"
                >
                    <Form.Item
                        label="Ваш комментарий:"
                        name="comment"
                        rules={[{ required: true, message: 'Введите комментарий' }]}
                    >
                        <Input.TextArea className="min-h-[120px]" placeholder="Введите текст комментария" />
                    </Form.Item>
                </Form>
            </div>
        </Drawer>
    );
};

export default CommentsSidebar;
