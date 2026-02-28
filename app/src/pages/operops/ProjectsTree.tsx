/**
 * ProjectsTree Page - Projects management in hierarchical table mode
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Typography,
    Button,
    Card,
    Space,
    Modal,
    Divider,
    ConfigProvider,
    Switch,
    Table,
    Tag,
    Select,
    Input,
    message,
} from 'antd';
import {
    UserOutlined,
    FolderOutlined,
    ProjectOutlined,
    PlusOutlined,
    InboxOutlined,
    EditOutlined,
    EyeOutlined,
    EyeInvisibleOutlined,
    SwapOutlined,
} from '@ant-design/icons';
import { useProjectsStore } from '../../store/projectsStore';
import { useRequestStore } from '../../store/requestStore';
import { EditCustomer, EditProjectGroup, EditProject } from '../../components/crm/projects';
import type { Customer, ProjectGroup, ProjectWithGroup, TreeNode } from '../../types/crm';
import type { TableProps } from 'antd';

const { Title, Text } = Typography;
const { TextArea } = Input;

type RowType = 'customer' | 'group' | 'project' | 'bucket';

interface ProjectTreeMetrics {
    projects_count?: number;
    voices_count?: number;
    tasks_count?: number;
}

interface ProjectTreeApiNode {
    id?: string;
    type?: 'customer' | 'group' | 'project';
    name?: string;
    is_active?: boolean;
    metrics?: ProjectTreeMetrics;
    children?: ProjectTreeApiNode[];
    data?: Record<string, unknown>;
}

interface ProjectTreeResponse {
    tree?: ProjectTreeApiNode[];
    unassigned_groups?: ProjectTreeApiNode[];
    unassigned_projects?: ProjectTreeApiNode[];
}

interface TableRow {
    key: string;
    id: string;
    type: RowType;
    name: string;
    parentId?: string;
    parentName?: string;
    is_active?: boolean;
    voices_count: number;
    tasks_count: number;
    projects_count: number;
    children?: TableRow[];
    data?: Record<string, unknown>;
}

interface MoveDialogState {
    open: boolean;
    row: TableRow | null;
    targetId: string | null;
    loading: boolean;
}

interface MergeDialogState {
    open: boolean;
    sourceRow: TableRow | null;
    targetId: string | null;
    reason: string;
    preview: Record<string, unknown> | null;
    loading: boolean;
}

interface ProjectsTreeUiState {
    createCustomerOpen: boolean;
    createGroupOpen: boolean;
    createProjectOpen: boolean;
    editModalOpen: boolean;
    showInactive: boolean;
}

const numberValue = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return 0;
};

const statusTag = (isActive: boolean | undefined): React.ReactNode =>
    isActive === false ? <Tag color="orange">Скрыт</Tag> : <Tag color="green">Активен</Tag>;

const typeLabel = (type: RowType): string => {
    if (type === 'customer') return 'Заказчик';
    if (type === 'group') return 'Группа';
    if (type === 'project') return 'Проект';
    return 'Категория';
};

const typeIcon = (type: RowType): React.ReactNode => {
    if (type === 'customer') return <UserOutlined className="text-blue-500" />;
    if (type === 'group') return <FolderOutlined className="text-orange-500" />;
    if (type === 'project') return <ProjectOutlined className="text-green-500" />;
    return <InboxOutlined className="text-gray-500" />;
};

const mergeProjectMetrics = (rows: TableRow[]): ProjectTreeMetrics =>
    rows.reduce(
        (acc, row) => ({
            projects_count: (acc.projects_count ?? 0) + row.projects_count,
            voices_count: (acc.voices_count ?? 0) + row.voices_count,
            tasks_count: (acc.tasks_count ?? 0) + row.tasks_count,
        }),
        { projects_count: 0, voices_count: 0, tasks_count: 0 }
    );

const toTreeNodeFromRow = (row: TableRow): TreeNode | null => {
    if (row.type === 'bucket') return null;
    return {
        key: `${row.type}-${row.id}`,
        title: row.name,
        type: row.type as 'customer' | 'group' | 'project',
        data: row.data as unknown as Customer | ProjectGroup | ProjectWithGroup,
    };
};

const ProjectsTree: React.FC = () => {
    const {
        customers,
        projectGroups,
        projects,
        fetchCustomers,
        fetchProjectGroups,
        fetchProjects,
    } = useProjectsStore();
    const api_request = useRequestStore((state) => state.api_request);

    const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
    const [uiState, setUiState] = useState<ProjectsTreeUiState>({
        createCustomerOpen: false,
        createGroupOpen: false,
        createProjectOpen: false,
        editModalOpen: false,
        showInactive: false,
    });
    const [tableRows, setTableRows] = useState<TableRow[]>([]);
    const [tableLoading, setTableLoading] = useState(false);
    const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
    const [moveDialog, setMoveDialog] = useState<MoveDialogState>({
        open: false,
        row: null,
        targetId: null,
        loading: false,
    });
    const [mergeDialog, setMergeDialog] = useState<MergeDialogState>({
        open: false,
        sourceRow: null,
        targetId: null,
        reason: '',
        preview: null,
        loading: false,
    });

    const buildTableRows = useCallback((response: ProjectTreeResponse): TableRow[] => {
        const convertNode = (
            node: ProjectTreeApiNode,
            parent?: { id: string; name: string }
        ): TableRow => {
            const rowType = (node.type ?? 'project') as 'customer' | 'group' | 'project';
            const id = String(node.id ?? node.data?._id ?? `${rowType}-unknown`);
            const metrics = node.metrics ?? {};
            const childrenRows = Array.isArray(node.children)
                ? node.children.map((child) => convertNode(child, { id, name: String(node.name ?? '—') }))
                : [];

            const childrenMetrics = mergeProjectMetrics(childrenRows);
            const hasChildrenMetrics = childrenRows.length > 0;

            const baseRow: TableRow = {
                key: `${rowType}-${id}`,
                id,
                type: rowType,
                name: String(node.name ?? '—'),
                is_active: node.is_active !== false,
                voices_count: hasChildrenMetrics
                    ? numberValue(childrenMetrics.voices_count)
                    : numberValue(metrics.voices_count),
                tasks_count: hasChildrenMetrics
                    ? numberValue(childrenMetrics.tasks_count)
                    : numberValue(metrics.tasks_count),
                projects_count: hasChildrenMetrics
                    ? numberValue(childrenMetrics.projects_count)
                    : Math.max(numberValue(metrics.projects_count), rowType === 'project' ? 1 : 0),
            };

            if (parent) {
                baseRow.parentId = parent.id;
                baseRow.parentName = parent.name;
            }
            if (childrenRows.length > 0) {
                baseRow.children = childrenRows;
            }
            if (node.data && typeof node.data === 'object') {
                baseRow.data = node.data;
            }

            return baseRow;
        };

        const rows = Array.isArray(response.tree)
            ? response.tree.map((node) => convertNode(node))
            : [];

        const unassignedGroups = Array.isArray(response.unassigned_groups)
            ? response.unassigned_groups.map((node) =>
                convertNode(node, { id: 'unassigned-groups', name: 'Нераспределенные группы' })
            )
            : [];

        const unassignedProjects = Array.isArray(response.unassigned_projects)
            ? response.unassigned_projects.map((node) =>
                convertNode(node, { id: 'unassigned-projects', name: 'Нераспределенные проекты' })
            )
            : [];

        if (unassignedGroups.length > 0) {
            const metrics = mergeProjectMetrics(unassignedGroups);
            rows.unshift({
                key: 'bucket-unassigned-groups',
                id: 'bucket-unassigned-groups',
                type: 'bucket',
                name: 'Нераспределенные группы',
                voices_count: numberValue(metrics.voices_count),
                tasks_count: numberValue(metrics.tasks_count),
                projects_count: numberValue(metrics.projects_count),
                children: unassignedGroups,
            });
        }

        if (unassignedProjects.length > 0) {
            const metrics = mergeProjectMetrics(unassignedProjects);
            rows.unshift({
                key: 'bucket-unassigned-projects',
                id: 'bucket-unassigned-projects',
                type: 'bucket',
                name: 'Нераспределенные проекты',
                voices_count: numberValue(metrics.voices_count),
                tasks_count: numberValue(metrics.tasks_count),
                projects_count: numberValue(metrics.projects_count),
                children: unassignedProjects,
            });
        }

        return rows;
    }, []);

    const loadData = useCallback(async () => {
        setTableLoading(true);
        try {
            await Promise.all([
                fetchCustomers(uiState.showInactive),
                fetchProjectGroups(uiState.showInactive),
                fetchProjects(uiState.showInactive),
            ]);

            const treeResponse = await api_request<ProjectTreeResponse>(
                'project_tree/list',
                { show_inactive: uiState.showInactive, include_stats: true },
                { silent: true }
            );
            setTableRows(buildTableRows(treeResponse));
        } catch (error) {
            console.error('Failed to load project tree table data', error);
            message.error('Не удалось загрузить дерево проектов');
        } finally {
            setTableLoading(false);
        }
    }, [api_request, buildTableRows, fetchCustomers, fetchProjectGroups, fetchProjects, uiState.showInactive]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleSaveAndRefresh = async () => {
        await loadData();
    };

    const openEditPanel = (row: TableRow): void => {
        const node = toTreeNodeFromRow(row);
        if (node) {
            setSelectedNode(node);
            setUiState((prev) => ({ ...prev, editModalOpen: true }));
        }
    };

    const closeEditModal = (): void => {
        setUiState((prev) => ({ ...prev, editModalOpen: false }));
        setSelectedNode(null);
    };

    const handleEditSave = (): void => {
        void handleSaveAndRefresh();
        closeEditModal();
    };

    const handleToggleActive = async (row: TableRow): Promise<void> => {
        if (row.type === 'bucket') return;
        const nextActive = row.is_active === false;
        const loadingKey = `toggle-${row.type}-${row.id}`;
        setActionLoadingKey(loadingKey);
        try {
            if (row.type === 'customer') {
                await api_request('customers/update', {
                    customer: {
                        _id: row.id,
                        is_active: nextActive,
                    },
                });
            } else if (row.type === 'group') {
                await api_request('project_groups/update', {
                    project_group: {
                        _id: row.id,
                        is_active: nextActive,
                    },
                });
            } else {
                await api_request('projects/update', {
                    project: {
                        _id: row.id,
                        is_active: nextActive,
                    },
                });
            }

            message.success(nextActive ? 'Элемент восстановлен' : 'Элемент скрыт');
            await loadData();
        } catch (error) {
            console.error('Failed to toggle active state', error);
            message.error('Не удалось изменить статус');
        } finally {
            setActionLoadingKey(null);
        }
    };

    const openMoveDialog = (row: TableRow): void => {
        if (row.type !== 'group' && row.type !== 'project') return;
        setMoveDialog({
            open: true,
            row,
            targetId: row.parentId ?? (row.type === 'group' ? '__none__' : null),
            loading: false,
        });
    };

    const handleMoveConfirm = async (): Promise<void> => {
        if (!moveDialog.row) return;
        const row = moveDialog.row;
        setMoveDialog((prev) => ({ ...prev, loading: true }));
        try {
            if (row.type === 'group') {
                const destinationCustomerId =
                    moveDialog.targetId === '__none__' ? null : moveDialog.targetId;

                await api_request('project_groups/move', {
                    project_group_id: row.id,
                    dest_customer_id: destinationCustomerId,
                });
            } else if (row.type === 'project') {
                if (!moveDialog.targetId) {
                    message.warning('Выберите группу назначения');
                    setMoveDialog((prev) => ({ ...prev, loading: false }));
                    return;
                }

                await api_request('projects/move', {
                    project: { _id: row.id },
                    source_project_group: row.parentId ? { _id: row.parentId } : null,
                    dest_project_group: { _id: moveDialog.targetId },
                });
            }

            message.success('Элемент перемещен');
            setMoveDialog({ open: false, row: null, targetId: null, loading: false });
            await loadData();
        } catch (error) {
            console.error('Failed to move node', error);
            message.error('Не удалось переместить элемент');
            setMoveDialog((prev) => ({ ...prev, loading: false }));
        }
    };

    const openMergeDialog = (row: TableRow): void => {
        if (row.type !== 'project') return;
        setMergeDialog({
            open: true,
            sourceRow: row,
            targetId: null,
            reason: '',
            preview: null,
            loading: false,
        });
    };

    const handleMergePreview = async (): Promise<void> => {
        if (!mergeDialog.sourceRow || !mergeDialog.targetId) {
            message.warning('Выберите проект-приемник');
            return;
        }

        setMergeDialog((prev) => ({ ...prev, loading: true }));
        try {
            const preview = await api_request<Record<string, unknown>>(
                'projects/merge',
                {
                    source_project_id: mergeDialog.sourceRow.id,
                    target_project_id: mergeDialog.targetId,
                    dry_run: true,
                    reason: mergeDialog.reason || undefined,
                },
                { silent: true }
            );
            setMergeDialog((prev) => ({ ...prev, preview, loading: false }));
            message.success('Предпросмотр merge готов');
        } catch (error) {
            console.error('Failed to run merge preview', error);
            message.error('Не удалось выполнить dry-run merge');
            setMergeDialog((prev) => ({ ...prev, loading: false }));
        }
    };

    const handleMergeConfirm = async (): Promise<void> => {
        if (!mergeDialog.sourceRow || !mergeDialog.targetId) {
            message.warning('Выберите проект-приемник');
            return;
        }

        setMergeDialog((prev) => ({ ...prev, loading: true }));
        try {
            const result = await api_request<Record<string, unknown>>('projects/merge', {
                source_project_id: mergeDialog.sourceRow.id,
                target_project_id: mergeDialog.targetId,
                dry_run: false,
                reason: mergeDialog.reason || undefined,
                operation_id: `${Date.now()}-${mergeDialog.sourceRow.id}-${mergeDialog.targetId}`,
            });

            const movedVoices = numberValue(result.moved_voices_count);
            const movedTasks = numberValue(result.moved_tasks_count);
            message.success(`Merge выполнен: сессий ${movedVoices}, задач ${movedTasks}`);

            setMergeDialog({
                open: false,
                sourceRow: null,
                targetId: null,
                reason: '',
                preview: null,
                loading: false,
            });
            await loadData();
        } catch (error) {
            console.error('Failed to merge projects', error);
            message.error('Не удалось выполнить merge проектов');
            setMergeDialog((prev) => ({ ...prev, loading: false }));
        }
    };

    const completenessValue = (row: TableRow): string => {
        if (row.type !== 'project') return '—';
        const project = row.data as ProjectWithGroup | undefined;
        if (!project) return '0%';

        const checks = [
            Boolean(project.name && project.name.trim().length > 0),
            Boolean(project.project_group),
            Boolean(project.description && project.description.trim().length > 0),
            typeof project.time_capacity === 'number' && project.time_capacity >= 0,
        ];

        const passed = checks.filter(Boolean).length;
        return `${Math.round((passed / checks.length) * 100)}%`;
    };

    const columns: TableProps<TableRow>['columns'] = [
        {
            title: 'Название',
            dataIndex: 'name',
            key: 'name',
            width: 320,
            render: (_value: string, row: TableRow) => (
                <Space size={8}>
                    {typeIcon(row.type)}
                    <Text>{row.name}</Text>
                </Space>
            ),
        },
        {
            title: 'Тип',
            dataIndex: 'type',
            key: 'type',
            width: 120,
            render: (_value: RowType, row: TableRow) => (
                <Tag color={row.type === 'project' ? 'green' : row.type === 'group' ? 'orange' : row.type === 'customer' ? 'blue' : 'default'}>
                    {typeLabel(row.type)}
                </Tag>
            ),
        },
        {
            title: 'Родитель',
            dataIndex: 'parentName',
            key: 'parentName',
            width: 220,
            render: (value: string | undefined) => value ?? '—',
        },
        {
            title: 'Статус',
            dataIndex: 'is_active',
            key: 'is_active',
            width: 120,
            render: (value: boolean | undefined, row: TableRow) =>
                row.type === 'bucket' ? <Tag>—</Tag> : statusTag(value),
        },
        {
            title: 'Voices',
            dataIndex: 'voices_count',
            key: 'voices_count',
            width: 90,
            align: 'right',
        },
        {
            title: 'Tasks',
            dataIndex: 'tasks_count',
            key: 'tasks_count',
            width: 90,
            align: 'right',
        },
        {
            title: 'Заполненность',
            key: 'completeness',
            width: 140,
            render: (_value: unknown, row: TableRow) => completenessValue(row),
        },
        {
            title: 'Действия',
            key: 'actions',
            width: 420,
            render: (_value: unknown, row: TableRow) => {
                if (row.type === 'bucket') return <Text type="secondary">—</Text>;
                const loadingKeyPrefix = `${row.type}-${row.id}`;
                const isHidden = row.is_active === false;

                return (
                    <Space size={4} onClick={(event) => event.stopPropagation()}>
                        <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(event) => {
                                event.stopPropagation();
                                openEditPanel(row);
                            }}
                        >
                            Редакт.
                        </Button>
                        <Button
                            type="link"
                            size="small"
                            icon={isHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                            loading={actionLoadingKey === `toggle-${loadingKeyPrefix}`}
                            onClick={async (event) => {
                                event.stopPropagation();
                                await handleToggleActive(row);
                            }}
                        >
                            {isHidden ? 'Показать' : 'Скрыть'}
                        </Button>
                        {(row.type === 'group' || row.type === 'project') && (
                            <Button
                                type="link"
                                size="small"
                                icon={<SwapOutlined />}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openMoveDialog(row);
                                }}
                            >
                                Переместить
                            </Button>
                        )}
                        {row.type === 'project' && (
                            <Button
                                type="link"
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    openMergeDialog(row);
                                }}
                            >
                                Merge
                            </Button>
                        )}
                    </Space>
                );
            },
        },
    ];

    const moveTargetOptions = useMemo(() => {
        const row = moveDialog.row;
        if (!row) return [];

        const ensureCurrentTargetOption = (
            options: Array<{ value: string; label: string }>
        ): Array<{ value: string; label: string }> => {
            if (!row.parentId) return options;
            if (options.some((option) => option.value === row.parentId)) return options;

            const fallbackLabel = row.parentName?.trim() || row.parentId;
            return [{ value: row.parentId, label: `${fallbackLabel} (текущий)` }, ...options];
        };

        if (row.type === 'group') {
            const customerOptions = customers
                .filter((customer) => customer.is_active !== false)
                .map((customer) => ({
                    value: customer._id,
                    label: customer.name,
                }));

            return [{ value: '__none__', label: 'Без заказчика' }, ...ensureCurrentTargetOption(customerOptions)];
        }

        if (row.type === 'project') {
            const groupOptions = projectGroups
                .filter((group) => group.is_active !== false)
                .map((group) => ({
                    value: group._id,
                    label: group.name,
                }));

            return ensureCurrentTargetOption(groupOptions);
        }

        return [];
    }, [customers, moveDialog.row, projectGroups]);

    const mergeTargetOptions = useMemo(() => {
        if (!mergeDialog.sourceRow) return [];
        return projects
            .filter((project) => project._id !== mergeDialog.sourceRow?.id)
            .filter((project) => project.is_active !== false)
            .map((project) => ({
                value: project._id,
                label: project.name,
            }));
    }, [mergeDialog.sourceRow, projects]);

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-[1600px] mx-auto">
                <div className="mb-6">
                    <Title level={2} className="mb-2">
                        Управление проектами
                    </Title>
                    <Text type="secondary">
                        Табличный режим структуры: Заказчик → Группа проектов → Проект
                    </Text>
                </div>

                <div className="mb-6">
                    <Space size="middle" wrap>
                        <Button
                            type="default"
                            icon={<PlusOutlined />}
                            onClick={() => setUiState((prev) => ({ ...prev, createCustomerOpen: true }))}
                            size="large"
                        >
                            Новый заказчик
                        </Button>
                        <Button
                            type="default"
                            icon={<PlusOutlined />}
                            onClick={() => setUiState((prev) => ({ ...prev, createGroupOpen: true }))}
                            size="large"
                        >
                            Новая группа
                        </Button>
                        <Button
                            type="default"
                            icon={<PlusOutlined />}
                            onClick={() => setUiState((prev) => ({ ...prev, createProjectOpen: true }))}
                            size="large"
                        >
                            Новый проект
                        </Button>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={uiState.showInactive}
                                onChange={(checked) =>
                                    setUiState((prev) => ({ ...prev, showInactive: checked }))
                                }
                            />
                            <Text type="secondary">Показывать скрытые</Text>
                        </div>
                    </Space>
                </div>

                <Card
                    title="Структура проектов"
                    className="w-full"
                    styles={{ body: { padding: '12px' } }}
                >
                    <Table<TableRow>
                        rowKey="key"
                        columns={columns}
                        dataSource={tableRows}
                        loading={tableLoading}
                        pagination={false}
                        size="small"
                        expandable={{ defaultExpandAllRows: true }}
                        scroll={{ x: 1500, y: 650 }}
                        locale={{
                            emptyText: (
                                <div className="text-center py-8 text-gray-500">
                                    <FolderOutlined className="text-5xl text-[#d9d9d9] mb-4" />
                                    <br />
                                    <Text type="secondary">Нет данных для отображения</Text>
                                    <br />
                                    <Text type="secondary" className="text-xs">
                                        Создайте первого заказчика, чтобы начать
                                    </Text>
                                </div>
                            ),
                        }}
                    />
                </Card>

                <Modal
                    open={uiState.createCustomerOpen}
                    title={
                        <div className="flex items-center gap-2">
                            <UserOutlined className="text-blue-500" />
                            Создать нового заказчика
                        </div>
                    }
                    footer={null}
                    onCancel={() =>
                        setUiState((prev) => ({ ...prev, createCustomerOpen: false }))
                    }
                    width={560}
                >
                    <Divider />
                    <EditCustomer
                        onSave={() => {
                            handleSaveAndRefresh();
                            setUiState((prev) => ({ ...prev, createCustomerOpen: false }));
                        }}
                    />
                </Modal>

                <Modal
                    open={uiState.createGroupOpen}
                    title={
                        <div className="flex items-center gap-2">
                            <FolderOutlined className="text-orange-500" />
                            Создать группу проектов
                        </div>
                    }
                    footer={null}
                    onCancel={() =>
                        setUiState((prev) => ({ ...prev, createGroupOpen: false }))
                    }
                    width={640}
                >
                    <Divider />
                    <EditProjectGroup
                        customers={customers}
                        onSave={() => {
                            handleSaveAndRefresh();
                            setUiState((prev) => ({ ...prev, createGroupOpen: false }));
                        }}
                    />
                </Modal>

                <Modal
                    open={uiState.createProjectOpen}
                    title={
                        <div className="flex items-center gap-2">
                            <ProjectOutlined className="text-green-500" />
                            Создать новый проект
                        </div>
                    }
                    footer={null}
                    onCancel={() =>
                        setUiState((prev) => ({ ...prev, createProjectOpen: false }))
                    }
                    width={760}
                >
                    <Divider />
                    <EditProject
                        customers={customers}
                        projectGroups={projectGroups}
                        onSave={() => {
                            handleSaveAndRefresh();
                            setUiState((prev) => ({ ...prev, createProjectOpen: false }));
                        }}
                    />
                </Modal>

                <Modal
                    open={uiState.editModalOpen}
                    title={selectedNode ? `Редактирование: ${selectedNode.title}` : 'Редактирование'}
                    footer={null}
                    onCancel={closeEditModal}
                    width={860}
                    destroyOnHidden
                >
                    <Divider />
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
                                onSave={handleEditSave}
                            />
                        ) : selectedNode?.type === 'group' ? (
                            <EditProjectGroup
                                key={selectedNode.data?._id}
                                group={selectedNode.data as ProjectGroup}
                                customers={customers}
                                onSave={handleEditSave}
                            />
                        ) : selectedNode?.type === 'customer' ? (
                            <EditCustomer
                                key={selectedNode.data?._id}
                                customer={selectedNode.data as Customer}
                                onSave={handleEditSave}
                            />
                        ) : null}
                    </ConfigProvider>
                </Modal>

                <Modal
                    open={moveDialog.open}
                    title={moveDialog.row?.type === 'group' ? 'Переместить группу' : 'Переместить проект'}
                    onCancel={() => setMoveDialog({ open: false, row: null, targetId: null, loading: false })}
                    onOk={handleMoveConfirm}
                    confirmLoading={moveDialog.loading}
                    okText="Переместить"
                    width={560}
                >
                    <Space direction="vertical" size={14} className="w-full">
                        <Text>
                            {moveDialog.row?.type === 'group'
                                ? `Группа: ${moveDialog.row?.name ?? '—'}`
                                : `Проект: ${moveDialog.row?.name ?? '—'}`}
                        </Text>
                        <Select
                            value={moveDialog.targetId}
                            onChange={(value) => setMoveDialog((prev) => ({ ...prev, targetId: value }))}
                            placeholder={
                                moveDialog.row?.type === 'group'
                                    ? 'Выберите заказчика'
                                    : 'Выберите группу проекта'
                            }
                            options={moveTargetOptions}
                            className="w-full"
                        />
                    </Space>
                </Modal>

                <Modal
                    open={mergeDialog.open}
                    title="Merge проектов"
                    onCancel={() =>
                        setMergeDialog({
                            open: false,
                            sourceRow: null,
                            targetId: null,
                            reason: '',
                            preview: null,
                            loading: false,
                        })
                    }
                    footer={[
                        <Button
                            key="dry-run"
                            onClick={handleMergePreview}
                            loading={mergeDialog.loading}
                            disabled={!mergeDialog.targetId}
                        >
                            Dry run
                        </Button>,
                        <Button
                            key="merge"
                            type="primary"
                            danger
                            onClick={handleMergeConfirm}
                            loading={mergeDialog.loading}
                            disabled={!mergeDialog.targetId}
                        >
                            Выполнить merge
                        </Button>,
                    ]}
                    width={680}
                >
                    <Space direction="vertical" size={14} className="w-full">
                        <Text>Источник: {mergeDialog.sourceRow?.name ?? '—'}</Text>
                        <Select
                            value={mergeDialog.targetId}
                            onChange={(value) =>
                                setMergeDialog((prev) => ({ ...prev, targetId: value, preview: null }))
                            }
                            placeholder="Выберите проект-приемник"
                            options={mergeTargetOptions}
                            className="w-full"
                        />
                        <TextArea
                            rows={3}
                            value={mergeDialog.reason}
                            onChange={(event) =>
                                setMergeDialog((prev) => ({ ...prev, reason: event.target.value }))
                            }
                            placeholder="Причина merge (опционально)"
                        />
                        {mergeDialog.preview && (
                            <Card size="small" title="Результат dry-run">
                                <pre className="text-xs whitespace-pre-wrap m-0">
                                    {JSON.stringify(mergeDialog.preview, null, 2)}
                                </pre>
                            </Card>
                        )}
                    </Space>
                </Modal>
            </div>
        </div>
    );
};

export default ProjectsTree;
