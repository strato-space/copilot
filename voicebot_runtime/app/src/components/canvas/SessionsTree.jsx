import React from 'react';
import { Tree, Empty } from 'antd';
import { formatTreeData } from './utils/treeUtils.jsx';
import { useContext } from '../../store/context';

const SessionsTree = ({
    treeData,
    onSelect,
    customerFilter,
    projectGroupFilter
}) => {
    const { addSessionToContext } = useContext();

    const handleAddToContext = (node) => {
        if (node.type === 'session') {
            addSessionToContext(node.data);
        }
    };

    const treeClassName = "bg-transparent [&_.ant-tree-node-content-wrapper]:px-3 [&_.ant-tree-node-content-wrapper]:py-2 [&_.ant-tree-node-content-wrapper]:rounded-md [&_.ant-tree-node-content-wrapper]:transition-all [&_.ant-tree-node-content-wrapper]:flex [&_.ant-tree-node-content-wrapper]:items-center [&_.ant-tree-node-content-wrapper]:gap-2 [&_.ant-tree-node-content-wrapper:hover]:bg-gray-100 [&_.ant-tree-node-content-wrapper:hover]:translate-x-0.5 [&_.ant-tree-node-content-wrapper.ant-tree-node-selected]:bg-blue-50 [&_.ant-tree-node-content-wrapper.ant-tree-node-selected]:border [&_.ant-tree-node-content-wrapper.ant-tree-node-selected]:border-blue-200 [&_.ant-tree-node-content-wrapper.ant-tree-node-selected]:font-medium [&_.ant-tree-switcher]:flex [&_.ant-tree-switcher]:items-center [&_.ant-tree-switcher]:justify-center [&_.ant-tree-switcher]:w-6 [&_.ant-tree-switcher]:h-6 [&_.ant-tree-switcher]:rounded [&_.ant-tree-switcher]:transition-all [&_.ant-tree-switcher:hover]:bg-gray-100 [&_.ant-tree-indent-unit]:w-5 [&_.ant-tree-title]:text-sm [&_.ant-tree-title]:leading-relaxed";

    if (treeData.length > 0) {
        return (
            <div className="h-full overflow-y-auto flex-1">
                <Tree
                    treeData={formatTreeData(treeData, handleAddToContext)}
                    onSelect={onSelect}
                    showIcon={true}
                    className={treeClassName}
                    defaultExpandAll={true}
                />
            </div>
        );
    }

    return (
        <div className="h-full flex items-center justify-center flex-1">
            <Empty
                description={
                    customerFilter || projectGroupFilter
                        ? "Нет сессий, соответствующих фильтрам"
                        : "Нет доступных сессий"
                }
            />
        </div>
    );
};

export default SessionsTree;
