/**
 * EditProject Component - Create/Edit Project form
 * Migrated from appkanban/src/components/projects/EditProject.jsx
 */

import React, { useState } from 'react';
import {
    Input,
    Button,
    Form,
    Select,
    message,
    DatePicker,
    InputNumber,
    Switch,
    Space,
    Divider,
} from 'antd';
import { useProjectsStore } from '../../../store/projectsStore';
import type { Customer, ProjectGroup, ProjectWithGroup } from '../../../types/crm';
import dayjs, { Dayjs } from 'dayjs';

const { TextArea } = Input;

interface EditProjectProps {
    project?: ProjectWithGroup;
    projectGroups: ProjectGroup[];
    customers: Customer[];
    onSave?: () => void;
}

interface ProjectFormValues {
    name: string;
    project_group?: string | undefined;
    is_active: boolean;
    start_date?: Dayjs | null | undefined;
    end_date?: Dayjs | null | undefined;
    time_capacity?: number | undefined;
    description?: string | undefined;
    drive_folder_id?: string | undefined;
    git_repo?: string | undefined;
}

const EditProject: React.FC<EditProjectProps> = ({
    project,
    projectGroups,
    customers: _customers,
    onSave,
}) => {
    const [form] = Form.useForm<ProjectFormValues>();
    const [loading, setLoading] = useState(false);
    const { createProject, updateProject } = useProjectsStore();

    // Initial values for the form
    const getInitialValues = (proj?: ProjectWithGroup): ProjectFormValues => {
        if (proj) {
            return {
                name: proj.name,
                project_group: proj.project_group,
                is_active: proj.is_active ?? false,
                start_date: proj.start_date ? dayjs(proj.start_date) : null,
                end_date: proj.end_date ? dayjs(proj.end_date) : null,
                time_capacity: proj.time_capacity,
                description: proj.description,
                drive_folder_id: proj.drive_folder_id,
                git_repo: proj.git_repo,
            };
        }
        return {
            name: '',
            is_active: true,
            drive_folder_id: '1Y8KaMhqi9HeiNUgiJtvYsdzOvMQvS8KD',
        };
    };

    const initialValues = getInitialValues(project);

    const handleSave = async (values: ProjectFormValues) => {
        setLoading(true);
        try {
            const projectData: Record<string, unknown> = {
                name: values.name,
                is_active: values.is_active,
            };
            if (values.project_group) {
                projectData.project_group = values.project_group;
            }
            if (values.time_capacity !== undefined) {
                projectData.time_capacity = values.time_capacity;
            }
            if (values.description !== undefined) {
                projectData.description = values.description;
            }
            if (values.drive_folder_id !== undefined) {
                projectData.drive_folder_id = values.drive_folder_id;
            }
            if (values.git_repo !== undefined) {
                projectData.git_repo = values.git_repo;
            }
            if (values.start_date) {
                projectData.start_date = values.start_date.toISOString();
            }
            if (values.end_date) {
                projectData.end_date = values.end_date.toISOString();
            }

            if (project) {
                await updateProject(project._id, projectData as Partial<ProjectWithGroup>);
                message.success('Проект обновлен');
            } else {
                await createProject(projectData as Partial<ProjectWithGroup> & { project_group?: string });
                message.success('Проект создан');
            }
            onSave?.();
        } catch (e) {
            message.error('Ошибка сохранения');
            console.error(e);
        }
        setLoading(false);
    };

    return (
        <div className="p-6 max-w-[800px]">
            <Form
                key={project?._id ?? 'new-project'}
                form={form}
                layout="vertical"
                initialValues={initialValues}
                onFinish={handleSave}
                autoComplete="off"
            >
                {/* Main fields */}
                <Space.Compact block>
                    <Form.Item
                        label="Название проекта"
                        name="name"
                        rules={[{ required: true, message: 'Укажите название проекта' }]}
                        className="w-[40%]"
                    >
                        <Input placeholder="Введите название" />
                    </Form.Item>

                    <Form.Item
                        label="Группа проектов"
                        name="project_group"
                        className="w-[30%]"
                        rules={project ? [] : [{ required: true, message: 'Выберите группу проекта' }]}
                    >
                        <Select placeholder="Выберите группу" allowClear>
                            {projectGroups.map((group) => (
                                <Select.Option key={group._id} value={group._id}>
                                    {group.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label="Статус"
                        name="is_active"
                        valuePropName="checked"
                        className="w-[30%]"
                    >
                        <Switch
                            className="w-[92px] ml-4"
                            checkedChildren="Активен"
                            unCheckedChildren="Неактивен"
                        />
                    </Form.Item>
                </Space.Compact>

                {/* Dates and time */}
                <Space.Compact block>
                    <Form.Item label="Дата начала" name="start_date" className="w-1/3">
                        <DatePicker className="w-full" />
                    </Form.Item>

                    <Form.Item label="Дата окончания" name="end_date" className="w-1/3">
                        <DatePicker className="w-full" />
                    </Form.Item>

                    <Form.Item label="Время (часы)" name="time_capacity" className="w-1/3">
                        <InputNumber
                            className="w-full"
                            controls={false}
                            placeholder="0"
                            min={0}
                        />
                    </Form.Item>
                </Space.Compact>

                {/* Description */}
                <Form.Item label="Описание" name="description">
                    <TextArea rows={3} placeholder="Описание проекта" />
                </Form.Item>

                {/* Google Drive */}
                <Form.Item label="Google Drive Folder ID" name="drive_folder_id">
                    <Input placeholder="ID папки Google Drive" />
                </Form.Item>
                <Form.Item label="Git Repo" name="git_repo">
                    <Input placeholder="https://github.com/org/repo или owner/repo" />
                </Form.Item>
                <Divider />

                {/* Action buttons */}
                <Form.Item>
                    <Space>
                        <Button type="primary" htmlType="submit" loading={loading}>
                            {project ? 'Сохранить' : 'Создать'}
                        </Button>
                        {onSave && <Button onClick={() => onSave()}>Отмена</Button>}
                    </Space>
                </Form.Item>
            </Form>
        </div>
    );
};

export default EditProject;
