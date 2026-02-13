import { useEffect } from 'react';
import { Table, Spin, ConfigProvider, FloatButton, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';

import { useKanbanStore } from '../../store/kanbanStore';
import { useCRMStore } from '../../store/crmStore';
import { useAuthStore } from '../../store/authStore';
import type { Epic, TreeNode } from '../../types/crm';

const CRMEpicsList = () => {
    const { isAuth, loading: authLoading } = useAuthStore();
    const { epics, fetchDictionary, getCustomerByProject, projects, tree } = useKanbanStore();
    const { setEditingEpicToNew, setEditingEpic, selectedProject, setSelectedProject } = useCRMStore();

    useEffect(() => {
        if (isAuth) {
            if (projects.length === 0) fetchDictionary();
        }
    }, [isAuth, projects.length, fetchDictionary]);

    if (!projects || projects.length === 0) return null;

    const columns = [
        {
            title: 'Проект',
            key: 'project',
            render: (_: unknown, record: Epic) =>
                `${record.project_name ?? ''} / ${getCustomerByProject(record.project_name ?? '')}`,
        },
        {
            title: 'Эпик',
            dataIndex: 'name',
            width: 800,
        },
        {
            title: '',
            render: (_: unknown, record: Epic) => (
                <div className="text-right">
                    <EditOutlined
                        className="hover:text-blue-700 cursor-pointer"
                        onClick={() => setEditingEpic(record)}
                    />
                </div>
            ),
        },
    ];

    function markSelectable(node: TreeNode): DataNode {
        const selectable = node.type === 'project';
        const childrenData = node.children ? node.children.map(markSelectable) : [];
        const result: DataNode = {
            key: node.key ?? node._id ?? '',
            title: node.title ?? node.name ?? '',
            selectable,
        };
        if (childrenData.length > 0) {
            result.children = childrenData;
        }
        return result;
    }

    const treeData = tree.map(markSelectable);

    const filteredEpics = epics
        ? Object.values(epics).filter((epic) => epic.project === selectedProject && !epic.is_deleted)
        : [];

    return (
        <ConfigProvider
            theme={{
                components: {
                    Table: {
                        headerBorderRadius: 0,
                    },
                },
            }}
        >
            <Spin spinning={authLoading} size="large" fullscreen />
            <FloatButton type="primary" onClick={() => setEditingEpicToNew()} icon={<PlusOutlined />} />
            <div className="flex gap-10 items-top mb-4">
                <Tree
                    className="bg-[#E5E4E2] w-[300px] py-10 px-4 flex-shrink-0 flex-grow-0"
                    defaultExpandAll
                    defaultExpandParent
                    draggable={false}
                    blockNode
                    treeData={treeData}
                    onSelect={(selected) => setSelectedProject(selected[0] as string)}
                    selectedKeys={selectedProject ? [selectedProject] : []}
                />
                {selectedProject ? (
                    <Table
                        className="w-[1200px]"
                        columns={columns}
                        dataSource={filteredEpics}
                        size="small"
                        rowKey="_id"
                        pagination={{ pageSize: 5000, hideOnSinglePage: true }}
                    />
                ) : null}
            </div>
        </ConfigProvider>
    );
};

export default CRMEpicsList;
