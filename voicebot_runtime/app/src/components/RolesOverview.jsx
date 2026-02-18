import React from 'react';
import { useEffect } from 'react';
import {
    Card,
    Row,
    Col,
    Tag,
    Badge,
    Space,
    Typography,
    Tooltip,
    Progress,
    Statistic
} from 'antd';
import {
    CrownOutlined,
    UserOutlined,
    SafetyOutlined,
    TeamOutlined
} from '@ant-design/icons';
import { usePermissions } from '../store/permissions';
import { permissionsUtils } from '../utils/permissionsAPI';

import { ROLE_HIERARCHY } from '../utils/permissionsAPI';
import { use } from 'react';

const { Title, Text } = Typography;

/**
 * Компонент для отображения карточек ролей
 */
const RolesOverview = () => {
    const {
        roles,
        permissions,
        users,
        loading,
        getAllPermissions,
        getRoleStatistics,
        initialize
    } = usePermissions();

    useEffect(() => {
        initialize();
    }, []);

    const allPermissions = getAllPermissions() || [];
    const roleStats = getRoleStatistics() || {};

    if (loading) {
        return (
            <Row gutter={[16, 16]}>
                {[1, 2, 3, 4, 5, 6].map(i => (
                    <Col key={i} xs={24} sm={12} lg={8} xl={6}>
                        <Card loading />
                    </Col>
                ))}
            </Row>
        );
    }

    return (
        <div>
            <Title level={3}>
                <SafetyOutlined /> Обзор ролей
            </Title>

            <Row gutter={[16, 16]}>
                {[...ROLE_HIERARCHY].reverse().map(role => {
                    const rolePermissions = Array.isArray(roles[role]) ? roles[role] : [];
                    const userCount = roleStats[role] || 0;
                    const permissionCoverage = allPermissions.length > 0 ? (rolePermissions.length / allPermissions.length) * 100 : 0;

                    return (
                        <Col key={role} xs={24} sm={12} lg={8} xl={6}>
                            <Card
                                hoverable
                                title={
                                    <Space>
                                        <CrownOutlined />
                                        <span>{role}</span>
                                        <Badge count={userCount} style={{ backgroundColor: '#52c41a' }} />
                                    </Space>
                                }
                                extra={
                                    <Tag color={permissionsUtils.getRoleColor(role)}>
                                        {permissionsUtils.getUserAccessLevel({ role }, roles)} уровень
                                    </Tag>
                                }
                            >
                                <Space direction="vertical" style={{ width: '100%' }}>
                                    <Statistic
                                        title="Прав доступа"
                                        value={rolePermissions.length}
                                        suffix={`/ ${allPermissions.length}`}
                                        prefix={<SafetyOutlined />}
                                    />

                                    <Progress
                                        percent={Math.round(permissionCoverage)}
                                        size="small"
                                        strokeColor={permissionsUtils.getRoleColor(role)}
                                    />

                                    <Statistic
                                        title="Пользователей"
                                        value={userCount}
                                        prefix={<UserOutlined />}
                                    />

                                    <div>
                                        <Text strong>Основные права:</Text>
                                        <div style={{ marginTop: 8, maxHeight: '120px', overflowY: 'auto' }}>
                                            <Space wrap>
                                                {(rolePermissions || []).map(permission => (
                                                    <Tooltip key={permission} title={permissionsUtils.getPermissionDescription(permission)}>
                                                        <Tag
                                                            size="small"
                                                            color={permissionsUtils.getPermissionColor(permission)}
                                                        >
                                                            {permission ? permission.split('.').pop() : ''}
                                                        </Tag>
                                                    </Tooltip>
                                                ))}
                                            </Space>
                                        </div>
                                    </div>
                                </Space>
                            </Card>
                        </Col>
                    );
                })}
            </Row>

            {/* Карточка с общей статистикой */}
            <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
                <Col span={24}>
                    <Card title={<><TeamOutlined /> Общая статистика</>}>
                        <Row gutter={16}>
                            <Col xs={24} sm={8}>
                                <Statistic
                                    title="Всего ролей"
                                    value={Object.keys(roles).length}
                                    prefix={<CrownOutlined />}
                                />
                            </Col>
                            <Col xs={24} sm={8}>
                                <Statistic
                                    title="Всего пользователей"
                                    value={users.length}
                                    prefix={<UserOutlined />}
                                />
                            </Col>
                            <Col xs={24} sm={8}>
                                <Statistic
                                    title="Всего прав"
                                    value={allPermissions.length}
                                    prefix={<SafetyOutlined />}
                                />
                            </Col>
                        </Row>

                        <div style={{ marginTop: 16 }}>
                            <Title level={5}>Распределение пользователей по ролям:</Title>
                            <Space wrap>
                                {Object.entries(roleStats).map(([role, count]) => (
                                    <Tag
                                        key={role}
                                        color={permissionsUtils.getRoleColor(role)}
                                        style={{ margin: '4px 4px' }}
                                    >
                                        {role}: {count}
                                    </Tag>
                                ))}
                            </Space>
                        </div>
                    </Card>
                </Col>
            </Row>
        </div>
    );
};

export default RolesOverview;
