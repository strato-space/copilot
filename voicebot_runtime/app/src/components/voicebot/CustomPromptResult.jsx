import React from "react";
import { Card, Typography, Tag, Space, Button } from "antd";
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    CopyOutlined,
    RobotOutlined
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;

const CustomPromptResult = ({ result }) => {
    if (!result) {
        return (
            <div style={{ padding: 24, textAlign: "center" }}>
                <Text type="secondary">Результат не найден</Text>
            </div>
        );
    }

    const copyToClipboard = () => {
        if (result.data?.raw_output) {
            navigator.clipboard.writeText(result.data.raw_output);
        }
    };

    const formatDateTime = (isoString) => {
        return new Date(isoString).toLocaleString("ru-RU", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    };

    return (
        <div className="h-full overflow-auto bg-gray-50 p-2">
            <Card size="small">
                {/* Заголовок компактный */}
                <div className="flex items-center justify-between mb-2">
                    <Space size="small">
                        <RobotOutlined className="text-purple-500" />
                        <Text strong>Результат</Text>
                        <Tag color="green" size="small">✓</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {result.data?.model} · {(result.data?.execution_time_ms / 1000).toFixed(1)}с
                        </Text>
                    </Space>
                    <Button
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={copyToClipboard}
                    />
                </div>

                {/* Результат выполнения */}
                {result.data?.is_json && result.data?.parsed_output ? (
                    <pre style={{
                        whiteSpace: "pre-wrap",
                        wordWrap: "break-word",
                        fontFamily: "monospace",
                        fontSize: 12,
                        margin: 0,
                        padding: 8,
                        background: "#f5f5f5",
                        borderRadius: 4,
                        maxHeight: "calc(100vh - 200px)",
                        overflow: "auto"
                    }}>
                        {JSON.stringify(result.data.parsed_output, null, 2)}
                    </pre>
                ) : (
                    <div style={{
                        whiteSpace: "pre-wrap",
                        wordWrap: "break-word",
                        fontSize: 13,
                        padding: 8,
                        background: "#f5f5f5",
                        borderRadius: 4,
                        maxHeight: "calc(100vh - 200px)",
                        overflow: "auto"
                    }}>
                        {result.data?.raw_output || "Нет результата"}
                    </div>
                )}
            </Card>
        </div>
    );
};

export default CustomPromptResult;
