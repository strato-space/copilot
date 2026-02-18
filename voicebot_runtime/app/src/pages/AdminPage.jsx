import React, { useState } from 'react';
import { Tabs, Card } from 'antd';
import {
    SettingOutlined,
    UserOutlined,
    SafetyOutlined,
    BarChartOutlined,
    RobotOutlined
} from '@ant-design/icons';

import PermissionsManager from '../components/admin/PermissionsManager';

import RolesOverview from '../components/RolesOverview';
import PermissionGate from '../components/PermissionGate';
// import PermissionsDebug from '../components/PermissionsDebug';
// import PermissionsTest from '../components/PermissionsTest';
import { PERMISSIONS } from '../constants/permissions';
import { useCurrentUserPermissions } from '../store/permissions';
import { useAuthUser } from '../store/AuthUser';

const { TabPane } = Tabs;

const AdminPage = () => {
    const [activeTab, setActiveTab] = useState('permissions');
    const { user, permissions } = useAuthUser();
    const { canAccessAdminPanel, hasPermission } = useCurrentUserPermissions();

    // Отладочная информация
    console.log('AdminPage Debug:', {
        user,
        permissions,
        canAccessAdminPanel,
        hasSystemAdminPanel: hasPermission(PERMISSIONS.SYSTEM.ADMIN_PANEL),
        PERMISSIONS_SYSTEM_ADMIN_PANEL: PERMISSIONS.SYSTEM.ADMIN_PANEL
    });

    return (
        <div style={{ padding: '24px', width: '100%', maxWidth: 1700, margin: '0px auto', boxSizing: 'border-box' }}>

            <Card title={<><SettingOutlined /> Панель администратора</>}>
                <PermissionGate
                    permission={PERMISSIONS.SYSTEM.ADMIN_PANEL}
                    fallback={
                        <div style={{ textAlign: 'center', padding: '50px' }}>
                            <h3>Доступ запрещен</h3>
                            <p>У вас нет прав для доступа к панели администратора</p>
                        </div>
                    }
                >
                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        type="card"
                    >


                        {/* <TabPane
                            tab={
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <BarChartOutlined />
                                    Обзор ролей
                                </span>
                            }
                            key="overview"
                        >
                            <RolesOverview />
                        </TabPane> */}

                        <TabPane
                            tab={
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <UserOutlined />
                                    Управление правами
                                </span>
                            }
                            key="permissions"
                        >
                            <PermissionGate
                                permission={PERMISSIONS.USERS.MANAGE_ROLES}
                                fallback={
                                    <div style={{ textAlign: 'center', padding: '50px' }}>
                                        <h4>Недостаточно прав</h4>
                                        <p>Для управления правами пользователей требуется право USERS.MANAGE_ROLES</p>
                                    </div>
                                }
                            >
                                <PermissionsManager />
                            </PermissionGate>
                        </TabPane>
                    </Tabs>
                </PermissionGate>
            </Card>
        </div>
    );
};

export default AdminPage;
