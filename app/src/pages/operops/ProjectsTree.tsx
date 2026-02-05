/**
 * ProjectsTree Page - Projects management with drag-drop tree
 * Migrated from appkanban/src/pages/ProjectsTree.jsx
 */

import React, { useEffect, useState, ReactNode } from 'react';
import { Tree, Typography, Button, Card, Space, Modal, Divider, ConfigProvider, message } from 'antd';
import {
    UserOutlined,
    FolderOutlined,
    ProjectOutlined,
    PlusOutlined,
    InboxOutlined,
} from '@ant-design/icons';
import { useProjectsStore } from '../../store/projectsStore';
import { EditCustomer, EditProjectGroup, EditProject } from '../../components/crm/projects';
import type { TreeNode, Customer, ProjectGroup, ProjectWithGroup } from '../../types/crm';
import type { TreeProps, TreeDataNode } from 'antd';
import type { Key } from 'react';

const { Title, Text } = Typography;

// Type for drag node
type DragNode = TreeNode & { type: string };

// Helper to find node by key
const findNodeByKey = (nodes: TreeNode[], key: Key): TreeNode | undefined => {
    for (const node of nodes) {
        if (node.key === key) return node;
        if (node.children) {
            const found = findNodeByKey(node.children, key);
            if (found) return found;
        }
    }
    return undefined;
};

// Helper to find parent node
const findParentNodeByChildKey = (nodes: TreeNode[], childKey: Key): TreeNode | undefined => {
    for (const node of nodes) {
        if (node.children?.some((c) => c.key === childKey)) return node;
        if (node.children) {
            const found = findParentNodeByChildKey(node.children, childKey);
            if (found) return found;
        }
    }
    return undefined;
};

const ProjectsTree: React.FC = () => {
    const {
        customers,
        projectGroups,
        projects,
        tree,
        fetchCustomers,
        fetchProjectGroups,
        fetchProjects,
        buildTree,
        moveProjectGroup,
        moveProject,
    } = useProjectsStore();

    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [showCreateCustomer, setShowCreateCustomer] = useState(false);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [showCreateProject, setShowCreateProject] = useState(false);

    // Load data on mount
    useEffect(() => {
        const loadData = async () => {
            await Promise.all([fetchCustomers(), fetchProjectGroups(), fetchProjects()]);
        };
        loadData();
    }, [fetchCustomers, fetchProjectGroups, fetchProjects]);

    // Build tree when data changes
    useEffect(() => {
        if (customers.length > 0 || projectGroups.length > 0 || projects.length > 0) {
            buildTree();
        }
    }, [customers, projectGroups, projects, buildTree]);

    // Handle drag enter
    const onDragEnter: TreeProps['onDragEnter'] = (_info) => {
        // Placeholder for drag enter effects
    };

    // Handle drop
    const onDrop: TreeProps['onDrop'] = async (info) => {
        const dragKey = info.dragNode.key;
        const dropKey = info.node.key;
        const dragType = (info.dragNode as unknown as DragNode).type;
        const dropType = (info.node as unknown as DragNode).type;

        // Only allow drop inside (dropPosition === 0)
        if (info.dropPosition === 0) {
            try {
                if (dragType === 'group' && dropType === 'customer') {
                    // Move group to customer
                    const draggedGroup = findNodeByKey(tree, dragKey);
                    const sourceCustomer = findParentNodeByChildKey(tree, dragKey);
                    const destCustomer = findNodeByKey(tree, dropKey);

                    if (draggedGroup && sourceCustomer && destCustomer && sourceCustomer.key !== destCustomer.key) {
                        await moveProjectGroup(
                            draggedGroup,
                            sourceCustomer.data as Customer,
                            destCustomer.data as Customer
                        );
                        message.success(`Группа "${draggedGroup.title}" перемещена`);
                    }
                } else if (dragType === 'project' && dropType === 'group') {
                    // Move project to group
                    const draggedProject = findNodeByKey(tree, dragKey);
                    const sourceGroup = findParentNodeByChildKey(tree, dragKey);
                    const destGroup = findNodeByKey(tree, dropKey);

                    if (draggedProject && destGroup) {
                        if (sourceGroup?.type === 'unassigned-category') {
                            // Move from unassigned to group
                            await moveProject(
                                draggedProject,
                                null as unknown as ProjectGroup,
                                destGroup.data as ProjectGroup
                            );
                            message.success(`Проект "${draggedProject.title}" добавлен в группу "${destGroup.title}"`);
                        } else if (sourceGroup && sourceGroup.key !== destGroup.key) {
                            await moveProject(
                                draggedProject,
                                sourceGroup.data as ProjectGroup,
                                destGroup.data as ProjectGroup
                            );
                            message.success(`Проект "${draggedProject.title}" перемещен в группу "${destGroup.title}"`);
                        }
                    }
                }
            } catch (error) {
                console.error('Error during drag and drop:', error);
                message.error('Ошибка при перемещении элемента');
            }
        }
    };

    // Render tree node title
    const renderTreeData = (nodes: TreeNode[]): TreeDataNode[] => {
        return nodes.map((node): TreeDataNode => {
            if (node.type === 'unassigned-category') {
                const children = node.children?.map((project): TreeDataNode => ({
                    key: project.key ?? '',
                    title: (
                        <div className="flex items-center gap-2">
                            <ProjectOutlined className="text-red-500" />
                            <span>{project.title}</span>
                            <span className="text-xs text-red-400">не распределен</span>
                        </div>
                    ) as ReactNode,
                })) ?? [];

                return {
                    key: node.key ?? '',
                    title: (
                        <div className="flex items-center gap-2">
                            <InboxOutlined className="text-gray-500" />
                            <span className="font-medium text-gray-600">{node.title}</span>
                            <span className="text-xs text-gray-400">
                                ({node.children?.length ?? 0} проектов)
                            </span>
                        </div>
                    ) as ReactNode,
                    children,
                };
            }

            // Regular customers
            const customerChildren = node.children?.map((group): TreeDataNode => {
                const groupChildren = group.children?.map((project): TreeDataNode => ({
                    key: project.key ?? '',
                    title: (
                        <div className="flex items-center gap-2">
                            <ProjectOutlined className="text-green-500" />
                            <span>{project.title}</span>
                        </div>
                    ) as ReactNode,
                })) ?? [];

                return {
                    key: group.key ?? '',
                    title: (
                        <div className="flex items-center gap-2">
                            <FolderOutlined className="text-orange-500" />
                            <span>{group.title}</span>
                            <span className="text-xs text-gray-400">
                                ({group.children?.length ?? 0} проектов)
                            </span>
                        </div>
                    ) as ReactNode,
                    children: groupChildren,
                };
            }) ?? [];

            return {
                key: node.key ?? '',
                title: (
                    <div className="flex items-center gap-2">
                        <UserOutlined className="text-blue-500" />
                        <span className="font-medium">{node.title}</span>
                        <span className="text-xs text-gray-400">
                            ({node.children?.length ?? 0} групп)
                        </span>
                    </div>
                ) as ReactNode,
                children: customerChildren,
            };
        });
    };

    const handleTreeSelect = (selectedKeys: Key[]) => {
        const key = selectedKeys[0];
        if (key) {
            setSelectedNode(findNodeByKey(tree, key) ?? null);
        } else {
            setSelectedNode(null);
        }
    };

    const handleSaveAndRefresh = async () => {
        await Promise.all([fetchCustomers(), fetchProjectGroups(), fetchProjects()]);
        buildTree();
        setSelectedNode(null);
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-7xl mx-auto">
                {/* Page header */}
                <div className="mb-6">
                    <Title level={2} className="mb-2">
                        Управление проектами
                    </Title>
                    <Text type="secondary">
                        Организация проектов по схеме: Заказчик → Группа проектов → Проект
                    </Text>
                </div>

                {/* Action buttons */}
                <div className="mb-6">
                    <Space size="middle">
                        <Button
                            type="default"
                            icon={<PlusOutlined />}
                            onClick={() => setShowCreateCustomer(true)}
                            size="large"
                        >
                            Новый заказчик
                        </Button>
                        <Button
                            type="default"
                            icon={<PlusOutlined />}
                            onClick={() => setShowCreateGroup(true)}
                            size="large"
                        >
                            Новая группа
                        </Button>
                        <Button
                            type="default"
                            icon={<PlusOutlined />}
                            onClick={() => setShowCreateProject(true)}
                            size="large"
                        >
                            Новый проект
                        </Button>
                    </Space>
                </div>

                <div className="flex gap-6">
                    {/* Projects tree */}
                    <Card
                        title="Структура проектов"
                        className="flex-shrink-0 w-[350px]"
                        styles={{ body: { padding: '16px' } }}
                    >
                        {Array.isArray(tree) && tree.length > 0 ? (
                            <Tree
                                virtual={false}
                                defaultExpandAll
                                defaultExpandParent
                                showLine={{ showLeafIcon: false }}
                                draggable={(node) => {
                                    const n = node as unknown as DragNode;
                                    return n.type === 'project' || n.type === 'group';
                                }}
                                allowDrop={({ dragNode, dropNode }) => {
                                    const drag = dragNode as unknown as DragNode;
                                    const drop = dropNode as unknown as DragNode;
                                    // Group can be dropped into customer
                                    if (drag.type === 'group' && drop.type === 'customer') return true;
                                    // Project can be dropped into group
                                    if (drag.type === 'project' && drop.type === 'group') return true;
                                    return false;
                                }}
                                blockNode
                                height={600}
                                onDragEnter={onDragEnter}
                                onDrop={onDrop}
                                treeData={renderTreeData(tree)}
                                onSelect={handleTreeSelect}
                            />
                        ) : (
                            <div className="text-center py-8 text-gray-500">
                                <FolderOutlined className="text-5xl text-[#d9d9d9] mb-4" />
                                <br />
                                <Text type="secondary">Нет данных для отображения</Text>
                                <br />
                                <Text type="secondary" className="text-xs">
                                    Создайте первого заказчика, чтобы начать
                                </Text>
                            </div>
                        )}
                    </Card>

                    {/* Edit panel */}
                    <Card
                        title={selectedNode ? `Редактирование: ${selectedNode.title}` : 'Выберите элемент'}
                        className="flex-grow"
                        styles={{ body: { padding: '24px' } }}
                    >
                        <ConfigProvider
                            theme={{
                                components: {
                                    Form: {
                                        itemMarginBottom: 20,
                                    },
                                    Input: {
                                        borderRadius: 6,
                                    },
                                    Button: {
                                        borderRadius: 6,
                                    },
                                },
                            }}
                        >
                            {selectedNode?.type === 'project' ? (
                                <EditProject
                                    key={selectedNode.data?._id}
                                    project={selectedNode.data as ProjectWithGroup}
                                    projectGroups={projectGroups}
                                    customers={customers}
                                    onSave={handleSaveAndRefresh}
                                />
                            ) : selectedNode?.type === 'group' ? (
                                <EditProjectGroup
                                    key={selectedNode.data?._id}
                                    group={selectedNode.data as ProjectGroup}
                                    customers={customers}
                                    onSave={handleSaveAndRefresh}
                                />
                            ) : selectedNode?.type === 'customer' ? (
                                <EditCustomer
                                    key={selectedNode.data?._id}
                                    customer={selectedNode.data as Customer}
                                    onSave={handleSaveAndRefresh}
                                />
                            ) : selectedNode?.type === 'unassigned-category' ? (
                                <div className="text-center py-12">
                                    <div className="text-gray-400 mb-4">
                                        <InboxOutlined className="text-5xl" />
                                    </div>
                                    <Title level={4} type="secondary">
                                        Нераспределенные проекты
                                    </Title>
                                    <Text type="secondary">
                                        Проекты, которые еще не привязаны к группам.
                                        <br />
                                        Перетащите их в нужные группы для организации.
                                    </Text>
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <div className="text-gray-400 mb-4">
                                        <ProjectOutlined className="text-5xl" />
                                    </div>
                                    <Title level={4} type="secondary">
                                        Выберите элемент для редактирования
                                    </Title>
                                    <Text type="secondary">
                                        Выберите заказчика, группу или проект в дереве слева
                                    </Text>
                                </div>
                            )}
                        </ConfigProvider>
                    </Card>
                </div>

                {/* Modals */}
                <Modal
                    open={showCreateCustomer}
                    title={
                        <div className="flex items-center gap-2">
                            <UserOutlined className="text-blue-500" />
                            Создать нового заказчика
                        </div>
                    }
                    footer={null}
                    onCancel={() => setShowCreateCustomer(false)}
                    width={500}
                >
                    <Divider />
                    <EditCustomer
                        onSave={() => {
                            handleSaveAndRefresh();
                            setShowCreateCustomer(false);
                        }}
                    />
                </Modal>

                <Modal
                    open={showCreateGroup}
                    title={
                        <div className="flex items-center gap-2">
                            <FolderOutlined className="text-orange-500" />
                            Создать группу проектов
                        </div>
                    }
                    footer={null}
                    onCancel={() => setShowCreateGroup(false)}
                    width={600}
                >
                    <Divider />
                    <EditProjectGroup
                        customers={customers}
                        onSave={() => {
                            handleSaveAndRefresh();
                            setShowCreateGroup(false);
                        }}
                    />
                </Modal>

                <Modal
                    open={showCreateProject}
                    title={
                        <div className="flex items-center gap-2">
                            <ProjectOutlined className="text-green-500" />
                            Создать новый проект
                        </div>
                    }
                    footer={null}
                    onCancel={() => setShowCreateProject(false)}
                    width={600}
                >
                    <Divider />
                    <EditProject
                        customers={customers}
                        projectGroups={projectGroups}
                        onSave={() => {
                            handleSaveAndRefresh();
                            setShowCreateProject(false);
                        }}
                    />
                </Modal>
            </div>
        </div>
    );
};

export default ProjectsTree;
