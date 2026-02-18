import React, { useEffect, useState } from 'react';
import { useLocation, Navigate, useNavigate, NavLink } from 'react-router-dom';
import { useAuthUser } from "../store/AuthUser"
import { Tooltip, Divider } from 'antd';
import ChangePasswordModal from './ChangePasswordModal';
import PermissionGate from './PermissionGate';
import { PERMISSIONS } from '../constants/permissions';

//https://ant.design/components/icon

import {
    TableOutlined,
    NodeIndexOutlined,
    ApartmentOutlined,
    UsergroupAddOutlined,
    SyncOutlined,
    LineChartOutlined,
    FunctionOutlined,
    IdcardOutlined,
    BarsOutlined,
    DatabaseOutlined,
    HomeOutlined,
    KeyOutlined,
    SettingOutlined,
    FolderOpenOutlined,
    TagsOutlined,
} from '@ant-design/icons';
function Navigation() {
    const navigate = useNavigate();
    const location = useLocation();
    const [showPasswordModal, setShowPasswordModal] = useState(false);

    return (
        <nav className="flex flex-col gap-4 w-20 items-center text-black bg-white pt-4 min-h-[100vh]">
            {/* 
            <NavLink
                to="/crm"
                className={({ isActive }) =>
                    isActive
                        ? "text-[#1677FF]"
                        : ""
                }
            >
                <Tooltip placement="right" title="CRM" mouseEnterDelay="0.05">
                    <HomeOutlined />
                </Tooltip>
            </NavLink>
            <Divider className="my-0"/> 
            */}
            {/* <button
                onClick={() => setShowPasswordModal(true)}
                className="text-gray-600 hover:text-[#1677FF] transition-colors"
            >
                <Tooltip placement="right" title="Change Password" mouseEnterDelay="0.05">
                    <KeyOutlined />
                </Tooltip>
            </button>

            <Divider className="my-0" /> */}

            <NavLink
                to="/sessions"
                className={({ isActive }) =>
                    isActive
                        ? "text-[#1677FF]"
                        : ""
                }
            >
                <Tooltip placement="right" title="Sessions" mouseEnterDelay="0.05">
                    <BarsOutlined />
                </Tooltip>
            </NavLink>

            <NavLink
                to="/project-files"
                className={({ isActive }) =>
                    isActive
                        ? "text-[#1677FF]"
                        : ""
                }
            >
                <Tooltip placement="right" title="Файлы проектов" mouseEnterDelay="0.05">
                    <FolderOpenOutlined />
                </Tooltip>
            </NavLink>

            <NavLink
                to="/topics"
                className={({ isActive }) =>
                    isActive
                        ? "text-[#1677FF]"
                        : ""
                }
            >
                <Tooltip placement="right" title="Топики проектов" mouseEnterDelay="0.05">
                    <TagsOutlined />
                </Tooltip>
            </NavLink>

            <PermissionGate permission={PERMISSIONS.SYSTEM.ADMIN_PANEL} showFallback={false}>
                <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                        isActive
                            ? "text-[#1677FF]"
                            : ""
                    }
                >
                    <Tooltip placement="right" title="Админ-панель" mouseEnterDelay="0.05">
                        <SettingOutlined />
                    </Tooltip>
                </NavLink>
            </PermissionGate>

            <ChangePasswordModal
                open={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
            />

        </nav>
    )
}

export default Navigation
