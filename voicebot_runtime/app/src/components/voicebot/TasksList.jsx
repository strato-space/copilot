import React from "react";
import { Card, List, Tag, Typography, Button, Tooltip, Space } from "antd";
import { CheckOutlined, CloseOutlined, EditOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

const TasksList = ({
    tasks = [],
    title = "Задачи",
    showActions = false,
    onTaskSelect,
    selectedTaskIds = [],
    compact = false
}) => {
    if (!tasks || tasks.length === 0) {
        return (
            <Card title={title} size={compact ? "small" : "default"}>
                <Text type="secondary">Задачи не найдены</Text>
            </Card>
        );
    }

    const getPriorityColor = (priority) => {
        if (priority?.includes("P1")) return "red";
        if (priority?.includes("P2")) return "orange";
        if (priority?.includes("P3")) return "yellow";
        return "default";
    };

    const getPriorityIcon = (priority) => {
        if (priority?.includes("🔥")) return "🔥";
        return "";
    };

    return (
        <Card
            title={`${title} (${tasks.length})`}
            size={compact ? "small" : "default"}
            bodyStyle={{ padding: compact ? "8px" : "24px" }}
        >
            <List
                size={compact ? "small" : "default"}
                dataSource={tasks}
                renderItem={(task) => (
                    <List.Item
                        key={task.id}
                        style={{
                            padding: compact ? "8px 0" : "12px 0",
                            borderBottom: "1px solid #f0f0f0"
                        }}
                        actions={showActions ? [
                            <Button
                                key="select"
                                size="small"
                                type={selectedTaskIds.includes(task.id) ? "primary" : "default"}
                                icon={selectedTaskIds.includes(task.id) ? <CheckOutlined /> : null}
                                onClick={() => onTaskSelect && onTaskSelect(task.id)}
                            >
                                {selectedTaskIds.includes(task.id) ? "Выбрано" : "Выбрать"}
                            </Button>
                        ] : []}
                    >
                        <List.Item.Meta
                            title={
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                                    <Text strong style={{ flex: 1, fontSize: compact ? "13px" : "14px" }}>
                                        {task.name}
                                    </Text>
                                    <Space size={4}>
                                        {task.priority && (
                                            <Tag
                                                color={getPriorityColor(task.priority)}
                                                style={{ fontSize: compact ? "11px" : "12px", margin: 0 }}
                                            >
                                                {getPriorityIcon(task.priority)} {task.priority}
                                            </Tag>
                                        )}
                                        {task.task_status && (
                                            <Tag
                                                color="blue"
                                                style={{ fontSize: compact ? "11px" : "12px", margin: 0 }}
                                            >
                                                {task.task_status}
                                            </Tag>
                                        )}
                                    </Space>
                                </div>
                            }
                            description={
                                <div style={{ marginTop: 4 }}>
                                    {task.description && (
                                        <Paragraph
                                            ellipsis={{
                                                rows: compact ? 2 : 3,
                                                expandable: !compact,
                                                symbol: 'показать больше'
                                            }}
                                            style={{
                                                margin: "4px 0",
                                                fontSize: compact ? "12px" : "13px",
                                                color: "#666"
                                            }}
                                        >
                                            {task.description}
                                        </Paragraph>
                                    )}

                                    {task.dialogue_reference && (
                                        <div style={{ marginTop: 4 }}>
                                            <Text
                                                type="secondary"
                                                style={{
                                                    fontSize: compact ? "11px" : "12px",
                                                    fontStyle: "italic"
                                                }}
                                            >
                                                Источник: "{task.dialogue_reference}"
                                            </Text>
                                        </div>
                                    )}

                                    {task.dependencies_from_ai && task.dependencies_from_ai.length > 0 && (
                                        <div style={{ marginTop: 4 }}>
                                            <Text
                                                type="secondary"
                                                style={{ fontSize: compact ? "11px" : "12px" }}
                                            >
                                                Зависит от: {task.dependencies_from_ai.join(", ")}
                                            </Text>
                                        </div>
                                    )}

                                    {task.task_id_from_ai && (
                                        <div style={{ marginTop: 4 }}>
                                            <Tag
                                                style={{
                                                    fontSize: compact ? "10px" : "11px",
                                                    padding: compact ? "0 4px" : "0 6px"
                                                }}
                                            >
                                                ID: {task.task_id_from_ai}
                                            </Tag>
                                        </div>
                                    )}
                                </div>
                            }
                        />
                    </List.Item>
                )}
            />
        </Card>
    );
};

export default TasksList;
