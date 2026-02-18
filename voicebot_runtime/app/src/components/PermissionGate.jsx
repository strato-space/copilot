import React from 'react';
import { useCurrentUserPermissions } from '../store/permissions';
import { useAuthUser } from '../store/AuthUser';
import { Alert, Button, Space, Tag } from 'antd';
import { LockOutlined, WarningOutlined } from '@ant-design/icons';

/**
 * Компонент для условного рендеринга на основе прав пользователя
 * 
 * @param {Object} props
 * @param {string|string[]} props.permission - Право или массив прав для проверки
 * @param {string|string[]} props.role - Роль или массив ролей для проверки
 * @param {boolean} props.requireAll - Требовать все права (true) или любое из них (false)
 * @param {React.ReactNode} props.children - Контент для рендеринга при наличии прав
 * @param {React.ReactNode} props.fallback - Контент для рендеринга при отсутствии прав
 * @param {boolean} props.showFallback - Показывать fallback (по умолчанию true)
 * @param {string} props.message - Пользовательское сообщение об отсутствии прав
 */
const PermissionGate = ({
    permission,
    role,
    requireAll = false,
    children,
    fallback = null,
    showFallback = true,
    message = null
}) => {
    const {
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        hasRole,
        hasAnyRole,
        user
    } = useCurrentUserPermissions();

    const hasAccess = () => {
        // Проверка ролей
        if (role) {
            if (Array.isArray(role)) {
                if (!hasAnyRole(role)) return false;
            } else {
                if (!hasRole(role)) return false;
            }
        }

        // Проверка прав
        if (permission) {
            if (Array.isArray(permission)) {
                return requireAll
                    ? hasAllPermissions(permission)
                    : hasAnyPermission(permission);
            }
            return hasPermission(permission);
        }

        // Если указаны только роли, то роли достаточно
        return true;
    };

    const renderFallback = () => {
        if (!showFallback) return null;

        if (fallback) return fallback;

        // Дефолтное сообщение об ограниченном доступе
        const defaultMessage = message || 'У вас недостаточно прав для просмотра этого содержимого';

        return (
            <Alert
                message="Доступ ограничен"
                description={
                    <div>
                        <p>{defaultMessage}</p>
                        {permission && (
                            <div style={{ marginTop: '8px' }}>
                                <strong>Требуемые права:</strong>
                                <div style={{ marginTop: '4px' }}>
                                    {Array.isArray(permission) ? (
                                        permission.map(perm => (
                                            <Tag key={perm} color="red" size="small" style={{ marginRight: '4px' }}>
                                                {perm}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag color="red" size="small">{permission}</Tag>
                                    )}
                                </div>
                            </div>
                        )}
                        {role && (
                            <div style={{ marginTop: '8px' }}>
                                <strong>Требуемые роли:</strong>
                                <div style={{ marginTop: '4px' }}>
                                    {Array.isArray(role) ? (
                                        role.map(r => (
                                            <Tag key={r} color="orange" size="small" style={{ marginRight: '4px' }}>
                                                {r}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag color="orange" size="small">{role}</Tag>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                }
                type="warning"
                icon={<LockOutlined />}
                showIcon
                style={{ margin: '16px 0' }}
            />
        );
    };

    return hasAccess() ? children : renderFallback();
};

/**
 * Компонент для отображения доступных действий пользователя
 */
export const UserActions = ({ actions = [] }) => {
    const { hasPermission, hasRole } = useCurrentUserPermissions();

    const availableActions = actions.filter(action => {
        if (action.permission && !hasPermission(action.permission)) return false;
        if (action.role && !hasRole(action.role)) return false;
        return true;
    });

    if (availableActions.length === 0) {
        return null;
    }

    return (
        <Space wrap>
            {availableActions.map((action, index) => (
                action.component || action.render?.(action) || (
                    <Button key={index} {...action.props}>
                        {action.label}
                    </Button>
                )
            ))}
        </Space>
    );
};

/**
 * Хук для создания функции проверки прав
 */
export const usePermissionChecker = () => {
    const { hasPermission, hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole } = useCurrentUserPermissions();

    return {
        check: ({ permission, role, requireAll = false }) => {
            // Проверка ролей
            if (role) {
                if (Array.isArray(role)) {
                    if (!hasAnyRole(role)) return false;
                } else {
                    if (!hasRole(role)) return false;
                }
            }

            // Проверка прав
            if (permission) {
                if (Array.isArray(permission)) {
                    return requireAll
                        ? hasAllPermissions(permission)
                        : hasAnyPermission(permission);
                }
                return hasPermission(permission);
            }

            return true;
        },
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        hasRole,
        hasAnyRole
    };
};

/**
 * Компонент для отображения информации о правах пользователя
 */
export const UserPermissionsInfo = () => {
    const { user, permissions, role } = useCurrentUserPermissions();

    if (!user) {
        return (
            <Alert
                message="Пользователь не авторизован"
                type="warning"
                icon={<WarningOutlined />}
                showIcon
            />
        );
    }

    return (
        <div style={{ padding: '16px', border: '1px solid #d9d9d9', borderRadius: '6px' }}>
            <h4>Информация о правах</h4>
            <p><strong>Пользователь:</strong> {user.name || user.real_name || 'Неизвестно'}</p>
            <p><strong>Роль:</strong> <Tag color="blue">{role || 'Не назначена'}</Tag></p>
            <p><strong>Количество прав:</strong> {permissions?.length || 0}</p>

            {permissions && permissions.length > 0 && (
                <details style={{ marginTop: '12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                        Все права ({permissions.length})
                    </summary>
                    <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                        {permissions.map(permission => (
                            <Tag key={permission} size="small" style={{ marginBottom: '4px' }}>
                                {permission}
                            </Tag>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
};

export default PermissionGate;
