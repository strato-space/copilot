import { useEffect } from 'react';
import { Button, Modal, Select } from 'antd';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';
import { isPerformerSelectable } from '../../utils/performerLifecycle';

export default function AccessUsersModal() {
    const { performers_list, fetchPerformersList, updateSessionAllowedUsers } = useVoiceBotStore();
    const {
        accessUsersModal,
        setAccessUsersModalLoading,
        setAccessUsersModalSearchValue,
        closeAccessUsersModal,
        addSelectedUser,
        removeSelectedUser,
        resetAccessUsersModal,
    } = useSessionsUIStore();

    const currentUsers = accessUsersModal.currentUsers.filter(
        (user): user is { _id: string } => typeof user !== 'string' && Boolean(user?._id)
    );

    useEffect(() => {
        if (accessUsersModal.visible) {
            void fetchPerformersList(accessUsersModal.selectedUserIds);
        }
    }, [accessUsersModal.selectedUserIds, accessUsersModal.visible, fetchPerformersList]);

    const getDisplayName = (user: Record<string, unknown> | undefined): string => {
        if (!user) return '';
        const email = user.email as string | undefined;
        const name = user.name as string | undefined;
        return email ? `${email}${name ? ` (${name})` : ''}` : name || (user._id as string) || '';
    };

    const filteredUsers = (performers_list || []).filter((user) =>
        isPerformerSelectable(user) &&
        getDisplayName(user).toLowerCase().includes(accessUsersModal.searchValue.toLowerCase()) &&
        !accessUsersModal.selectedUserIds.includes(user._id as string)
    );

    const selectedUsersData = accessUsersModal.selectedUserIds
        .map((id) => (performers_list || []).find((u) => u._id === id) || currentUsers.find((u) => u._id === id))
        .filter(Boolean) as Array<Record<string, unknown>>;

    const getRoleLabel = (user: Record<string, unknown>): string | null => {
        const roleValue = user.role;
        if (!roleValue) return null;
        return String(roleValue);
    };

    const handleSave = async (): Promise<void> => {
        setAccessUsersModalLoading(true);
        try {
            if (accessUsersModal.sessionId) {
                await updateSessionAllowedUsers(accessUsersModal.sessionId, accessUsersModal.selectedUserIds);
            }
            closeAccessUsersModal();
        } catch (e) {
            console.error('Ошибка при сохранении списка пользователей с доступом:', e);
        } finally {
            setAccessUsersModalLoading(false);
        }
    };

    const handleCancel = (): void => {
        resetAccessUsersModal();
        closeAccessUsersModal();
    };

    return (
        <Modal
            title="Управление доступом к сессии"
            open={accessUsersModal.visible}
            onCancel={handleCancel}
            width={600}
            footer={[
                <Button key="cancel" onClick={handleCancel}>
                    Отмена
                </Button>,
                <Button key="save" type="primary" onClick={handleSave} loading={accessUsersModal.loading}>
                    Сохранить
                </Button>,
            ]}
        >
            <div className="space-y-4">
                <div>
                    <h4 className="text-sm font-medium mb-2">Пользователи с доступом:</h4>
                    {selectedUsersData.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {selectedUsersData.map((user) => (
                                <div key={String(user._id)} className="flex items-start bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">{getDisplayName(user)}</div>
                                        {(() => {
                                            const roleLabel = getRoleLabel(user);
                                            return roleLabel ? <div className="text-xs text-gray-500">{roleLabel}</div> : null;
                                        })()}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeSelectedUser(String(user._id))}
                                        className="ml-2 text-gray-400 hover:text-red-500 text-lg leading-none"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm">Доступ только для создателя сессии и супер-админов</div>
                    )}
                </div>

                <div>
                    <h4 className="text-sm font-medium mb-2">Добавить пользователя:</h4>
                    <Select
                        showSearch
                        placeholder="Введите email или имя для поиска..."
                        className="w-full mb-4"
                        value={accessUsersModal.searchValue}
                        onSearch={setAccessUsersModalSearchValue}
                        onSelect={(value) => addSelectedUser(String(value))}
                        filterOption={false}
                        notFoundContent={accessUsersModal.searchValue ? 'Пользователь не найден' : 'Введите текст для поиска'}
                    >
                        {filteredUsers.map((user) => (
                            <Select.Option key={String(user._id)} value={String(user._id)}>
                                <div>
                                    <div>{getDisplayName(user)}</div>
                                    {(() => {
                                        const roleLabel = getRoleLabel(user);
                                        return roleLabel ? <div className="text-xs text-gray-500">{roleLabel}</div> : null;
                                    })()}
                                </div>
                            </Select.Option>
                        ))}
                    </Select>
                    <div className="text-xs text-gray-500">
                        Пользователи с ролью Super Admin всегда имеют доступ к RESTRICTED сессиям
                    </div>
                </div>
            </div>
        </Modal>
    );
}
