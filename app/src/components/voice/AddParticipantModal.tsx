import { useEffect } from 'react';
import { Button, Form, Input, Modal, Radio, Select } from 'antd';
import type { RadioChangeEvent } from 'antd';
import _ from 'lodash';

import { useVoiceBotStore } from '../../store/voiceBotStore';
import { useSessionsUIStore } from '../../store/sessionsUIStore';

export default function AddParticipantModal() {
    const {
        persons_list,
        prepared_projects,
        fetchPersonsList,
        createPerson,
        updateSessionParticipants,
    } = useVoiceBotStore();

    const {
        participantModal,
        setParticipantModalLoading,
        setParticipantModalMode,
        setParticipantModalSearchValue,
        closeParticipantModal,
        addSelectedPerson,
        removeSelectedPerson,
        resetParticipantModal,
    } = useSessionsUIStore();

    const [form] = Form.useForm();

    const currentParticipants = participantModal.currentParticipants.filter(
        (participant): participant is { _id: string } => typeof participant !== 'string' && Boolean(participant?._id)
    );

    useEffect(() => {
        if (participantModal.visible) {
            void fetchPersonsList();
        }
    }, [participantModal.visible, fetchPersonsList]);

    const handleModeChange = (e: RadioChangeEvent): void => {
        const value = (e.target?.value ?? 'select') as 'select' | 'create';
        setParticipantModalMode(value);
        form.resetFields();
    };

    const getInitials = (fullName?: string): string => {
        if (!fullName) return '';
        const parts = fullName.split(' ');
        if (parts.length === 1) return parts[0] || '';
        const surname = parts[0] || '';
        const initials = parts
            .slice(1)
            .map((name) => name.charAt(0).toUpperCase())
            .join('.');
        return initials ? `${surname} ${initials}.` : surname;
    };

    const handleCreatePerson = async (values: { name: string; project_id?: string; role?: string }): Promise<void> => {
        try {
            setParticipantModalLoading(true);
            const personData = {
                name: values.name,
                projects: values.project_id
                    ? [
                        {
                            project_id: values.project_id,
                            role: values.role || '',
                        },
                    ]
                    : [],
            };

            const createdPerson = await createPerson(personData);
            if (createdPerson && createdPerson._id) {
                addSelectedPerson(createdPerson._id);
            }
            form.resetFields();
            setParticipantModalMode('select');
        } catch (e) {
            console.error('Ошибка при создании участника:', e);
        } finally {
            setParticipantModalLoading(false);
        }
    };

    const handleSave = async (): Promise<void> => {
        try {
            setParticipantModalLoading(true);
            if (participantModal.sessionId) {
                await updateSessionParticipants(participantModal.sessionId, participantModal.selectedPersonIds);
            }
            closeParticipantModal();
        } catch (e) {
            console.error('Ошибка при сохранении участников:', e);
        } finally {
            setParticipantModalLoading(false);
        }
    };

    const handleCancel = (): void => {
        resetParticipantModal();
        closeParticipantModal();
    };

    const filteredPersons = (persons_list || []).filter((person) =>
        (person.name || '').toLowerCase().includes(participantModal.searchValue.toLowerCase()) &&
        !participantModal.selectedPersonIds.includes(person._id)
    );

    const selectedPersonsData = participantModal.selectedPersonIds
        .map((id) => (persons_list || []).find((p) => p._id === id) || currentParticipants.find((p) => p._id === id))
        .filter(Boolean) as Array<{ _id: string; name?: string; projects?: Array<{ project?: { name?: string }; role?: string }>; performer?: unknown }>;

    return (
        <Modal
            title="Управление участниками"
            open={participantModal.visible}
            onCancel={handleCancel}
            width={600}
            footer={[
                <Button key="cancel" onClick={handleCancel}>
                    Отмена
                </Button>,
                <Button key="save" type="primary" onClick={handleSave} loading={participantModal.loading}>
                    Сохранить
                </Button>,
            ]}
        >
            <div className="space-y-4">
                <div>
                    {selectedPersonsData.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {selectedPersonsData.map((person) => (
                                <div key={person._id} className="flex items-start bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">{getInitials(person.name)}</div>
                                        {!_.isEmpty(person.performer) ? (
                                            <div className="text-xs text-gray-500">strato.space</div>
                                        ) : (
                                            person.projects &&
                                            person.projects.length > 0 && (
                                                <div className="text-xs text-gray-500">
                                                    {person.projects
                                                        .map((p) => (p.project?.name ? `${p.project?.name} (${p.role})` : ''))
                                                        .filter(Boolean)
                                                        .join(', ')}
                                                </div>
                                            )
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeSelectedPerson(person._id)}
                                        className="ml-2 text-gray-400 hover:text-red-500 text-lg leading-none"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-gray-500 text-sm">Участники не добавлены</div>
                    )}
                </div>

                <div>
                    <Radio.Group value={participantModal.mode} onChange={handleModeChange}>
                        <Radio value="select">Выбрать существующего</Radio>
                        <Radio value="create">Создать нового</Radio>
                    </Radio.Group>
                </div>

                {participantModal.mode === 'select' && (
                    <div>
                        <h4 className="text-sm font-medium mb-2">Поиск участников:</h4>
                        <Select
                            showSearch
                            placeholder="Введите имя для поиска..."
                            className="w-full mb-4"
                            value={participantModal.searchValue}
                            onSearch={setParticipantModalSearchValue}
                            onSelect={(value) => addSelectedPerson(String(value))}
                            filterOption={false}
                            notFoundContent={participantModal.searchValue ? 'Участник не найден' : 'Введите текст для поиска'}
                        >
                            {filteredPersons.map((person) => (
                                <Select.Option key={person._id} value={person._id}>
                                    {person.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </div>
                )}

                {participantModal.mode === 'create' && (
                    <Form form={form} layout="vertical" onFinish={handleCreatePerson}>
                        <Form.Item label="ФИО" name="name" rules={[{ required: true, message: 'Введите имя' }]}>
                            <Input placeholder="ФИО участника" />
                        </Form.Item>
                        <Form.Item label="Проект" name="project_id">
                            <Select placeholder="Выберите проект" allowClear>
                                {(prepared_projects || []).map((project) => (
                                    <Select.Option key={project._id} value={project._id}>
                                        {project.name}
                                    </Select.Option>
                                ))}
                            </Select>
                        </Form.Item>
                        <Form.Item label="Роль" name="role">
                            <Input placeholder="Роль в проекте" />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" loading={participantModal.loading}>
                            Создать участника
                        </Button>
                    </Form>
                )}
            </div>
        </Modal>
    );
}
