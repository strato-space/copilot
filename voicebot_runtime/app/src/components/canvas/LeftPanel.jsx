import React, { useState, useMemo } from 'react';
import { Card, Button, List, Divider } from 'antd';
import { FolderOpenOutlined, UploadOutlined, ArrowLeftOutlined, RightOutlined } from '@ant-design/icons';
import { useProjectFiles } from '../../store/project_files';
import ProjectTree from './ProjectTree';

const LeftPanel = ({ onUploadClick, onSelect }) => {
    const {
        projects,
        buildFilteredProjectTree
    } = useProjectFiles();

    // Состояние для навигации
    const [selectedProjectForTree, setSelectedProjectForTree] = useState(null);
    const [currentLevel, setCurrentLevel] = useState('projects'); // 'projects' | 'files'

    // Группируем проекты по customer
    const groupedData = useMemo(() => {
        if (!Array.isArray(projects)) return {};

        const grouped = {};

        projects.forEach(project => {
            const customerName = project.customer?.name || 'Без клиента';
            const customerId = project.customer?._id || 'no-customer';

            if (!grouped[customerId]) {
                grouped[customerId] = {
                    customerName,
                    projects: []
                };
            }

            grouped[customerId].projects.push({
                id: project._id,
                name: project.name || `Проект ${project._id}`,
                projectGroupName: project.project_group?.name || 'Без группы',
                data: project
            });
        });

        // Сортируем проекты внутри каждого клиента
        Object.values(grouped).forEach(customerData => {
            customerData.projects.sort((a, b) => a.name.localeCompare(b.name));
        });

        return grouped;
    }, [projects]);

    // Фильтруем проекты только для выбранного проекта
    const filteredProjectTree = useMemo(() => {
        if (!selectedProjectForTree) return [];
        // Фильтруем проекты по конкретному проекту
        return projects
            .filter(project => project._id === selectedProjectForTree.id)
            .map(project => {
                // Строим дерево только для этого проекта
                return buildFilteredProjectTree(null, null).find(
                    treeProject => treeProject.key === `project-${project._id}`
                );
            })
            .filter(Boolean);
    }, [projects, selectedProjectForTree, buildFilteredProjectTree]);

    const handleProjectClick = (project) => {
        setSelectedProjectForTree(project);
        setCurrentLevel('files');
    };

    const handleBackToProjects = () => {
        setSelectedProjectForTree(null);
        setCurrentLevel('projects');
    };

    const renderProjectsList = () => {
        return (
            <div className="h-full overflow-y-auto flex-1">
                {Object.entries(groupedData).map(([customerId, customerData]) => (
                    <div key={customerId}>
                        <div className="p-1 bg-gray-100">
                            <span className="text-xs text-gray-600 font-medium">
                                {customerData.customerName}
                            </span>
                        </div>

                        <List
                            size="small"
                            dataSource={customerData.projects}
                            renderItem={(project) => (
                                <List.Item
                                    className="!px-2 !py-1 cursor-pointer hover:bg-gray-50 rounded transition-colors"
                                    onClick={() => handleProjectClick(project)}
                                >
                                    <div className="flex items-center gap-2 w-full">
                                        <div className="flex-1">
                                            <div className="text-sm">{project.name}</div>
                                            <div className="text-xs text-gray-500">{project.projectGroupName}</div>
                                        </div>
                                        <RightOutlined className="text-gray-400" />
                                    </div>
                                </List.Item>
                            )}
                        />
                    </div>
                ))}
            </div>
        );
    };

    const renderProjectTree = () => {
        return (
            <div className="h-full flex flex-col">
                {/* Кнопка "Назад" */}
                <div className="flex items-center gap-2 pb-3 border-b border-gray-200 mb-3">
                    <Button
                        type="text"
                        icon={<ArrowLeftOutlined />}
                        onClick={handleBackToProjects}
                        size="small"
                    >
                        Назад
                    </Button>
                    <span className="text-sm font-medium text-gray-700">
                        {selectedProjectForTree?.name}
                    </span>
                </div>

                {/* Дерево файлов и сессий */}
                <div className="flex-1 overflow-hidden">
                    <ProjectTree
                        treeData={filteredProjectTree}
                        onSelect={onSelect}
                        customerFilter={null}
                        projectGroupFilter={null}
                    />
                </div>
            </div>
        );
    };

    return (
        <Card
            title={
                <div className="flex items-center gap-2 justify-between">
                    <div className='flex gap-2'>
                        <FolderOpenOutlined />
                        <span>
                            {currentLevel === 'projects' ? 'Проекты' : 'Файлы и сессии'}
                        </span>
                    </div>
                    <div>
                        {
                            selectedProjectForTree && currentLevel === 'files' ? (
                                <Button
                                    type="primary"
                                    icon={<UploadOutlined />}
                                    onClick={() => onUploadClick(selectedProjectForTree.data)}
                                    size="small"
                                >
                                </Button>
                            ) : null
                        }
                    </div>
                </div>
            }
            className="w-full lg:w-[400px] flex-shrink-0 flex flex-col lg:max-h-full max-h-[300px]"
            styles={{ body: { padding: '16px', height: 'calc(100% - 60px)', display: 'flex', flexDirection: 'column' } }}
        >
            {currentLevel === 'projects' ? renderProjectsList() : renderProjectTree()}
        </Card>
    );
};

export default LeftPanel;
