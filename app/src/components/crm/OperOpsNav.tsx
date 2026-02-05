/**
 * OperOpsNav - Horizontal navigation for OperOps section
 */

import { type ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'antd';
import {
    AppstoreOutlined,
    TeamOutlined,
    DollarOutlined,
    ApartmentOutlined,
} from '@ant-design/icons';

const navItems = [
    { key: 'crm', label: 'CRM', to: '/operops/crm', icon: <AppstoreOutlined /> },
    { key: 'performers', label: 'Исполнители', to: '/operops/performers', icon: <TeamOutlined /> },
    {
        key: 'finances',
        label: 'Финансы исполнителей',
        to: '/operops/finances-performers',
        icon: <DollarOutlined />,
    },
    {
        key: 'projects',
        label: 'Дерево проектов',
        to: '/operops/projects-tree',
        icon: <ApartmentOutlined />,
    },
];

export default function OperOpsNav(): ReactElement {
    const location = useLocation();

    // Find active key based on current path
    const selectedKey =
        navItems.find((item) => location.pathname.startsWith(item.to))?.key ?? 'crm';

    return (
        <div className="bg-white border-b border-slate-200 mb-4">
            <Menu
                mode="horizontal"
                selectedKeys={[selectedKey]}
                className="border-b-0"
                items={navItems.map((item) => ({
                    key: item.key,
                    icon: item.icon,
                    label: (
                        <NavLink to={item.to} className="flex items-center">
                            {item.label}
                        </NavLink>
                    ),
                }))}
            />
        </div>
    );
}
