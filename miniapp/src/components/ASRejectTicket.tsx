import { useEffect } from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { ConfigProvider, Form, Input } from 'antd';
import type { FormInstance } from 'antd';

import ActionSheet from './ActionSheet';
import { useKanban } from '../store/kanban';

dayjs.extend(customParseFormat);

interface RejectTicketValues {
    date: string;
    comment: string;
    ticket_id: string;
}

const ASRejectTicket = () => {
    const { selectedTicket, setActiveActionSheet, rejectTicket } = useKanban();
    const [form] = Form.useForm<RejectTicketValues>();

    useEffect(() => {
        form.resetFields();
    }, [form]);

    if (!selectedTicket) {
        return null;
    }

    return (
        <ActionSheet onClose={() => setActiveActionSheet(null)}>
            <div className="flex w-full flex-col gap-3 px-4 pt-3">
                <ConfigProvider
                    theme={{
                        token: {
                            colorText: '#fff',
                            colorTextDescription: '#fff',
                            colorTextPlaceholder: 'rgba(255,255,255,0.4)',
                        },
                        components: {
                            Input: {
                                inputFontSize: 17,
                            },
                            Form: {
                                itemMarginBottom: 0,
                            },
                        },
                    }}
                >
                    <Form
                        layout="vertical"
                        initialValues={{
                            date: dayjs().format('DD.MM.YY'),
                            comment: '',
                            ticket_id: selectedTicket._id,
                        }}
                        form={form}
                        onFinish={(values) => {
                            void rejectTicket(values);
                            setActiveActionSheet(null);
                        }}
                    >
                        <div className="flex flex-col gap-4">
                            <Form.Item name="ticket_id" hidden>
                                <Input type="hidden" />
                            </Form.Item>
                            <div className="rounded-[10px] border border-[#2b2b2b] bg-[#0A0A0A] p-3 pb-0">
                                <Form.Item
                                    label="Reason:"
                                    name="comment"
                                    rules={[{ required: true, message: 'Укажте причину отклонения тикета!' }]}
                                >
                                    <Input.TextArea rows={8} variant="borderless" placeholder="Why are you rejecting this ticket?" />
                                </Form.Item>
                            </div>
                        </div>
                    </Form>
                </ConfigProvider>
            </div>
            <div className="mt-3 inline-flex items-end justify-center gap-4 border-t border-[#2b2b2b] bg-[#1a1a1a] px-4 pt-4">
                <div
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-[#2b2b2b] bg-[#1a1a1a] p-3"
                    onClick={() => setActiveActionSheet(null)}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M14.9593 9.16733H6.62598L9.36764 6.42566C9.44575 6.34819 9.50775 6.25602 9.55005 6.15447C9.59236 6.05293 9.61414 5.944 9.61414 5.83399C9.61414 5.72398 9.59236 5.61506 9.55005 5.51351C9.50775 5.41196 9.44575 5.3198 9.36764 5.24233C9.21151 5.08712 9.0003 5 8.78014 5C8.55999 5 8.34878 5.08712 8.19264 5.24233L4.61764 8.82566C4.30465 9.13679 4.12784 9.55935 4.12598 10.0007C4.13003 10.4391 4.30668 10.8582 4.61764 11.1673L8.19264 14.7507C8.27034 14.8278 8.36248 14.8889 8.46379 14.9304C8.56509 14.972 8.67359 14.9932 8.78309 14.9928C8.89259 14.9924 9.00093 14.9705 9.10195 14.9282C9.20296 14.8859 9.29466 14.8242 9.37181 14.7465C9.44896 14.6688 9.51005 14.5767 9.5516 14.4754C9.59314 14.374 9.61433 14.2655 9.61394 14.156C9.61355 14.0466 9.5916 13.9382 9.54934 13.8372C9.50708 13.7362 9.44534 13.6445 9.36764 13.5673L6.62598 10.834H14.9593C15.1803 10.834 15.3923 10.7462 15.5486 10.5899C15.7048 10.4336 15.7926 10.2217 15.7926 10.0007C15.7926 9.77965 15.7048 9.56769 15.5486 9.41141C15.3923 9.25512 15.1803 9.16733 14.9593 9.16733Z"
                            fill="white"
                        />
                    </svg>
                </div>
                <div
                    className="flex h-12 grow shrink basis-0 items-center justify-center gap-2 rounded-full border border-[#3086ff] bg-[#3086ff] p-3"
                    onClick={() => form.submit()}
                >
                    <div className="text-center text-lg font-normal leading-[24px] text-white">Reject ticket</div>
                </div>
            </div>
        </ActionSheet>
    );
};

export default ASRejectTicket;
