import React from 'react';
import { Table, Typography, Card } from 'antd';

const { Title, Text } = Typography;

const AgentTableWidget = ({ data, agentName, agentSpecs }) => {
    if (!data?.content) {
        return (
            <Card>
                <Text type="secondary">No data available</Text>
            </Card>
        );
    }

    const { headers, rows } = data.content;

    // Создаем колонки для таблицы Ant Design
    const columns = headers.map((header, index) => ({
        title: header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        dataIndex: `col_${index}`,
        key: `col_${index}`,
        width: index === 0 ? 80 : undefined,
        render: (text, record, rowIndex) => {
            // Если это JSON строка (например, chunks), пытаемся её распарсить и красиво отобразить
            if (typeof text === 'string' && text.startsWith('[') && text.endsWith(']')) {
                try {
                    const parsed = JSON.parse(text);
                    if (Array.isArray(parsed)) {
                        return (
                            <div>
                                {parsed.map((item, idx) => (
                                    <div key={idx} style={{ marginBottom: 8, fontSize: 12 }}>
                                        {item.text_quote && (
                                            <div>
                                                <Text strong>{item.start_time} - {item.end_time}</Text>
                                                <br />
                                                <Text>{item.speaker}: "{item.text_quote}"</Text>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    }
                } catch (e) {
                    // Если не удалось распарсить, показываем как обычный текст
                }
            }
            return <Text>{text}</Text>;
        }
    }));

    // Преобразуем строки в формат Ant Design Table
    const dataSource = rows.map((row, index) => {
        const rowData = { key: index };
        row.forEach((cell, cellIndex) => {
            rowData[`col_${cellIndex}`] = cell;
        });
        return rowData;
    });

    const displayName = agentSpecs?.name || agentName;

    return (
        <div className='p-4'>
            <Title level={4} style={{ marginBottom: 16 }}>
                {displayName} - Results
            </Title>

            {agentSpecs?.description && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    {agentSpecs.description}
                </Text>
            )}

            <Table
                columns={columns}
                dataSource={dataSource}
                pagination={false}
                size="small"
                scroll={{ x: true }}
                bordered
                style={{ marginBottom: 16 }}
            />

            {data.metadata && (
                <div style={{ fontSize: 12, color: '#666' }}>
                    <Text type="secondary">
                        Generated at: {new Date(data.metadata.generated_at).toLocaleString()}
                    </Text>
                </div>
            )}
        </div>
    );
};

export default AgentTableWidget;
