/**
 * FinancesPerformersPage - Performers finances and payments management
 * Migrated from appkanban/src/pages/FinancesPerformersPage.jsx
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button, ConfigProvider, Select, InputNumber, Spin, Tree, FloatButton } from 'antd';
import {
    FileTextOutlined,
    LinkOutlined,
    CloudUploadOutlined,
    CloudDownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

import { useCRMStore } from '../../store/crmStore';
import { useKanbanStore } from '../../store/kanbanStore';
import { useAuthStore } from '../../store/authStore';
import { PerformerForm, PaymentForm } from '../../components/crm/finances';
import type { Key } from 'react';
import type { DataNode } from 'antd/es/tree';

// Generate months and years for selectors
const months = Array.from({ length: 12 }, (_, i) => ({
    label: dayjs().month(i).format('MMMM'),
    value: i + 1,
}));

const years = [
    { label: dayjs().year() - 1, value: dayjs().year() - 1 },
    { label: dayjs().year(), value: dayjs().year() },
];

// Extended node types for this page
interface PerformerNode {
    key?: string;
    title?: string;
    type: 'performer' | 'year' | 'folder' | 'document' | 'paymentForm';
    performer_id?: string;
    parent_title?: string;
    document_url?: string;
    performer?: Performer;
    children?: PerformerNode[];
}

interface Performer {
    _id: string;
    name: string;
    payments_settings?: Record<string, unknown>;
}

// Helper to find node in tree
function findNodeByKey<T extends { key?: string; children?: T[] }>(
    tree: T[],
    targetKey: Key
): T | null {
    for (const node of tree) {
        if (node.key === targetKey) {
            return node;
        }
        if (node.children) {
            const foundNode = findNodeByKey(node.children, targetKey);
            if (foundNode) {
                return foundNode;
            }
        }
    }
    return null;
}

const FinancesPerformersPage: React.FC = () => {
    const [selectedNode, setSelectedNode] = useState<PerformerNode | null>(null);

    const {
        metricsMonth,
        setMetricMonth,
        metricsYear,
        setMetricYear,
        isMonthWorkHoursChanged,
        setIsMonthWorkHoursChanged,
    } = useCRMStore();

    // Use selectors to get only needed state
    const monthWorkHours = useKanbanStore((state) => state.monthWorkHours);
    const setMonthWorkHours = useKanbanStore((state) => state.setMonthWorkHours);
    const projects = useKanbanStore((state) => state.projects);
    const fetchDictionary = useKanbanStore((state) => state.fetchDictionary);
    const fetchMonthWorkHours = useKanbanStore((state) => state.fetchMonthWorkHours);
    const saveMonthWorkHours = useKanbanStore((state) => state.saveMonthWorkHours);
    const performersPaymentsTree = useKanbanStore((state) => state.performersPaymentsTree);
    const fetchPerformersPaymentsTree = useKanbanStore((state) => state.fetchPerformersPaymentsTree);
    const performersData = useKanbanStore((state) => state.performersData) as Performer[];
    const fetchPerformersData = useKanbanStore((state) => state.fetchPerformersData);

    const isAuth = useAuthStore((state) => state.isAuth);

    const [loading, setLoading] = useState(true);

    const initialLoadRef = useRef(false);

    // Fetch data on mount
    useEffect(() => {
        if (!isAuth) return;
        if (initialLoadRef.current) return;
        initialLoadRef.current = true;

        if (projects.length < 1) {
            fetchDictionary();
        }
        fetchPerformersPaymentsTree();
        fetchPerformersData();

        setTimeout(() => setLoading(false), 300);
    }, [isAuth, projects.length, fetchDictionary, fetchPerformersPaymentsTree, fetchPerformersData]);

    // Refetch on month/year change
    useEffect(() => {
        fetchDictionary();
        fetchMonthWorkHours();
    }, [metricsMonth, metricsYear, fetchDictionary, fetchMonthWorkHours]);

    const handleSaveMonthWorkHours = () => {
        saveMonthWorkHours();
        setIsMonthWorkHoursChanged(false);
    };

    const handleSelectNode = (selectedKeys: Key[]) => {
        const key = selectedKeys[0];
        if (key) {
            const treeData = performersPaymentsTree ?? [];
            const node = findNodeByKey(treeData, key);
            setSelectedNode(node ? (node as PerformerNode) : null);
        }
    };

    const renderContent = () => {
        if (!selectedNode) return null;

        switch (selectedNode.type) {
            case 'performer': {
                const performer = performersData.find((p) => p._id === selectedNode.performer_id);
                if (!performer) return null;
                return (
                    <PerformerForm
                        initialValues={performer.payments_settings}
                        performer_id={performer._id}
                    />
                );
            }

            case 'year': {
                const performer = performersData.find((p) => p._id === selectedNode.performer_id);
                if (!performer) return null;
                return (
                    <div className="flex flex-col gap-2">
                        <div>
                            {selectedNode.children?.map((child) => (
                                <div key={child.key}>
                                    <div
                                        className="flex gap-2 items-center cursor-pointer hover:text-blue-500"
                                        onClick={() => setSelectedNode(child as PerformerNode)}
                                    >
                                        <FileTextOutlined />
                                        <span>{child.title}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Button
                            type="primary"
                            className="mt-4 w-[150px]"
                            onClick={() =>
                                setSelectedNode({
                                    type: 'paymentForm',
                                    performer,
                                } as PerformerNode)
                            }
                        >
                            Создать выплату
                        </Button>
                    </div>
                );
            }

            case 'folder':
                return (
                    <div className="flex flex-col gap-2 p-10">
                        <h2 className="text-xl font-semibold mb-4">
                            Документы по выплате "{selectedNode.parent_title} - {selectedNode.title}"
                        </h2>
                        {selectedNode.children?.map((child) => {
                            const docNode = child as PerformerNode;
                            return (
                                <div key={child.key} className="flex gap-2 items-center">
                                    <a
                                        className="flex gap-2 items-center cursor-pointer hover:text-blue-500"
                                        href={docNode.document_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <LinkOutlined />
                                    </a>
                                    <div className="flex gap-2 items-center">
                                        <span>{child.title}</span>
                                    </div>
                                </div>
                            );
                        })}
                        <FloatButton.Group shape="circle" className="end-6">
                            <FloatButton
                                icon={<CloudUploadOutlined />}
                                type="default"
                                onClick={() => { }}
                                tooltip="Загрузить документ"
                            />
                            <FloatButton
                                icon={<CloudDownloadOutlined />}
                                type="primary"
                                onClick={() => { }}
                                tooltip="Скачать пак документов"
                            />
                        </FloatButton.Group>
                    </div>
                );

            case 'document':
                return (
                    <div>
                        <iframe
                            className="w-[1226px] h-[1300px]"
                            src={selectedNode.document_url}
                            title="Document"
                        />
                    </div>
                );

            case 'paymentForm':
                if (!selectedNode.performer) return null;
                return <PaymentForm performer={selectedNode.performer} />;

            default:
                return null;
        }
    };

    if (loading || projects.length < 1 || performersPaymentsTree === null) {
        return <Spin spinning size="large" fullscreen />;
    }

    return (
        <div className="bg-white p-3 sm:p-4 relative w-full max-w-[1724px] mx-auto">
            <ConfigProvider
                theme={{
                    components: {
                        Tabs: {},
                    },
                }}
            >
                <div className="flex gap-4 items-top mb-4">
                    <div className="absolute right-2 top-5 z-50 flex gap-2">
                        {isMonthWorkHoursChanged && (
                            <Button
                                shape="circle"
                                className="text-[#d9d9d9] hover:text-[#4096ff]"
                                icon={<FileTextOutlined />}
                                onClick={handleSaveMonthWorkHours}
                            />
                        )}
                        <InputNumber
                            className="w-[250px]"
                            controls={false}
                            placeholder="Рабочих часов"
                            value={monthWorkHours}
                            onChange={(value) => {
                                setMonthWorkHours(value ?? 0);
                                setIsMonthWorkHoursChanged(true);
                            }}
                        />
                        <Select
                            className="w-[120px]"
                            options={months}
                            value={metricsMonth}
                            onSelect={(v) => setMetricMonth(v)}
                        />
                        <Select
                            className="w-[120px]"
                            options={years}
                            value={metricsYear}
                            onSelect={(v) => setMetricYear(v)}
                        />
                    </div>

                    {performersPaymentsTree.length > 0 ? (
                        <Tree
                            className="bg-[#E5E4E2] w-[450px] py-10 px-4 flex-shrink-0 flex-grow-0"
                            defaultExpandAll
                            defaultExpandParent
                            draggable={false}
                            blockNode
                            treeData={performersPaymentsTree as unknown as DataNode[]}
                            onSelect={handleSelectNode}
                            selectedKeys={selectedNode?.key ? [selectedNode.key] : []}
                        />
                    ) : (
                        <div className="bg-[#E5E4E2] w-[450px] py-10 px-4 flex-shrink-0 flex-grow-0 text-center text-gray-500">
                            Нет данных об исполнителях
                        </div>
                    )}

                    <div className="text-black text-xl font-medium w-full">{renderContent()}</div>
                </div>
            </ConfigProvider>
        </div>
    );
};

export default FinancesPerformersPage;
