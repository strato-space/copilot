import React from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';

const AddToContextButton = ({
    onClick,
    size = 'small',
    className = '',
    disabled = false,
    tooltip = 'Добавить в контекст'
}) => {
    const handleClick = (e) => {
        e.stopPropagation(); // Предотвращаем выбор элемента дерева
        onClick(e);
    };

    return (
        <Tooltip title={tooltip} placement="top">
            <Button
                type="text"
                size={size}
                icon={<PlusOutlined />}
                onClick={handleClick}
                disabled={disabled}
                className={`                   
                    text-blue-500 hover:text-blue-700 
                    hover:bg-blue-50 border-0
                    flex items-center justify-center
                    ${className}
                `}
                style={{
                    minWidth: '24px',
                    width: '24px',
                    height: '24px'
                }}
            />
        </Tooltip>
    );
};

export default AddToContextButton;
