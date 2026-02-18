import React from 'react';
import { Typography, Card } from 'antd';

const { Title, Paragraph, Text } = Typography;

const AgentTextWidget = ({ data, agentName, agentSpecs }) => {
    if (!data?.content) {
        return (
            <Card>
                <Text type="secondary">No data available</Text>
            </Card>
        );
    }

    const displayName = agentSpecs?.name || agentName;

    return (
        <div>
            <Title level={4} style={{ marginBottom: 16 }}>
                {displayName} - Results
            </Title>

            {agentSpecs?.description && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    {agentSpecs.description}
                </Text>
            )}

            <Card>
                <Paragraph style={{ whiteSpace: 'pre-wrap' }}>
                    {typeof data.content === 'string' ? data.content : JSON.stringify(data.content, null, 2)}
                </Paragraph>
            </Card>

            {data.metadata && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 16 }}>
                    <Text type="secondary">
                        Generated at: {new Date(data.metadata.generated_at).toLocaleString()}
                    </Text>
                </div>
            )}
        </div>
    );
};

export default AgentTextWidget;
