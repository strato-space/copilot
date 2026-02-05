import { useEffect, useMemo } from 'react';
import { Form, Input, Button, Select, DatePicker, InputNumber, Divider, Space } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import _ from 'lodash';
import dayjs, { Dayjs } from 'dayjs';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import { useProjectsStore } from '../../store/projectsStore';
import { TASK_STATUSES, NOTION_TICKET_PRIORITIES } from '../../constants/crm';
import type { Project, TaskType } from '../../types/crm';

interface TicketFormValues {
    _id?: string | null;
    id?: string | null;
    name: string;
    project?: string;
    task_type?: string;
    performer?: string;
    priority?: string;
    estimated_time?: number;
    shipment_date?: Dayjs;
    epic?: string;
    notifications?: string[];
    description?: string;
}

const CRMCreateTicket = () => {
    const [form] = Form.useForm<TicketFormValues>();
    const { editingTicket, setEditingTicket, editTiketProject, setEditTiketProject } = useCRMStore();
    const {
        performers,
        projects,
        fetchTickets,
        createTicket,
        editTicketData,
        task_types,
        uploadFile,
        deleteTicket,
        getProjectEpics,
        createEpic,
        getProjectByName,
    } = useKanbanStore();
    const { customers, projectGroups, projects: projectsFromStore } = useProjectsStore();

    // Функция для группировки проектов по project groups
    const getGroupedProjects = () => {
        const projectsByGroup: Record<string, Array<{ _id: string; name: string; project_group?: string | null }>> = {};

        projects.forEach((projectName) => {
            const project = projectsFromStore.find((p) => p.name === projectName);
            if (!project) {
                if (!projectsByGroup['Unknown']) {
                    projectsByGroup['Unknown'] = [];
                }
                projectsByGroup['Unknown'].push({ name: projectName, _id: projectName });
                return;
            }

            const group = projectGroups.find(
                (g) => g._id && project.project_group && g._id.toString() === project.project_group.toString()
            );
            const customer = group
                ? customers.find((c) => c._id && group.customer && c._id.toString() === group.customer.toString())
                : null;

            const groupKey = group ? `${customer?.name ?? 'Unknown'} / ${group.name}` : 'Unassigned';

            if (!projectsByGroup[groupKey]) {
                projectsByGroup[groupKey] = [];
            }
            projectsByGroup[groupKey].push(project);
        });

        return Object.entries(projectsByGroup).map(([groupName, projs]) => ({
            label: groupName,
            title: groupName,
            options: projs.map((project) => ({
                label: project.name,
                value: project._id,
            })),
        }));
    };

    const modules = useMemo(
        () => ({
            toolbar: [
                [{ header: 1 }, { header: 2 }],
                [{ list: 'ordered' }, { list: 'bullet' }],
                ['bold', 'italic', 'underline', 'strike'],
                ['link', 'image', 'code'],
            ],
        }),
        []
    );

    useEffect(() => {
        if (projects.length === 0) fetchTickets(Object.keys(TASK_STATUSES));
        form.resetFields();
        if (editingTicket?.project) {
            setEditTiketProject(editingTicket.project);
        }
    }, [projects.length, fetchTickets, editingTicket, form, setEditTiketProject]);

    if (!editingTicket) return null;

    const projectEpics = getProjectEpics(editTiketProject ?? '').filter((e) => !e.is_deleted);

    return (
        <div className="text-black flex flex-col pt-3">
            <div className="flex justify-between items-center gap-3">
                <div className="flex gap-4">
                    <ArrowLeftOutlined
                        className="hover:text-sky-700 cursor-pointer"
                        onClick={() => setEditingTicket(null)}
                    />
                    {!editingTicket._id ? <div>Создать задачу</div> : <div>Редактировать задачу</div>}
                </div>
                <div className="flex gap-4">
                    <Button
                        type="primary"
                        shape="circle"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => {
                            if (editingTicket._id) deleteTicket(editingTicket._id);
                            setEditingTicket(null);
                        }}
                    />
                    <Button type="primary" shape="circle" icon={<CheckOutlined />} onClick={() => form.submit()} />
                </div>
            </div>
            <div className="flex flex-col w-full mt-3">
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={{
                        ...editingTicket,
                        performer: typeof editingTicket?.performer === 'object' ? editingTicket.performer._id : editingTicket?.performer,
                    }}
                    onFinish={(values) => {
                        // Очищаем пустые строки, заменяя их на null
                        const cleanedValues = Object.fromEntries(
                            Object.entries(values).map(([key, value]) => {
                                if (key === 'shipment_date' && value && dayjs.isDayjs(value)) {
                                    return [key, (value as Dayjs).format('YYYY-MM-DD')];
                                }
                                return [
                                    key,
                                    typeof value === 'string' && value.trim() === '' ? null : value,
                                ];
                            })
                        );

                        if (!editingTicket._id) {
                            createTicket(cleanedValues as Parameters<typeof createTicket>[0]);
                        } else {
                            editTicketData(cleanedValues as Parameters<typeof editTicketData>[0]);
                        }
                        setEditingTicket(null);
                    }}
                >
                    <Form.Item hidden name="_id">
                        <Input type="hidden" />
                    </Form.Item>
                    <Form.Item hidden name="id">
                        <Input type="hidden" />
                    </Form.Item>
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
                        <div className="space-y-3">
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                                <div className="lg:w-[124px] flex-shrink-0">Название:</div>
                                <div className="flex-1">
                                    <Form.Item
                                        label="Название задачи:"
                                        name="name"
                                        className="w-full sm:max-w-[560px]"
                                        rules={[{ required: true, message: 'Введите заголовок' }]}
                                    >
                                        <Input size="large" />
                                    </Form.Item>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                                <div className="lg:w-[124px] flex-shrink-0">О задаче:</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                                    <Form.Item
                                        label="Проект:"
                                        name="project"
                                        className="w-full"
                                        rules={[{ required: true, message: 'Выберите проект' }]}
                                    >
                                        <Select
                                            options={getGroupedProjects()}
                                            showSearch
                                            filterOption={(inputValue, option) =>
                                                (option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                                            }
                                            onChange={(value) => setEditTiketProject(value)}
                                            className="w-full"
                                            popupClassName="w-[400px]"
                                            popupMatchSelectWidth={false}
                                        />
                                    </Form.Item>
                                    <Form.Item label="Тип:" name="task_type" className="w-full">
                                        <Select
                                            allowClear
                                            placeholder="Выберите тип задачи"
                                            options={Object.entries(
                                                _.groupBy(
                                                    Object.values(Array.isArray(task_types) ? task_types : []),
                                                    'supertype'
                                                )
                                            ).map(
                                                ([supertype, types]: [string, TaskType[]]) => ({
                                                    label: supertype,
                                                    title: supertype,
                                                    options: types.map((tt) => ({
                                                        label: `${tt.task_id ?? ''} ${tt.name}`,
                                                        value: tt._id,
                                                    })),
                                                })
                                            )}
                                            showSearch
                                            filterOption={(inputValue, option) =>
                                                (option?.label ?? '').toString().toLowerCase().includes(inputValue.toLowerCase())
                                            }
                                            className="w-full"
                                            popupClassName="w-[250px]"
                                            popupMatchSelectWidth={false}
                                        />
                                    </Form.Item>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                                <div className="lg:w-[124px] flex-shrink-0">Кто и когда:</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                                    <Form.Item label="Исполнитель:" name="performer" className="w-full">
                                        <Select
                                            options={performers.map((performer) => ({
                                                value: performer._id,
                                                label: performer.real_name ?? performer.name,
                                            }))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="Приоритет:" name="priority" className="w-full">
                                        <Select
                                            options={Object.values(NOTION_TICKET_PRIORITIES).map((value) => ({
                                                value,
                                                label: value,
                                            }))}
                                        />
                                    </Form.Item>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                                <div className="lg:w-[124px] flex-shrink-0">Время</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                                    <Form.Item label="Оценка времени:" name="estimated_time" className="w-full">
                                        <InputNumber className="w-full" controls={false} />
                                    </Form.Item>
                                    <Form.Item
                                        label="Дата выгрузки:"
                                        name="shipment_date"
                                        getValueProps={(d) => ({ value: d ? dayjs(d) : undefined })}
                                    >
                                        <DatePicker className="w-full" />
                                    </Form.Item>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                                <div className="lg:w-[124px] flex-shrink-0">Эпик:</div>
                                <div className="flex-1">
                                    <Form.Item label="Эпик:" name="epic" className="w-full">
                                        <Select
                                            disabled={!editTiketProject}
                                            allowClear
                                            options={[{ label: '-очистить поле-', value: '' }, ...projectEpics.map((epic) => ({ value: epic._id, label: epic.name }))]}
                                            showSearch
                                            className="w-full"
                                            popupClassName="w-[300px]"
                                            popupMatchSelectWidth={false}
                                        />
                                    </Form.Item>
                                </div>
                            </div>

                            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                                <div className="lg:w-[124px] flex-shrink-0">Уведомления:</div>
                                <div className="flex-1">
                                    <Form.Item
                                        label="Пользователи для уведомления:"
                                        name="notifications"
                                        className="w-full"
                                    >
                                        <Select
                                            options={performers.map((performer) => ({
                                                value: performer._id,
                                                label: performer.real_name ?? performer.name,
                                            }))}
                                            mode="multiple"
                                        />
                                    </Form.Item>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <div className="text-sm text-slate-600">Описание</div>
                            <Form.Item name="description">
                                <ReactQuill
                                    theme="snow"
                                    className="h-[240px] w-full"
                                    modules={modules}
                                    placeholder="Введите описание задачи."
                                />
                            </Form.Item>
                        </div>
                    </div>
                </Form>
            </div>
        </div>
    );
};

export default CRMCreateTicket;
