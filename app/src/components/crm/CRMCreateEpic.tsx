import { useEffect, useRef } from 'react';
import { Form, Input, Button, Select } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, DeleteOutlined } from '@ant-design/icons';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import { useProjectsStore } from '../../store/projectsStore';
import type { Project, Epic } from '../../types/crm';

const { TextArea } = Input;

interface EpicFormValues {
    _id?: string | null | undefined;
    name: string;
    project: string;
    description?: string;
}

const CRMCreateEpic = () => {
    const [form] = Form.useForm<EpicFormValues>();
    const formRef = useRef(form);
    const { editingEpic, setEditingEpic } = useCRMStore();
    const { projectsData, fetchDictionary, createEpic, editEpic, deleteEpic } = useKanbanStore();
    const { customers, projectGroups } = useProjectsStore();

    // Функция для получения полной информации о проекте
    const getProjectDisplayName = (project: Project): string => {
        if (!project) return '';

        const group = projectGroups.find(
            (g) => g._id && project.project_group && g._id.toString() === project.project_group.toString()
        );
        const customer = group
            ? customers.find(
                (c) => c._id && group.customer && c._id.toString() === group.customer.toString()
            )
            : null;

        return `${project.name} (${customer?.name ?? 'Unknown'} / ${group?.name ?? 'Unassigned'})`;
    };

    useEffect(() => {
        if (projectsData.length === 0) fetchDictionary();
        if (formRef.current) formRef.current.resetFields();
    }, [projectsData.length, fetchDictionary]);

    if (!editingEpic) return null;

    return (
        <div className="text-black flex flex-col pt-4">
            <div className="flex justify-between items-center">
                <div className="flex gap-4">
                    <ArrowLeftOutlined
                        className="hover:text-sky-700 cursor-pointer"
                        onClick={() => setEditingEpic(null)}
                    />
                    {editingEpic._id === null ? <div>Создать эпик</div> : <div>Редактировать эпик</div>}
                </div>
                <div className="flex gap-4">
                    <Button
                        type="primary"
                        shape="circle"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => {
                            if (editingEpic._id) deleteEpic(editingEpic as Epic);
                            setEditingEpic(null);
                        }}
                    />
                    <Button
                        type="primary"
                        shape="circle"
                        icon={<CheckOutlined />}
                        onClick={() => form.submit()}
                    />
                </div>
            </div>
            <div className="flex flex-col w-full mt-4">
                <Form
                    form={form}
                    layout="vertical"
                    initialValues={editingEpic}
                    onFinish={(values) => {
                        const epicData = {
                            name: values.name,
                            project: values.project,
                            description: values.description ?? '',
                        };
                        if (!editingEpic._id) {
                            createEpic(epicData);
                        } else {
                            editEpic({ _id: editingEpic._id, ...epicData } as Epic);
                        }
                        setEditingEpic(null);
                        fetchDictionary();
                    }}
                >
                    <Form.Item hidden name="_id">
                        <Input type="hidden" />
                    </Form.Item>
                    <div className="flex gap-4 items-center">
                        <div className="w-[124px] flex-shrink-0 flex-grow-0">Название:</div>
                        <div className="flex gap-4">
                            <Form.Item
                                label="Название эпика:"
                                name="name"
                                className="w-[200px]"
                                rules={[{ required: true, message: 'Введите заголовок' }]}
                            >
                                <Input />
                            </Form.Item>
                        </div>
                    </div>
                    <div className="flex gap-4 items-center">
                        <div className="w-[124px] flex-shrink-0 flex-grow-0">О эпике:</div>
                        <div className="flex gap-4">
                            <Form.Item
                                label="Проект:"
                                name="project"
                                className="w-[200px]"
                                rules={[{ required: true, message: 'Выберите проект' }]}
                            >
                                <Select
                                    options={projectsData.map((project) => ({
                                        value: project._id,
                                        label: getProjectDisplayName(project),
                                    }))}
                                    showSearch
                                    filterOption={(inputValue, option) =>
                                        (option?.label ?? '').toLowerCase().includes(inputValue.toLowerCase())
                                    }
                                />
                            </Form.Item>
                        </div>
                    </div>

                    <div className="flex gap-4 items-start">
                        <div className="w-[124px] flex-shrink-0 flex-grow-0">Описание</div>
                        <div className="flex gap-4">
                            <Form.Item name="description">
                                <TextArea
                                    className="h-[300px] w-[1000px] resize-y"
                                    placeholder="Введите описание эпика."
                                />
                            </Form.Item>
                        </div>
                    </div>
                </Form>
            </div>
        </div>
    );
};

export default CRMCreateEpic;
