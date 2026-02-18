import React, { useEffect } from 'react';
import { Modal, Button, Select } from 'antd';
import _ from 'lodash';

import { useVoiceBot } from '../../store/voiceBot';
import { useSessionsUI } from '../../store/sessionsUI';

const AccessUsersModal = () => {
    const {
        performers_list,
        fetchPerformersList,
        updateSessionAllowedUsers
    } = useVoiceBot();

    const {
        accessUsersModal,
        setAccessUsersModalLoading,
        setAccessUsersModalSearchValue,
        closeAccessUsersModal,
        addSelectedUser,
        removeSelectedUser,
        resetAccessUsersModal
    } = useSessionsUI();

    useEffect(() => {
        if (accessUsersModal.visible) {
            // Загружаем список пользователей при открытии модального окна
            fetchPerformersList();
        }
    }, [accessUsersModal.visible]);

    const handleUserSelect = (userId) => {
        addSelectedUser(userId);
        setAccessUsersModalSearchValue('');
    };

    const handleUserRemove = (userId) => {
        removeSelectedUser(userId);
    };

    const getDisplayName = (user) => {
        if (!user) return '';
        // Показываем email и имя если есть
        return user.email ? `${user.email}${user.name ? ` (${user.name})` : ''}` : user.name || user._id;
    };

    const handleSave = async () => {
        setAccessUsersModalLoading(true);
        try {
            await updateSessionAllowedUsers(accessUsersModal.sessionId, accessUsersModal.selectedUserIds);
            closeAccessUsersModal();
        } catch (e) {
            console.error('Ошибка при сохранении списка пользователей с доступом:', e);
        } finally {
            setAccessUsersModalLoading(false);
        }
    };

    const handleCancel = () => {
        resetAccessUsersModal();
        closeAccessUsersModal();
    };

    // Фильтрация пользователей для поиска
    const filteredUsers = (performers_list || []).filter(user =>
        getDisplayName(user).toLowerCase().includes(accessUsersModal.searchValue.toLowerCase()) &&
        !accessUsersModal.selectedUserIds.includes(user._id)
    );

    // Получаем данные выбранных пользователей
    const selectedUsersData = accessUsersModal.selectedUserIds.map(id =>
        (performers_list || []).find(u => u._id === id) ||
        accessUsersModal.currentUsers.find(u => u._id === id)
    ).filter(Boolean);

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
                <Button
                    key="save"
                    type="primary"
                    onClick={handleSave}
                    loading={accessUsersModal.loading}
                >
                    Сохранить
                </Button>
            ]}
        >
            <div className="space-y-4">
                {/* Выбранные пользователи */}
                <div>
                    <h4 className="text-sm font-medium mb-2">Пользователи с доступом:</h4>
                    {selectedUsersData.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {selectedUsersData.map((user) => (
                                <div key={user._id} className="flex items-start bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">{getDisplayName(user)}</div>
                                        {user.role && (
                                            <div className="text-xs text-gray-500">{user.role}</div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleUserRemove(user._id)}
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

                {/* Поиск и добавление пользователей */}
                <div>
                    <h4 className="text-sm font-medium mb-2">Добавить пользователя:</h4>
                    <Select
                        showSearch
                        placeholder="Введите email или имя для поиска..."
                        style={{ width: '100%', marginBottom: 16 }}
                        value={accessUsersModal.searchValue}
                        onSearch={setAccessUsersModalSearchValue}
                        onSelect={(value, option) => {
                            handleUserSelect(value);
                        }}
                        filterOption={false}
                        notFoundContent={accessUsersModal.searchValue ? "Пользователь не найден" : "Введите текст для поиска"}
                    >
                        {filteredUsers.map(user => (
                            <Select.Option key={user._id} value={user._id}>
                                <div>
                                    <div>{getDisplayName(user)}</div>
                                    {user.role && (
                                        <div className="text-xs text-gray-500">{user.role}</div>
                                    )}
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
};

export default AccessUsersModal;
