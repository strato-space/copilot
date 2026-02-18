import React, { useMemo } from 'react';
import { Card, Typography, Tag, Divider, Button, Space } from 'antd';
import {
    PlayCircleOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    RobotOutlined,
    ProjectOutlined,
    FileTextOutlined,
    CopyOutlined
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

const ResultsPreview = ({ result, onClear }) => {
    // Форматируем final_output с разделением на секции
    const formattedContent = useMemo(() => {
        if (!result?.data?.executionResult?.final_output) return null;

        const content = result.data.executionResult.final_output;

        // Разделяем контент на секции по заголовкам
        const sections = [];
        const lines = content.split('\n');
        let currentSection = null;

        lines.forEach(line => {
            const trimmedLine = line.trim();

            // Проверяем если это заголовок (начинается с буквы без отступа и не пустая строка)
            if (trimmedLine && !line.startsWith(' ') && !line.startsWith('-') && !line.startsWith('•') && trimmedLine.length < 100) {
                // Если у нас есть текущая секция, сохраняем её
                if (currentSection) {
                    sections.push(currentSection);
                }

                // Начинаем новую секцию
                currentSection = {
                    title: trimmedLine,
                    content: []
                };
            } else if (currentSection && trimmedLine) {
                // Добавляем строку к текущей секции
                currentSection.content.push(trimmedLine);
            } else if (!currentSection && trimmedLine) {
                // Если секции ещё нет, создаем секцию без заголовка
                currentSection = {
                    title: 'Результат',
                    content: [trimmedLine]
                };
            }
        });

        // Добавляем последнюю секцию
        if (currentSection) {
            sections.push(currentSection);
        }

        return sections;
    }, [result]);

    const copyToClipboard = () => {
        if (result?.data?.executionResult?.final_output) {
            navigator.clipboard.writeText(result.data.executionResult.final_output);
        }
    };

    const formatDateTime = (isoString) => {
        return new Date(isoString).toLocaleString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!result || !result.data) {
        return null;
    }

    const { data } = result;

    return (
        <div className="h-full overflow-auto bg-gray-50 p-4">
            <Card className="mb-4">
                {/* Заголовок с информацией о запуске */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-2">
                            {data.type === 'project' ? <ProjectOutlined className="text-blue-500" /> :
                                data.type === 'prompt' ? <FileTextOutlined className="text-green-500" /> :
                                    <RobotOutlined className="text-purple-500" />}
                            <Title level={4} style={{ margin: 0 }}>
                                {data.type === 'project' ? `Проект: ${data.project}` :
                                    data.type === 'prompt' ? `Промпт: ${data.prompt}` :
                                        `Агент: ${data.agent}`}
                            </Title>
                        </div>
                        <Tag color="green" icon={<CheckCircleOutlined />}>
                            Завершено
                        </Tag>
                    </div>

                    <Space>
                        <Button
                            icon={<CopyOutlined />}
                            onClick={copyToClipboard}
                            title="Копировать результат"
                        >
                            Копировать
                        </Button>
                        {onClear && (
                            <Button onClick={onClear}>
                                Закрыть результат
                            </Button>
                        )}
                    </Space>
                </div>

                {/* Метаинформация */}
                <div className="bg-gray-50 p-3 rounded mb-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <Text strong>Проект:</Text> {data.project}
                        </div>
                        <div>
                            <Text strong>ID запуска:</Text> <Text code>{data.runId}</Text>
                        </div>
                        <div>
                            <div className="flex items-center space-x-1">
                                <ClockCircleOutlined />
                                <Text strong>Запущен:</Text>
                            </div>
                            <Text>{formatDateTime(data.startedAt)}</Text>
                        </div>
                        <div>
                            <Text strong>Контекст:</Text> {data.contextItemsCount} элементов
                        </div>
                    </div>
                </div>

                <Divider />

                {/* Результат выполнения */}
                <div>
                    <Title level={5} className="flex items-center space-x-2 mb-3">
                        <PlayCircleOutlined />
                        <span>Результат выполнения</span>
                    </Title>

                    {formattedContent && formattedContent.length > 0 ? (
                        <div className="space-y-4">
                            {formattedContent.map((section, index) => (
                                <Card key={index} size="small" className="bg-white">
                                    <Title level={6} className="text-blue-600 mb-2">
                                        {section.title}
                                    </Title>
                                    <div className="space-y-1">
                                        {section.content.map((line, lineIndex) => {
                                            // Проверяем если строка начинается с "- " или "• " - это список
                                            if (line.startsWith('- ') || line.startsWith('• ')) {
                                                return (
                                                    <div key={lineIndex} className="flex items-start space-x-2 pl-2">
                                                        <span className="text-blue-500 mt-1">•</span>
                                                        <Text>{line.replace(/^[-•]\s*/, '')}</Text>
                                                    </div>
                                                );
                                            } else {
                                                return (
                                                    <Paragraph key={lineIndex} className="mb-1">
                                                        {line}
                                                    </Paragraph>
                                                );
                                            }
                                        })}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <Text type="secondary">Результат выполнения не содержит текстовых данных</Text>
                        </div>
                    )}
                </div>

                {/* Дополнительная информация об агенте */}
                {data.executionResult?.resolved && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                        <Title level={6} className="text-gray-600 mb-2">Информация об агенте</Title>
                        <div className="bg-gray-50 p-3 rounded">
                            <div className="text-sm space-y-1">
                                <div><Text strong>Цель:</Text> {data.executionResult.resolved.goal}</div>
                                {data.executionResult.resolved.url && (
                                    <div>
                                        <Text strong>URL:</Text>{' '}
                                        <a
                                            href={data.executionResult.resolved.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-500 hover:underline"
                                        >
                                            {data.executionResult.resolved.url}
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default ResultsPreview;