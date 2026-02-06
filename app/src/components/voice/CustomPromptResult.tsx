import { Button, Card, Space, Tag, Typography } from 'antd';
import { CopyOutlined, RobotOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface CustomPromptResultData {
    model?: string;
    execution_time_ms?: number;
    is_json?: boolean;
    parsed_output?: unknown;
    raw_output?: string;
}

interface CustomPromptResultPayload {
    data?: CustomPromptResultData;
}

interface CustomPromptResultProps {
    result: CustomPromptResultPayload | null;
}

export default function CustomPromptResult({ result }: CustomPromptResultProps) {
    if (!result) {
        return (
            <div className="p-6 text-center">
                <Text type="secondary">Результат не найден</Text>
            </div>
        );
    }

    const copyToClipboard = (): void => {
        const raw = result.data?.raw_output as string | undefined;
        if (raw) {
            void navigator.clipboard.writeText(raw);
        }
    };

    return (
        <div className="h-full overflow-auto bg-gray-50 p-2">
            <Card size="small">
                <div className="flex items-center justify-between mb-2">
                    <Space size="small">
                        <RobotOutlined className="text-purple-500" />
                        <Text strong>Результат</Text>
                        <Tag color="green" className="text-xs">
                            ✓
                        </Tag>
                        <Text type="secondary" className="text-xs">
                            {result.data?.model} · {((result.data?.execution_time_ms || 0) / 1000).toFixed(1)}с
                        </Text>
                    </Space>
                    <Button size="small" icon={<CopyOutlined />} onClick={copyToClipboard} />
                </div>

                {result.data?.is_json && result.data?.parsed_output ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs m-0 p-2 bg-slate-100 rounded max-h-[calc(100vh-200px)] overflow-auto">
                        {JSON.stringify(result.data.parsed_output, null, 2)}
                    </pre>
                ) : (
                    <div className="whitespace-pre-wrap break-words text-sm p-2 bg-slate-100 rounded max-h-[calc(100vh-200px)] overflow-auto">
                        {result.data?.raw_output || 'Нет результата'}
                    </div>
                )}
            </Card>
        </div>
    );
}
