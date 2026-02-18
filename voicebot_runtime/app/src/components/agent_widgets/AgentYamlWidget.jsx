import React, { useState } from 'react';
import { Typography, Card, Space, Button, Statistic, Row, Col, Tabs } from 'antd';
import { CopyOutlined, DownloadOutlined, EyeOutlined, CodeOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

const AgentYamlWidget = ({ data, agentName, agentSpecs }) => {
    const [activeTab, setActiveTab] = useState('formatted');

    if (!data?.content) {
        return (
            <Card>
                <Text type="secondary">No data available</Text>
            </Card>
        );
    }

    const { content } = data;
    const displayName = agentSpecs?.name || agentName;

    const handleCopyYaml = async () => {
        try {
            await navigator.clipboard.writeText(content.yaml);
            // TODO: можно добавить уведомление через message.success
            console.log('YAML copied to clipboard');
        } catch (err) {
            console.error('Failed to copy YAML:', err);
            // TODO: можно добавить уведомление через message.error
        }
    };

    const handleDownloadYaml = () => {
        const blob = new Blob([content.yaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${agentName}_result.yaml`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // Простая подсветка синтаксиса YAML
    const highlightYaml = (yamlText) => {
        if (!yamlText || typeof yamlText !== 'string') return '';

        // Экранируем HTML
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };

        const escapedText = escapeHtml(yamlText);

        return escapedText
            .replace(/^(\s*)([\w-]+):/gm, '$1<span class="yaml-key">$2:</span>')
            .replace(/:\s*"([^"]*)"/g, ': <span class="yaml-string">"$1"</span>')
            .replace(/:\s*'([^']*)'/g, ': <span class="yaml-string">\'$1\'</span>')
            .replace(/:\s*(\d+(\.\d+)?)/g, ': <span class="yaml-number">$1</span>')
            .replace(/:\s*(true|false|null)/g, ': <span class="yaml-boolean">$1</span>')
            .replace(/^\s*#.*$/gm, '<span class="yaml-comment">$&</span>');
    };

    const tabs = [
        {
            key: 'formatted',
            label: (
                <Space>
                    <EyeOutlined />
                    <span>Formatted</span>
                </Space>
            ),
            children: (
                <div
                    style={{
                        background: '#f6f8fa',
                        padding: '16px',
                        borderRadius: '6px',
                        border: '1px solid #d0d7de',
                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                        fontSize: '13px',
                        lineHeight: '1.45',
                        overflow: 'auto'
                    }}
                    dangerouslySetInnerHTML={{
                        __html: content.formatted_yaml || `<pre>${highlightYaml(content.yaml)}</pre>`
                    }}
                />
            )
        },
        {
            key: 'raw',
            label: (
                <Space>
                    <CodeOutlined />
                    <span>Raw YAML</span>
                </Space>
            ),
            children: (
                <pre
                    style={{
                        background: '#f6f8fa',
                        padding: '16px',
                        borderRadius: '6px',
                        border: '1px solid #d0d7de',
                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                        fontSize: '13px',
                        lineHeight: '1.45',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        margin: 0
                    }}
                >
                    {content.yaml}
                </pre>
            )
        }
    ];

    return (
        <div>
            <Title level={4} style={{ marginBottom: 16 }}>
                {displayName} - YAML Results
            </Title>

            {agentSpecs?.description && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                    {agentSpecs.description}
                </Text>
            )}

            {/* Statistics */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}>
                    <Card size="small">
                        <Statistic
                            title="Lines"
                            value={content.line_count || 0}
                            valueStyle={{ fontSize: '18px' }}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic
                            title="Characters"
                            value={content.char_count || 0}
                            valueStyle={{ fontSize: '18px' }}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Statistic
                            title="Words"
                            value={content.word_count || 0}
                            valueStyle={{ fontSize: '18px' }}
                        />
                    </Card>
                </Col>
                <Col span={6}>
                    <Card size="small">
                        <Space direction="vertical" size="small" style={{ width: '100%' }}>
                            <Button
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={handleCopyYaml}
                                block
                            >
                                Copy
                            </Button>
                            <Button
                                size="small"
                                icon={<DownloadOutlined />}
                                onClick={handleDownloadYaml}
                                block
                            >
                                Download
                            </Button>
                        </Space>
                    </Card>
                </Col>
            </Row>

            {/* YAML Content */}
            <Card>
                <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={tabs}
                    size="small"
                />
            </Card>

            {/* Original Input Preview */}
            {content.original_input && (
                <Card title="Original Input" size="small" style={{ marginTop: 16 }}>
                    <Paragraph ellipsis={{ rows: 3, expandable: true }}>
                        <pre style={{
                            whiteSpace: 'pre-wrap',
                            margin: 0,
                            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                            fontSize: '12px'
                        }}>
                            {typeof content.original_input === 'string'
                                ? content.original_input
                                : JSON.stringify(content.original_input, null, 2)}
                        </pre>
                    </Paragraph>
                </Card>
            )}

            {/* Metadata */}
            {data.metadata && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 16 }}>
                    <Space split={<span>•</span>}>
                        <Text type="secondary">
                            Generated: {new Date(data.metadata.generated_at).toLocaleString()}
                        </Text>
                        {data.metadata.conversion_type && (
                            <Text type="secondary">
                                Type: {data.metadata.conversion_type}
                            </Text>
                        )}
                        {data.metadata.status && (
                            <Text type="secondary">
                                Status: {data.metadata.status}
                            </Text>
                        )}
                    </Space>
                </div>
            )}
        </div>
    );
};

export default AgentYamlWidget;
