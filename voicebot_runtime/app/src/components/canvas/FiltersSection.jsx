import React from 'react';
import { Select, Row, Col } from 'antd';

const FiltersSection = ({
    customerFilter,
    setCustomerFilter,
    projectGroupFilter,
    setProjectGroupFilter,
    customerOptions,
    projectGroupOptions
}) => {
    return (
        <div className="flex flex-col gap-2 pb-3 border-b border-gray-200">
            <Row gutter={[8, 8]}>
                <Col span={24}>
                    <Select
                        placeholder="Фильтр по клиенту"
                        allowClear
                        value={customerFilter}
                        onChange={setCustomerFilter}
                        options={customerOptions}
                        className="w-full"
                        size="small"
                    />
                </Col>
                <Col span={24}>
                    <Select
                        placeholder="Фильтр по группе проекта"
                        allowClear
                        value={projectGroupFilter}
                        onChange={setProjectGroupFilter}
                        options={projectGroupOptions}
                        className="w-full"
                        size="small"
                    />
                </Col>
            </Row>
        </div>
    );
};

export default FiltersSection;
