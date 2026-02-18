import React, { useState, useEffect } from 'react';
import {
    Table,
    Select,
    Card,
    Typography,
    Space,
    Tag,
    Button,
    Modal,
    Collapse,
    Spin,
    Alert,
    Tooltip,
    Divider,
    Statistic,
    Row,
    Col
} from 'antd';
import {
    EyeOutlined,
    FileTextOutlined,
    CalendarOutlined,
    UserOutlined,
    FolderOutlined,
    MessageOutlined
} from '@ant-design/icons';
import { useVoiceBot } from '../store/voiceBot';
import dayjs from 'dayjs';
import _ from 'lodash';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;
const { Panel } = Collapse;

function TopicsPage() {
    const {
        fetchPreparedProjects,
        prepared_projects,
        fetchProjectTopics
    } = useVoiceBot();

    const [selectedProjectId, setSelectedProjectId] = useState(null);
    const [topicsData, setTopicsData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [selectedTopic, setSelectedTopic] = useState(null);
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [expandedChunks, setExpandedChunks] = useState(new Set());

    useEffect(() => {
        fetchPreparedProjects();
    }, []);

    const handleProjectChange = async (projectId) => {
        setSelectedProjectId(projectId);
        setTopicsData(null);

        if (!projectId) return;

        setLoading(true);
        try {
            const data = await fetchProjectTopics(projectId);
            setTopicsData(data);
        } catch (error) {
            console.error('Ошибка при загрузке топиков:', error);
        } finally {
            setLoading(false);
        }
    };

    const showTopicDetails = (topic) => {
        setSelectedTopic(topic);
        setIsModalVisible(true);
        setExpandedChunks(new Set()); // Сбрасываем развернутые фрагменты при открытии нового топика
    };

    const toggleChunkExpansion = (chunkIndex) => {
        const newExpandedChunks = new Set(expandedChunks);
        if (newExpandedChunks.has(chunkIndex)) {
            newExpandedChunks.delete(chunkIndex);
        } else {
            newExpandedChunks.add(chunkIndex);
        }
        setExpandedChunks(newExpandedChunks);
    };

    const truncateText = (text, maxLength = 150) => {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    };

    const columns = [
        {
            title: 'Сессия',
            dataIndex: 'session_name',
            key: 'session_name',
            width: 200,
            render: (text, record) => (
                <div>
                    <div className="font-medium">
                        <a
                            href={`/session/${record.session_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            {text || 'Без названия'}
                        </a>
                    </div>
                    <Text type="secondary" className="text-xs">
                        <CalendarOutlined className="mr-1" />
                        {dayjs(record.session_created_at).format('DD.MM.YYYY HH:mm')}
                    </Text>
                </div>
            ),
        },
        {
            title: 'Топик',
            key: 'topic',
            render: (_, record) => (
                <div>
                    <div className="font-medium text-blue-600">
                        #{record.topic_number} {record.topic_title}
                    </div>
                    <Paragraph
                        className="text-xs text-gray-600 mb-0 mt-1"
                        ellipsis={{ rows: 2, expandable: false }}
                    >
                        {record.topic_description}
                    </Paragraph>
                </div>
            ),
        },
        {
            title: 'Детали',
            key: 'details',
            width: 120,
            render: (_, record) => (
                <div className="text-center">
                    <Button
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => showTopicDetails(record)}
                    >
                        {record.chunks?.length || 0}
                    </Button>
                </div>
            ),
        },
    ];

    // Подготавливаем данные для таблицы
    const tableData = topicsData?.sessions?.flatMap(session =>
        session.topics.map(topic => ({
            key: topic._id,
            ...topic,
            session_name: session.session_name,
            session_created_at: session.session_created_at,
            session_id: session.session_id,
            project_name: session.project_name,
        }))
    ) || [];

    return (
        <div className="max-w-7xl mx-auto px-6">
            <div className="mb-6">
                <Title level={2}>
                    Просмотр тематических блоков проекта
                </Title>
            </div>

            <div className='mb-6'>
                <Select
                    placeholder="Выберите проект для просмотра топиков"
                    style={{ width: '100%', maxWidth: 400 }}
                    value={selectedProjectId}
                    onChange={handleProjectChange}
                    allowClear
                    options={
                        prepared_projects ? Object.entries(_.groupBy(prepared_projects, 'project_group.name')).map(([project_group, projects]) => ({
                            label: project_group || 'Без группы',
                            title: project_group || 'Без группы',
                            options: projects.map(p => ({
                                label: p.name,
                                value: p._id
                            }))
                        })) : []
                    }
                    showSearch={true}
                    filterOption={(inputValue, option) =>
                        option.label.toLowerCase().includes(inputValue.toLowerCase())
                    }
                    popupClassName="w-[400px]"
                    popupMatchSelectWidth={false}
                />
            </div>

            {loading && (
                <Card>
                    <div className="text-center py-8">
                        <Spin size="large" />
                        <div className="mt-4">Загрузка топиков...</div>
                    </div>
                </Card>
            )}

            {topicsData && !loading && (
                <>
                    <Card>
                        <Table
                            columns={columns}
                            dataSource={tableData}
                            pagination={{
                                pageSize: 20,
                                showSizeChanger: true,
                                showQuickJumper: true,
                                showTotal: (total) => `Всего ${total} топиков`,
                            }}
                            size="small"
                            scroll={{ y: 600 }}
                        />
                    </Card>

                    {/* Компактная статистика под таблицей */}
                    <div className="mt-4 text-sm text-gray-600 text-center">
                        <Space split={<Divider type="vertical" />}>
                            <span>
                                <FileTextOutlined className="mr-1" />
                                Всего топиков: <strong>{topicsData.total_topics}</strong>
                            </span>
                            <span>
                                <MessageOutlined className="mr-1" />
                                Сессий с топиками: <strong>{topicsData.total_sessions}</strong>
                            </span>
                            <span>
                                Проект: <strong>{topicsData.sessions?.[0]?.project_name || 'Не указан'}</strong>
                            </span>
                        </Space>
                    </div>
                </>
            )}

            {selectedProjectId && !loading && !topicsData && (
                <Card>
                    <Alert
                        message="Топики не найдены"
                        description="Для выбранного проекта не найдено сессий с обработанными топиками."
                        type="info"
                        showIcon
                    />
                </Card>
            )}

            {/* Модальное окно с деталями топика */}
            <Modal
                title={
                    <div>
                        <Tag color="blue">#{selectedTopic?.topic_number}</Tag>
                        {selectedTopic?.topic_title}
                    </div>
                }
                open={isModalVisible}
                onCancel={() => setIsModalVisible(false)}
                footer={null}
                width={800}
                className="topic-details-modal"
            >
                {selectedTopic && (
                    <Space direction="vertical" size="large" className="w-full">
                        <div>
                            <Text strong>Описание:</Text>
                            <Paragraph className="mt-2">
                                {selectedTopic.topic_description}
                            </Paragraph>
                        </div>

                        <div>
                            <Text strong>Обоснование:</Text>
                            <Paragraph className="mt-2 text-sm text-gray-600">
                                {selectedTopic.assignment_reasoning}
                            </Paragraph>
                        </div>

                        <Divider />

                        <div>
                            <Text strong>Фрагменты разговора ({selectedTopic.chunks?.length || 0}):</Text>
                            <div className="mt-3">
                                {selectedTopic.chunks?.map((chunk, index) => {
                                    const isExpanded = expandedChunks.has(index);
                                    const textToShow = isExpanded ? chunk.text_quote : truncateText(chunk.text_quote, 150);
                                    const shouldShowMore = chunk.text_quote && chunk.text_quote.length > 150;

                                    return (
                                        <Card key={index} size="small" className="mb-3">
                                            <div className="flex items-start space-x-3">
                                                <div className="text-xs text-gray-500 min-w-[60px] flex flex-col leading-tight">
                                                    <div>{chunk.start_time}</div>
                                                    <div>{chunk.end_time}</div>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center space-x-2 mb-1">
                                                        <Tag size="small" color="geekblue">
                                                            {chunk.speaker}
                                                        </Tag>
                                                    </div>
                                                    <div className="text-sm">
                                                        <Text>
                                                            "{textToShow}"
                                                        </Text>
                                                        {shouldShowMore && (
                                                            <Button
                                                                type="link"
                                                                size="small"
                                                                className="p-0 ml-1 text-blue-500 hover:text-blue-700"
                                                                onClick={() => toggleChunkExpansion(index)}
                                                            >
                                                                {isExpanded ? 'свернуть' : 'more'}
                                                            </Button>
                                                        )}
                                                    </div>
                                                    {chunk.keywords_reasoning && (
                                                        <div className="mt-2 text-xs text-gray-500">
                                                            <strong>Ключевые слова:</strong> {chunk.keywords_reasoning}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>

                        <Divider />

                        <div className="text-xs text-gray-500">
                            <Space split={<Divider type="vertical" />}>
                                <span>Создано: {dayjs(selectedTopic.created_at).format('DD.MM.YYYY HH:mm')}</span>
                            </Space>
                        </div>
                    </Space>
                )}
            </Modal>
        </div>
    );
}

export default TopicsPage;