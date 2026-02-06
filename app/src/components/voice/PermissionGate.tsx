import { type ReactNode } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import { LockOutlined, WarningOutlined } from '@ant-design/icons';
import { useCurrentUserPermissions } from '../../store/permissionsStore';

interface PermissionGateProps {
    permission?: string | string[];
    role?: string | string[];
    requireAll?: boolean;
    children: ReactNode;
    fallback?: ReactNode;
    showFallback?: boolean;
    message?: string | null;
}

export default function PermissionGate({
    permission,
    role,
    requireAll = false,
    children,
    fallback = null,
    showFallback = true,
    message = null,
}: PermissionGateProps): ReactNode {
    const { hasPermission, hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole } =
        useCurrentUserPermissions();

    const hasAccess = (): boolean => {
        if (role) {
            if (Array.isArray(role)) {
                if (!hasAnyRole(role)) return false;
            } else if (!hasRole(role)) {
                return false;
            }
        }

        if (permission) {
            if (Array.isArray(permission)) {
                return requireAll ? hasAllPermissions(permission) : hasAnyPermission(permission);
            }
            return hasPermission(permission);
        }

        return true;
    };

    const renderFallback = (): ReactNode => {
        if (!showFallback) return null;
        if (fallback) return fallback;

        const defaultMessage = message || 'У вас недостаточно прав для просмотра этого содержимого';

        return (
            <Alert
                message="Доступ ограничен"
                description={
                    <div>
                        <p>{defaultMessage}</p>
                        {permission && (
                            <div className="mt-2">
                                <strong>Требуемые права:</strong>
                                <div className="mt-1">
                                    {Array.isArray(permission) ? (
                                        permission.map((perm) => (
                                            <Tag key={perm} color="red" className="mr-1">
                                                {perm}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag color="red">{permission}</Tag>
                                    )}
                                </div>
                            </div>
                        )}
                        {role && (
                            <div className="mt-2">
                                <strong>Требуемые роли:</strong>
                                <div className="mt-1">
                                    {Array.isArray(role) ? (
                                        role.map((r) => (
                                            <Tag key={r} color="orange" className="mr-1">
                                                {r}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag color="orange">{role}</Tag>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                }
                type="warning"
                icon={<LockOutlined />}
                showIcon
                className="my-4"
            />
        );
    };

    return hasAccess() ? children : renderFallback();
}

interface UserActionItem {
    permission?: string;
    role?: string;
    label?: string;
    props?: Record<string, unknown>;
    component?: ReactNode;
    render?: (action: UserActionItem) => ReactNode;
}

export const UserActions = ({ actions = [] }: { actions?: UserActionItem[] }): ReactNode => {
    const { hasPermission, hasRole } = useCurrentUserPermissions();

    const availableActions = actions.filter((action) => {
        if (action.permission && !hasPermission(action.permission)) return false;
        if (action.role && !hasRole(action.role)) return false;
        return true;
    });

    if (availableActions.length === 0) return null;

    return (
        <Space wrap>
            {availableActions.map((action, index) =>
                action.component || action.render?.(action) || (
                    <Button key={index} {...action.props}>
                        {action.label}
                    </Button>
                )
            )}
        </Space>
    );
};

export const usePermissionChecker = () => {
    const { hasPermission, hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole } =
        useCurrentUserPermissions();

    return {
        check: ({
            permission,
            role,
            requireAll = false,
        }: {
            permission?: string | string[];
            role?: string | string[];
            requireAll?: boolean;
        }): boolean => {
            if (role) {
                if (Array.isArray(role)) {
                    if (!hasAnyRole(role)) return false;
                } else if (!hasRole(role)) {
                    return false;
                }
            }

            if (permission) {
                if (Array.isArray(permission)) {
                    return requireAll ? hasAllPermissions(permission) : hasAnyPermission(permission);
                }
                return hasPermission(permission);
            }

            return true;
        },
        hasPermission,
        hasAnyPermission,
        hasAllPermissions,
        hasRole,
        hasAnyRole,
    };
};

export const UserPermissionsInfo = (): ReactNode => {
    const { user, permissions, role } = useCurrentUserPermissions();

    if (!user) {
        return (
            <Alert message="Пользователь не авторизован" type="warning" icon={<WarningOutlined />} showIcon />
        );
    }

    return (
        <Alert
            message="Права пользователя"
            description={
                <div>
                    <div className="mb-2">
                        <strong>Роль:</strong> <Tag color="blue">{role || '—'}</Tag>
                    </div>
                    <div>
                        <strong>Права:</strong>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {(permissions || []).map((perm) => (
                                <Tag key={perm} color="geekblue">
                                    {perm}
                                </Tag>
                            ))}
                        </div>
                    </div>
                </div>
            }
            type="info"
            showIcon
        />
    );
};
