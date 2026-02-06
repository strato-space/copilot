import { Card, Tabs } from 'antd';
import { SettingOutlined, UserOutlined } from '@ant-design/icons';

import PermissionGate from '../components/voice/PermissionGate';
import { PERMISSIONS } from '../constants/permissions';
import { PermissionsManager } from '../components/admin';

const { TabPane } = Tabs;

export default function AdminPage() {
    return (
        <div className="finops-page animate-fade-up">
            <Card title={<><SettingOutlined /> Панель администратора</>}>
                <PermissionGate
                    permission={PERMISSIONS.SYSTEM.ADMIN_PANEL}
                    fallback={
                        <div className="text-center py-12">
                            <h3>Доступ запрещен</h3>
                            <p>У вас нет прав для доступа к панели администратора</p>
                        </div>
                    }
                >
                    <Tabs type="card">
                        <TabPane
                            tab={
                                <span className="flex items-center gap-2">
                                    <UserOutlined />
                                    Управление правами
                                </span>
                            }
                            key="permissions"
                        >
                            <PermissionsManager />
                        </TabPane>
                    </Tabs>
                </PermissionGate>
            </Card>
        </div>
    );
}
