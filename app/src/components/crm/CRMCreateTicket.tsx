import { useEffect, useMemo, useState } from 'react';
import { Form, Input, Button, Select, DatePicker, InputNumber, Divider, message } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import _ from 'lodash';
import dayjs, { Dayjs } from 'dayjs';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import { useProjectsStore } from '../../store/projectsStore';
import { TASK_STATUSES, NOTION_TICKET_PRIORITIES } from '../../constants/crm';
import { getPerformerLabel, isPerformerSelectable } from '../../utils/performerLifecycle';
import type { TaskAttachment, TaskType } from '../../types/crm';

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
    attachments?: TaskAttachment[];
}

const toIdString = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const directId = record._id ?? record.id;
        if (typeof directId === 'string' || typeof directId === 'number') {
            return String(directId);
        }
        if (directId && typeof directId === 'object' && typeof (directId as { toString?: () => string }).toString === 'function') {
            return (directId as { toString: () => string }).toString();
        }
    }
    return undefined;
};

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
        uploadTicketAttachment,
        deleteTicketAttachment,
        deleteTicket,
        getProjectEpics,
    } = useKanbanStore();
    const { customers, projectGroups, projects: projectsFromStore } = useProjectsStore();
    const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

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
        setAttachments(Array.isArray(editingTicket?.attachments) ? editingTicket.attachments : []);
    }, [projects.length, fetchTickets, editingTicket, form, setEditTiketProject]);

    const projectEpics = useMemo(
        () => (editingTicket ? getProjectEpics(editTiketProject ?? '').filter((e) => !e.is_deleted) : []),
        [editTiketProject, editingTicket, getProjectEpics]
    );
    const initialPerformer = toIdString(editingTicket?.performer);
    const initialTaskType = toIdString(editingTicket?.task_type);
    const historicalPerformerIds = useMemo(() => {
        if (!editingTicket) return [];
        const ids: string[] = [];
        if (initialPerformer) ids.push(initialPerformer);

        const notifications = Array.isArray(editingTicket.notifications) ? editingTicket.notifications : [];
        for (const notification of notifications) {
            const notificationId = toIdString(notification);
            if (!notificationId) continue;
            ids.push(notificationId);
        }

        return Array.from(new Set(ids));
    }, [editingTicket, initialPerformer]);

    const historicalPerformerLabels = useMemo(() => {
        const map = new Map<string, string>();
        if (editingTicket?.performer && typeof editingTicket.performer === 'object') {
            const performerRecord = editingTicket.performer;
            const value = toIdString(performerRecord);
            if (value) {
                map.set(value, getPerformerLabel(performerRecord, value));
            }
        }
        return map;
    }, [editingTicket?.performer]);

    const performerOptions = useMemo(() => {
        const result: Array<{ value: string; label: string }> = [];
        const seen = new Set<string>();
        const historicalPerformerIdSet = new Set(historicalPerformerIds);

        for (const performer of performers) {
            const value = toIdString(performer);
            if (!value || seen.has(value)) continue;
            if (!isPerformerSelectable(performer) && !historicalPerformerIdSet.has(value)) continue;

            const baseLabel = getPerformerLabel(performer, value);
            const label = !isPerformerSelectable(performer) && historicalPerformerIdSet.has(value)
                ? `${baseLabel} (архив)`
                : baseLabel;
            result.push({ value, label });
            seen.add(value);
        }

        for (const performerId of historicalPerformerIds) {
            if (!performerId || seen.has(performerId)) continue;
            result.push({ value: performerId, label: historicalPerformerLabels.get(performerId) ?? performerId });
            seen.add(performerId);
        }

        return result;
    }, [historicalPerformerIds, historicalPerformerLabels, performers]);

    if (!editingTicket) return null;

    const resolveAttachmentDownloadUrl = (attachment: TaskAttachment): string | null => {
        if (attachment.download_url) return attachment.download_url;
        if (!editingTicket._id) return null;
        return `/api/crm/tickets/attachment/${encodeURIComponent(editingTicket._id)}/${encodeURIComponent(attachment.attachment_id)}`;
    };

    const formatFileSize = (size: number): string => {
        if (!Number.isFinite(size) || size <= 0) return '0 B';
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };

    const handleAttachmentUpload = async (file: File): Promise<void> => {
        try {
            setIsUploadingAttachment(true);
            const uploaded = await uploadTicketAttachment(file, editingTicket._id ?? undefined);
            setAttachments((prev) => [...prev, uploaded]);
            message.success(`Файл "${uploaded.file_name}" загружен`);
        } catch (error) {
            const errorText =
                error instanceof Error && error.message ? error.message : 'Не удалось загрузить файл';
            message.error(errorText);
        } finally {
            setIsUploadingAttachment(false);
        }
    };

    const handleAttachmentRemove = async (attachment: TaskAttachment): Promise<void> => {
        if (!editingTicket._id) {
            setAttachments((prev) => prev.filter((item) => item.attachment_id !== attachment.attachment_id));
            return;
        }

        try {
            await deleteTicketAttachment(editingTicket._id, attachment.attachment_id);
            setAttachments((prev) => prev.filter((item) => item.attachment_id !== attachment.attachment_id));
            message.success('Вложение удалено');
        } catch (error) {
            const errorText =
                error instanceof Error && error.message ? error.message : 'Не удалось удалить вложение';
            message.error(errorText);
        }
    };

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
                        performer: initialPerformer,
                        task_type: initialTaskType,
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
                        ) as Record<string, unknown>;

                        cleanedValues.attachments = attachments;

                        if (!editingTicket._id) {
                            createTicket(cleanedValues as Parameters<typeof createTicket>[0]);
                        } else {
                            editTicketData(cleanedValues as unknown as Parameters<typeof editTicketData>[0]);
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
                                                        value: toIdString(tt),
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
                                            options={performerOptions}
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
                                            options={performerOptions}
                                            mode="multiple"
                                        />
                                    </Form.Item>
                                </div>
                            </div>

                            <Divider className="!my-2" />
                            <div className="flex flex-col gap-3">
                                <div className="text-sm font-medium">Вложения</div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:border-sky-500 hover:text-sky-600">
                                        <UploadOutlined />
                                        {isUploadingAttachment ? 'Загрузка...' : 'Добавить файл'}
                                        <input
                                            type="file"
                                            className="hidden"
                                            disabled={isUploadingAttachment}
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                event.target.value = '';
                                                if (!file) return;
                                                void handleAttachmentUpload(file);
                                            }}
                                        />
                                    </label>
                                    <div className="text-xs text-slate-500">
                                        Поддерживаемые форматы: pdf, docx, xlsx, png, jpg, txt, zip. До 100MB.
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                    {attachments.length === 0 ? (
                                        <div className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                                            Пока нет вложений
                                        </div>
                                    ) : (
                                        attachments.map((attachment) => {
                                            const downloadUrl = resolveAttachmentDownloadUrl(attachment);
                                            return (
                                                <div
                                                    key={attachment.attachment_id}
                                                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3"
                                                >
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm">{attachment.file_name}</div>
                                                        <div className="text-xs text-slate-500">
                                                            {formatFileSize(attachment.file_size)}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {downloadUrl ? (
                                                            <a
                                                                href={downloadUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-sky-500 hover:text-sky-600"
                                                            >
                                                                <DownloadOutlined />
                                                                Скачать
                                                            </a>
                                                        ) : null}
                                                        <Button
                                                            danger
                                                            size="small"
                                                            type="text"
                                                            onClick={() => {
                                                                void handleAttachmentRemove(attachment);
                                                            }}
                                                        >
                                                            Удалить
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
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
