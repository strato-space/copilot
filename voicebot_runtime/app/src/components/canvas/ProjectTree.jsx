import React from 'react';
import { Tree, Empty } from 'antd';
import { formatTreeData } from './utils/treeUtils.jsx';
import { useContext } from '../../store/context';

const ProjectTree = ({
    treeData,
    onSelect,
    customerFilter,
    projectGroupFilter
}) => {
    const { addFileToContext, addSessionToContext, removeFromContext, contextItems } = useContext();

    const handleAddToContext = (node) => {
        // Проверяем, есть ли элемент уже в контексте
        const existingItem = contextItems.find(item => {
            if (node.type === 'file' && item.type === 'file') {
                return item.data._id === node.data._id;
            }
            if (node.type === 'session' && item.type === 'session') {
                return item.data._id === node.data._id;
            }
            return false;
        });

        if (existingItem) {
            // Если элемент уже в контексте, удаляем его
            removeFromContext(existingItem.id);
        } else {
            // Если элемента нет в контексте, добавляем его
            if (node.type === 'file') {
                addFileToContext(node.data);
            } else if (node.type === 'session') {
                addSessionToContext(node.data);
            }
        }
    };


    if (treeData.length > 0) {
        return (
            <div className="h-full overflow-y-auto flex-1">
                <Tree
                    treeData={formatTreeData(treeData, handleAddToContext, contextItems || [])}
                    onSelect={onSelect}
                    showIcon={false}
                    showLine={true}
                    defaultExpandedKeys={treeData.map(p => p.key)}
                />
            </div>
        );
    }

    return (
        <div className="h-full flex items-center justify-center flex-1">
            <Empty
                description={
                    customerFilter || projectGroupFilter
                        ? "Нет проектов, соответствующих фильтрам"
                        : "Нет доступных проектов"
                }
            />
        </div>
    );
};

export default ProjectTree;
