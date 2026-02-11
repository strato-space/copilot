/**
 * PaymentForm Component - Create payment for performer
 * Migrated from automation/appkanban/src/components/finances-performers/PaymentForm.jsx
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, Select, InputNumber, FloatButton, Table, message } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import _ from 'lodash';

import { useKanbanStore } from '../../../store/kanbanStore';
import { useCRMStore } from '../../../store/crmStore';
import BonusCalculator from './BonusCalculator.js';
import ProjectTag from '../ProjectTag';

import 'dayjs/locale/ru';

dayjs.locale('ru');

interface Performer {
    _id: string;
    id?: string;
    name?: string;
    real_name?: string;
    payments_settings?: Record<string, unknown>;
}

interface PaymentFormProps {
    performer: Performer;
}

interface PaymentFormValues {
    payment_name?: string;
    payment_date?: string;
    payment_month?: number;
    payment_type?: 'hourly' | 'monthly';
    hourly_rate?: number;
    monthly_rate?: number;
    payment_method?: string;
    tax?: number;
    custom_bonus?: number;
}

const PaymentForm: React.FC<PaymentFormProps> = ({ performer }) => {
    const [form] = Form.useForm();
    const [lastChanged, setLastChanged] = useState(Date.now());

    const fetchPerfrormerFinances = useKanbanStore((state) => state.fetchPerfrormerFinances);
    const performerFinancesData = useKanbanStore((state) => state.performerFinancesData) as
        | {
            tickets: Record<string, Array<{ ticket: { id: string; name: string }; totalWorkHours: number }>>;
            works_statistic: Record<string, number | string> & { totalWorkHours: number };
        }
        | null;
    const createPayment = useKanbanStore((state) => state.createPayment);

    const { metricsMonth, setMetricMonth } = useCRMStore();

    const monthOptions = useMemo(
        () =>
            Array.from({ length: 12 }, (_, i) => ({
                label: dayjs().month(i).format('MMMM'),
                value: i + 1,
            })),
        []
    );

    useEffect(() => {
        if (!performer?.id) return;
        (async () => {
            await fetchPerfrormerFinances(performer.id as string);
            const initialValues: PaymentFormValues = _.pick(performer.payments_settings ?? {}, [
                'tax',
                'payment_type',
                'hourly_rate',
                'monthly_rate',
                'payment_method',
            ]) as PaymentFormValues;
            const monthName = dayjs().month(metricsMonth - 1).format('MMMM');
            initialValues.payment_name = monthName.charAt(0).toUpperCase() + monthName.slice(1);
            initialValues.payment_date = dayjs().format('YYYY-MM-DD');
            initialValues.payment_month = metricsMonth;
            form.setFieldsValue(initialValues);
        })();
    }, [performer, metricsMonth, fetchPerfrormerFinances, form]);

    const worksDataSource = useMemo(() => {
        if (!performerFinancesData) return [];
        return Object.entries(performerFinancesData.tickets ?? {}).flatMap(([project, tickets]) =>
            tickets.map((ticket) => ({
                key: ticket.ticket.id,
                project,
                name: ticket.ticket.name,
                totalWorkHours: ticket.totalWorkHours,
            }))
        );
    }, [performerFinancesData]);

    const statsForBonus = useMemo(() => {
        const stats = (performerFinancesData?.works_statistic ?? {}) as Record<string, unknown>;
        return {
            totalWorkHours: Number(stats.totalWorkHours ?? 0),
            daysBelowANormal: Number(stats.daysBelowANormal ?? 0),
            totalDaysWithWork: Number(stats.totalDaysWithWork ?? 0),
            averageReviewsCount: Number(stats.averageReviewsCount ?? 0),
            ticketWithReviewCount: Number(stats.ticketWithReviewCount ?? 0),
            ticketsAboveNormalTimeBetweenReadyAndReview: Number(stats.ticketsAboveNormalTimeBetweenReadyAndReview ?? 0),
        };
    }, [performerFinancesData]);

    const handleValuesChange = () => {
        setLastChanged(Date.now());
    };

    const onFinish = async (values: Record<string, unknown>) => {
        if (!performer?.id || !performerFinancesData) return;
        try {
            const response = (await createPayment(
                performer.id as string,
                performerFinancesData.tickets,
                performerFinancesData.works_statistic as {
                    totalWorkHours: number;
                    daysBelowANormal: number;
                    totalDaysWithWork: number;
                    averageReviewsCount: number;
                    ticketWithReviewCount: number;
                    ticketsAboveNormalTimeBetweenReadyAndReview: number;
                },
                values as {
                    payment_type: 'hourly' | 'monthly';
                    hourly_rate?: number;
                    monthly_rate?: number;
                    payment_method?: string;
                    tax?: number;
                    custom_bonus?: number;
                }
            )) as { documentLink?: string; documentName?: string } | undefined;

            if (response?.documentLink) {
                message.success(`Документ создан: ${response.documentName ?? 'Акт'}`);
                window.open(response.documentLink, '_blank', 'noopener,noreferrer');
            } else {
                message.success('Выплата создана');
            }
        } catch (error) {
            message.error('Не удалось создать документ');
        }
    };

    if (!performer || !performerFinancesData) return null;

    return (
        <div>
            <div className="w-[500px]">
                <Form
                    form={form}
                    layout="horizontal"
                    labelCol={{ span: 8 }}
                    wrapperCol={{ span: 16 }}
                    onFinish={onFinish}
                    className="w-full max-w-4xl"
                    onValuesChange={handleValuesChange}
                >
                    <Form.Item
                        name="payment_name"
                        label="Название платежа"
                        rules={[{ required: true, message: 'Пожалуйста, введите название платежа' }]}
                    >
                        <Input className="text-[16px] w-full" />
                    </Form.Item>

                    <Form.Item
                        name="payment_date"
                        label="Дата платежа"
                        rules={[{ required: true, message: 'Пожалуйста, выберите дату платежа' }]}
                    >
                        <Input type="date" className="text-[16px] w-full" />
                    </Form.Item>

                    <Form.Item
                        name="payment_month"
                        label="Месяц"
                        rules={[{ required: true, message: 'Пожалуйста, выберите месяц' }]}
                    >
                        <Select
                            className="text-[16px]"
                            options={monthOptions}
                            onChange={(value) => setMetricMonth(value)}
                        />
                    </Form.Item>

                    <Form.Item
                        name="payment_type"
                        label="Тип оплаты"
                        rules={[{ required: true, message: 'Пожалуйста, выберите тип оплаты' }]}
                    >
                        <Select className="text-[16px]">
                            <Select.Option value="hourly">Почасовая</Select.Option>
                            <Select.Option value="monthly">Ежемесячная</Select.Option>
                        </Select>
                    </Form.Item>

                    <Form.Item name="hourly_rate" label="Почасовая ставка">
                        <InputNumber className="text-[16px] w-full" />
                    </Form.Item>

                    <Form.Item name="monthly_rate" label="Ежемесячная ставка">
                        <InputNumber className="text-[16px] w-full" />
                    </Form.Item>

                    <Form.Item
                        name="payment_method"
                        label="Метод оплаты"
                        rules={[{ required: true, message: 'Пожалуйста, выберите метод оплаты' }]}
                    >
                        <Select className="text-[16px]">
                            <Select.Option value="cash">Наличные</Select.Option>
                            <Select.Option value="card">Карта</Select.Option>
                            <Select.Option value="crypto">Криптовалюта</Select.Option>
                        </Select>
                    </Form.Item>

                    <Form.Item name="tax" label="Налог">
                        <InputNumber className="text-[16px] w-full" />
                    </Form.Item>

                    <Form.Item name="custom_bonus" label="Индивидуальный бонус">
                        <InputNumber className="text-[16px] w-full" />
                    </Form.Item>

                    <FloatButton
                        icon={<ThunderboltOutlined />}
                        type="primary"
                        onClick={() => form.submit()}
                        tooltip="Сгенерировать документы"
                    />
                </Form>
            </div>
            <div className="flex gap-4">
                <div className="flex flex-col flex-grow w-[600px]">
                    <h2 className="text-[20px]">Статистика по тикетам</h2>
                    <Table
                        size="small"
                        dataSource={worksDataSource}
                        columns={[
                            {
                                title: 'Проект',
                                dataIndex: 'project',
                                key: 'project',
                                render: (text, record, index) => {
                                    const prev = worksDataSource[index - 1] as { project?: string } | undefined;
                                    const isFirst = index === 0 || record.project !== prev?.project;
                                    return isFirst ? <ProjectTag name={record.project} tooltip={record.project} /> : null;
                                },
                            },
                            {
                                title: 'Название тикета',
                                dataIndex: 'name',
                                key: 'name',
                            },
                            {
                                title: 'Всего часов',
                                dataIndex: 'totalWorkHours',
                                key: 'totalWorkHours',
                            },
                        ]}
                        pagination={false}
                        className="my-4"
                    />
                </div>
                <div className="flex flex-col text-[14px] flex-grow-0 flex-shrink-0 w-[400px]">
                    <div className="mb-4">
                        <h2 className="text-[20px]">Статистика по работам:</h2>
                        <p>Всего отработано часов: {performerFinancesData.works_statistic.totalWorkHours}</p>
                        <p>Среднее количество часов в день: {performerFinancesData.works_statistic.averageWorkHours}</p>
                        <p>Количество дней больше 6ч: {performerFinancesData.works_statistic.daysAboveNormal}</p>
                        <p>Количество дней меньше 6ч: {performerFinancesData.works_statistic.daysBelowANormal}</p>
                        <p>Количество отработаных дней: {performerFinancesData.works_statistic.totalDaysWithWork}</p>
                        <p>Полностью закрытых задач: {performerFinancesData.works_statistic.closedTasks}</p>
                        <p>Среднее количество ревью: {performerFinancesData.works_statistic.averageReviewsCount}</p>
                        <p>
                            Среднее время между Ready и Done: {performerFinancesData.works_statistic.averageTimeBetweenReadyAndDone} дней
                        </p>
                        <p>
                            Среднее время между Ready и Review: {performerFinancesData.works_statistic.averageTimeBetweenReadyAndReview} дней
                        </p>
                        <p>Тикетов с ревью: {performerFinancesData.works_statistic.ticketWithReviewCount}</p>
                        <p>
                            Тикетов с большим временем между Ready и Review: {performerFinancesData.works_statistic.ticketsAboveNormalTimeBetweenReadyAndReview}
                        </p>
                        <p>
                            Тикетов с маленьким временем между Ready и Review: {performerFinancesData.works_statistic.ticketsBelowNormalTimeBetweenReadyAndReview}
                        </p>
                    </div>
                    <div className="mb-4">
                        <BonusCalculator data-last-changed={lastChanged} stats={statsForBonus} paymentData={form.getFieldsValue()} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentForm;
