import { useRef, useEffect, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import _ from 'lodash';
import { Form, Input, DatePicker, Button, Select, Drawer, ConfigProvider } from 'antd';
import { CloseOutlined, EditOutlined } from '@ant-design/icons';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import type { WorkData } from '../../types/crm';

interface WorkFormValues {
    _id: string | null;
    performer: string | null;
    date: Dayjs;
    time: string;
    comment: string;
    result_link: string;
}

const emptyForm: WorkFormValues = {
    _id: null,
    performer: null,
    date: dayjs(),
    time: '0.0',
    comment: '',
    result_link: '',
};

const WorkHoursSidebar = () => {
    const {
        performers,
        addWorkHours,
        editWorkHour,
        getCustomerByProject,
        getProjectGroupByProject,
        getProjectByName,
    } = useKanbanStore();
    const { editingWorkHours, setEditingWorkHours } = useCRMStore();
    const [editingData, setEditingData] = useState<WorkFormValues>(emptyForm);
    const [form] = Form.useForm<WorkFormValues>();
    const formRef = useRef(form);

    const customerName = editingWorkHours ? getCustomerByProject(editingWorkHours.project) : '';
    const projectGroupName = editingWorkHours ? getProjectGroupByProject(editingWorkHours.project) : '';
    const projectName = editingWorkHours ? getProjectByName(editingWorkHours.project)?.name || editingWorkHours.project : '';

    useEffect(() => {
        setEditingData(emptyForm);
    }, [editingWorkHours]);

    useEffect(() => {
        if (formRef.current) formRef.current.setFieldsValue(editingData);
    }, [editingData]);

    return (
        <ConfigProvider
            theme={{
                components: {
                    Form: {
                        marginLG: 16,
                    },
                    Drawer: {
                        footerPaddingBlock: 4,
                        paddingLG: 8,
                    },
                },
            }}
        >
            <Drawer
                width={400}
                onClose={() => setEditingWorkHours(null)}
                open={editingWorkHours !== null}
                closeIcon={<CloseOutlined />}
                title={
                    editingWorkHours ? (
                        <div className="flex flex-col gap-1">
                            <div className="text-[16px] w-[324px]">{editingWorkHours.name}</div>
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
                    <div className={`flex ${editingData._id ? 'justify-between' : 'justify-end'} px-2`}>
                        {editingData._id ? (
                            <Button
                                size="large"
                                type="default"
                                onClick={() => {
                                    setEditingData(emptyForm);
                                }}
                            >
                                Отмена
                            </Button>
                        ) : null}

                        <Button
                            size="large"
                            type="primary"
                            onClick={() => {
                                form.submit();
                            }}
                        >
                            {editingData._id ? 'Сохранить' : 'Добавить'} часы
                        </Button>
                    </div>
                }
            >
                <div className="flex flex-col w-full h-full relative px-4">
                    <div className="flex flex-col flex-grow flex-shrink overflow-auto gap-4 py-4 select-text">
                        {editingWorkHours?.work_data
                            ?.sort((a: WorkData, b: WorkData) => (b.date_timestamp ?? 0) - (a.date_timestamp ?? 0))
                            .map((work_data: WorkData) => {
                                const performer = performers.find((p) => p.id === work_data.created_by);
                                return (
                                    <div className="flex flex-col" key={work_data._id}>
                                        <div className="flex text-[14px] justify-between">
                                            {dayjs(work_data.date).format('DD.MM')}
                                            <EditOutlined
                                                className="cursor-pointer hover:text-blue-500"
                                                onClick={() => {
                                                    setEditingData({
                                                        _id: work_data._id,
                                                        performer: work_data.created_by ?? null,
                                                        date: dayjs(work_data.date),
                                                        time: work_data.work_hours?.toString() ?? '0.0',
                                                        comment: work_data.description ?? '',
                                                        result_link: work_data.result_link ?? '',
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="flex justify-between">
                                            <div className="text-[12px] text-slate-500">
                                                {performer?.real_name ?? performer?.name ?? ''}
                                            </div>
                                            <div className="text-[12px] text-slate-500">{work_data.work_hours} ч.</div>
                                        </div>
                                        <div className="flex text-[14px]">{work_data.description}</div>
                                        <div className="flex text-[14px]">{work_data.result_link}</div>
                                    </div>
                                );
                            })}
                    </div>
                    <div className="-mx-6 border-t mt-2" />
                    <Form
                        form={form}
                        layout="horizontal"
                        onFinish={(values) => {
                            if (!editingWorkHours) return;
                            const payload = {
                                ticket_id: editingWorkHours._id,
                                date: values.date,
                                time: parseFloat(values.time) || 0,
                                description: values.comment,
                                performer: values.performer,
                            };
                            if (values._id) {
                                editWorkHour({ _id: values._id, ...payload });
                            } else {
                                addWorkHours(payload);
                            }
                            setEditingWorkHours(null);
                        }}
                        initialValues={editingData}
                        className="mt-4"
                    >
                        <Form.Item name="_id" hidden>
                            <Input type="hidden" />
                        </Form.Item>
                        <Form.Item
                            label={<label className="w-[64px] text-left">Исполнитель</label>}
                            name="performer"
                            rules={[{ required: true, message: 'Выберите исполнителя' }]}
                        >
                            <Select
                                options={performers.map((performer) => ({
                                    value: performer.id,
                                    label: performer.name,
                                }))}
                                className="w-[180px]"
                            />
                        </Form.Item>
                        <Form.Item
                            label={<label className="w-[64px] text-left">Дата</label>}
                            name="date"
                            rules={[{ required: true, message: 'Введите дату' }]}
                        >
                            <DatePicker inputReadOnly className="w-[262px]" />
                        </Form.Item>
                        <Form.Item
                            label={<label className="w-[64px] text-left">Время</label>}
                            name="time"
                            rules={[
                                { required: true, message: 'Укажите время' },
                                () => ({
                                    validator(_, value) {
                                        const parsedValue = parseFloat(value);
                                        if (parsedValue.toString() === value) return Promise.resolve();
                                        if (parseInt(value).toString() === value) return Promise.resolve();
                                        return Promise.reject(new Error('Некорректное число'));
                                    },
                                }),
                            ]}
                        >
                            <Input variant="borderless" placeholder="0.0" />
                        </Form.Item>
                        <Form.Item
                            label={<label className="w-[64px] text-left">Комментарий</label>}
                            name="comment"
                            rules={[{ required: true, message: 'Введите комментарий' }]}
                        >
                            <Input.TextArea className="min-h-[80px]" placeholder="Введите текст комментария" />
                        </Form.Item>
                    </Form>
                </div>
            </Drawer>
        </ConfigProvider>
    );
};

export default WorkHoursSidebar;
