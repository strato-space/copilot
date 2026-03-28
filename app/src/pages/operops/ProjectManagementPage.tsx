import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Typography } from 'antd';
import { ArrowLeftOutlined, ProjectOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';

import { EditProject } from '../../components/crm/projects';
import { useProjectsStore } from '../../store/projectsStore';
import type { ProjectWithGroup } from '../../types/crm';

const { Title, Text } = Typography;

const ProjectManagementPage: React.FC = () => {
    const navigate = useNavigate();
    const { projectId } = useParams<{ projectId: string }>();
    const isCreateMode = !projectId || projectId === 'new';
    const {
        customers,
        projectGroups,
        projects,
        fetchCustomers,
        fetchProjectGroups,
        fetchProjects,
    } = useProjectsStore();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        const loadData = async (): Promise<void> => {
            setLoading(true);
            try {
                await Promise.all([fetchCustomers(true), fetchProjectGroups(true), fetchProjects(true)]);
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        void loadData();

        return () => {
            mounted = false;
        };
    }, [fetchCustomers, fetchProjectGroups, fetchProjects]);

    const project = useMemo<ProjectWithGroup | undefined>(() => {
        if (!projectId || projectId === 'new') return undefined;
        return projects.find((item) => item._id === projectId);
    }, [projectId, projects]);

    const handleBack = (): void => {
        void navigate('/operops/projects-tree');
    };

    return (
        <div className="w-full max-w-[1400px] mx-auto">
            <Card>
                <Space orientation="vertical" size={20} className="w-full">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <ProjectOutlined className="text-lg text-green-500" />
                            <div>
                                <Title level={3} className="!mb-0">
                                    {isCreateMode ? 'Создание проекта' : 'Управление проектом'}
                                </Title>
                                <Text type="secondary">
                                    {isCreateMode
                                        ? 'Новый проект'
                                        : project
                                          ? project.name
                                          : 'Загрузка проекта'}
                                </Text>
                            </div>
                        </div>
                        <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
                            К дереву проектов
                        </Button>
                    </div>

                    {loading && (isCreateMode || !project) ? (
                        <div className="py-16 flex justify-center">
                            <Spin size="large" />
                        </div>
                    ) : isCreateMode ? (
                        <EditProject
                            projectGroups={projectGroups}
                            customers={customers}
                            onSave={handleBack}
                            onCancel={handleBack}
                        />
                    ) : project ? (
                        <EditProject
                            key={project._id}
                            project={project}
                            projectGroups={projectGroups}
                            customers={customers}
                            onSave={() => {
                                void fetchProjects(true);
                            }}
                            onCancel={handleBack}
                        />
                    ) : (
                        <Alert
                            type="warning"
                            showIcon
                            message="Проект не найден"
                            description="Проверьте ссылку или вернитесь к дереву проектов и выберите проект снова."
                        />
                    )}
                </Space>
            </Card>
        </div>
    );
};

export default ProjectManagementPage;
