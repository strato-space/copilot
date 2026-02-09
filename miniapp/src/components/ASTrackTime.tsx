import { useEffect } from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { ConfigProvider, Form, Input, Modal } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import InputMask from 'react-input-mask';

import ActionSheet from './ActionSheet';
import { useKanban } from '../store/kanban';

dayjs.extend(customParseFormat);

interface TrackTimeValues {
    ticket_id: string;
    date: string;
    time: string;
    comment: string;
    result_link: string;
}

const timePresets = [
    { label: '10 m', value: '00:10' },
    { label: '15 m', value: '00:15' },
    { label: '30 m', value: '00:30' },
    { label: '1 h', value: '01:00' },
    { label: '1 h 30 m', value: '01:30' },
    { label: '2 h', value: '02:00' },
    { label: '2 h 30 m', value: '02:30' },
    { label: '3 h', value: '03:00' },
    { label: '3 h 30 m', value: '03:30' },
    { label: '4 h', value: '04:00' },
    { label: '5 h', value: '05:00' },
    { label: '6 h', value: '06:00' },
];

const ASTrackTime = () => {
    const { selectedTicket, setActiveActionSheet, trackTicketTime } = useKanban();
    const [form] = Form.useForm<TrackTimeValues>();
    const [modal, contextHolder] = Modal.useModal();

    useEffect(() => {
        form.resetFields();
    }, [form]);

    if (!selectedTicket) {
        return null;
    }

    return (
        <ActionSheet onClose={() => setActiveActionSheet(null)}>
            <div className="ASTrackTime flex w-full flex-col gap-3 overflow-auto px-4 pt-3">
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
                            Modal: {
                                contentBg: '#1a1a1a',
                            },
                        },
                    }}
                >
                    {contextHolder}
                    <Form
                        layout="vertical"
                        initialValues={{
                            date: dayjs().format('DD.MM.YY'),
                            time: '',
                            comment: '',
                            ticket_id: selectedTicket._id,
                            result_link: '',
                        }}
                        form={form}
                        onFinish={(values) => {
                            let { time, ...rest } = values;
                            if (/^\d{1,2}:\d{2}$/.test(time)) {
                                const [hours = 0, minutes = 0] = time
                                    .split(':')
                                    .map((value) => Number(value));
                                const safeHours = Number.isNaN(hours) ? 0 : hours;
                                const safeMinutes = Number.isNaN(minutes) ? 0 : minutes;
                                time = (safeHours + safeMinutes / 60).toString();
                            }
                            void trackTicketTime({ ...rest, time });
                            setActiveActionSheet(null);
                        }}
                    >
                        <div className="flex flex-col gap-4">
                            <Form.Item name="ticket_id" hidden>
                                <Input type="hidden" />
                            </Form.Item>
                            <div className="rounded-[10px] border border-[#2b2b2b] bg-[#0A0A0A] p-3 pb-0">
                                <Form.Item
                                    label="Date:"
                                    name="date"
                                    rules={[
                                        { required: true, message: 'Укажите дату' },
                                        () => ({
                                            validator(_, value) {
                                                const isValid = dayjs(value, 'DD.MM.YY', true).isValid();
                                                if (isValid) return Promise.resolve();
                                                return Promise.reject(new Error('Введите в формате: ДД.ММ.ГГ'));
                                            },
                                        }),
                                    ]}
                                >
                                    <Input variant="borderless" placeholder={dayjs().format('DD.MM.YY')} />
                                </Form.Item>
                            </div>
                            <div className="rounded-[10px] border border-[#2b2b2b] bg-[#0A0A0A] p-3 pb-4">
                                <div className="flex flex-wrap justify-start gap-x-6 gap-y-3 p-4">
                                    {timePresets.map((preset) => (
                                        <div
                                            key={preset.label}
                                            className="shrink-0 cursor-pointer text-blue-500 hover:underline"
                                            onClick={() => form.setFieldsValue({ time: preset.value })}
                                        >
                                            {preset.label}
                                        </div>
                                    ))}
                                </div>
                                <Form.Item
                                    label="Fact time (hh:mm):"
                                    name="time"
                                    rules={[
                                        { required: true, message: 'Укажите время' },
                                        () => ({
                                            validator(_, value) {
                                                const parsedValue = value as string;
                                                if (/^\d{1,2}:\d{2}$/.test(parsedValue)) return Promise.resolve();
                                                if (!Number.isNaN(parseFloat(parsedValue))) return Promise.resolve();
                                                return Promise.reject(new Error('Некорректное число или формат времени'));
                                            },
                                        }),
                                    ]}
                                >
                                    <InputMask
                                        mask="99:99"
                                        maskChar={null}
                                        alwaysShowMask
                                        value={form.getFieldValue('time') ?? ''}
                                        onChange={(event) => {
                                            form.setFieldsValue({ time: event.target.value });
                                        }}
                                    >
                                        {(inputProps) => <Input {...inputProps} variant="borderless" placeholder="HH:mm" />}
                                    </InputMask>
                                </Form.Item>
                            </div>

                            <div className="rounded-[10px] border border-[#2b2b2b] bg-[#0A0A0A] p-3 pb-0">
                                <Form.Item
                                    label="Link:"
                                    name="result_link"
                                    rules={[{ required: true, message: 'Укажите ссылку на результат' }]}
                                >
                                    <Input variant="borderless" placeholder="" />
                                </Form.Item>
                            </div>

                            <div className="relative rounded-[10px] border border-[#2b2b2b] bg-[#0A0A0A] p-3 pb-0">
                                <div
                                    className="absolute right-1 top-1 z-50 flex h-5 w-5 text-[20px] text-gray-400"
                                    onClick={() =>
                                        modal.info({
                                            title: 'Что писать в комментарий?',
                                            content: (
                                                <div>
                                                    <ol className="list-decimal">
                                                        <li>
                                                            При списании времени за работу по лендингу нужно писать конкретно над какими блоками
                                                            работал(а). Например, 1 час - создавал промо-баннер.
                                                        </li>
                                                        <li>
                                                            При списании времени за работу по интерфейсу нужно писать над какими страницами работал.
                                                        </li>
                                                        <li>
                                                            При списании времени за работу по сценариям надо писать над какими сценариями работал.
                                                        </li>
                                                        <li>
                                                            При списании времени за работу по внесению правок надо писать, например, “вносил правки по
                                                            главной странице с 49 по 91”.
                                                        </li>
                                                        <li>
                                                            Если работал над исследованием, пишешь какая часть исследования была охвачена, какой объем
                                                            (например, сколько страниц или конкретное действие, которое было объяснено).
                                                        </li>
                                                        <li>
                                                            Комментарий должен быть понятным и должен содержать не менее 20 символов. Комментарий в
                                                            стиле «сделано», «ок» и пр. вносить нельзя.
                                                        </li>
                                                    </ol>
                                                </div>
                                            ),
                                            onOk() { },
                                        })
                                    }
                                >
                                    <InfoCircleOutlined />
                                </div>
                                <Form.Item
                                    label="Комментарий:"
                                    name="comment"
                                    rules={[
                                        { required: true, message: 'Описание выполненной работы обязательно' },
                                        { min: 20, message: 'Комментарий должен содержать не менее 20 символов' },
                                    ]}
                                >
                                    <Input.TextArea
                                        rows={8}
                                        variant="borderless"
                                        placeholder="What do you do?"
                                        count={{
                                            show: true,
                                        }}
                                    />
                                </Form.Item>
                            </div>
                        </div>
                    </Form>
                </ConfigProvider>
            </div>
        </ActionSheet>
    );
};

export default ASTrackTime;
