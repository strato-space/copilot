import { useRef, useEffect } from 'react';
import dayjs from 'dayjs';
import { Form, Input, Button, Drawer } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import type { Comment as CommentType } from '../../types/crm';

interface CommentFormValues {
    comment: string;
}

const CommentsSidebar = () => {
    const { saveComment, getCustomerByProject, getProjectGroupByProject, getProjectByName } = useKanbanStore();
    const { commentedTicket, setCommentedTicket } = useCRMStore();

    const customerName = commentedTicket ? getCustomerByProject(commentedTicket.project) : '';
    const projectGroupName = commentedTicket ? getProjectGroupByProject(commentedTicket.project) : '';
    const projectName = commentedTicket ? getProjectByName(commentedTicket.project)?.name || commentedTicket.project : '';

    const formRef = useRef<ReturnType<typeof Form.useForm>[0]>(null);

    useEffect(() => {
        if (formRef.current) formRef.current.resetFields();
    }, [commentedTicket]);

    const [form] = Form.useForm<CommentFormValues>();

    return (
        <Drawer
            width={400}
            onClose={() => setCommentedTicket(null)}
            open={commentedTicket !== null}
            closeIcon={<CloseOutlined />}
            title={
                commentedTicket ? (
                    <div className="flex flex-col gap-1">
                        <div className="text-[16px] w-[324px]">{commentedTicket.name}</div>
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
                    {commentedTicket?.comments_list?.map((comment: CommentType, index: number) => (
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
                    ))}
                </div>
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={{ comment: '' }}
                    onFinish={(values) => {
                        if (commentedTicket) {
                            saveComment(commentedTicket, values.comment);
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
