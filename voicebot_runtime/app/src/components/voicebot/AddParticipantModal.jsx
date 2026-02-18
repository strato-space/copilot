import React, { useEffect } from "react";
import { Modal, Button, Select, Form, Input, Radio } from "antd";
import _ from "lodash";

import { useVoiceBot } from "../../store/voiceBot";
import { useSessionsUI } from "../../store/sessionsUI";

const AddParticipantModal = () => {
    const {
        persons_list,
        prepared_projects,
        fetchPersonsList,
        createPerson,
        updateSessionParticipants
    } = useVoiceBot();

    const {
        participantModal,
        setParticipantModalLoading,
        setParticipantModalMode,
        setParticipantModalSearchValue,
        closeParticipantModal,
        addSelectedPerson,
        removeSelectedPerson,
        resetParticipantModal
    } = useSessionsUI();

    const [form] = Form.useForm();

    useEffect(() => {
        if (participantModal.visible) {
            fetchPersonsList();
        }
    }, [participantModal.visible]);

    const handleModeChange = (e) => {
        setParticipantModalMode(e.target.value);
        form.resetFields();
    };

    const handlePersonSelect = (personId) => {
        addSelectedPerson(personId);
    };

    const handlePersonRemove = (personId) => {
        removeSelectedPerson(personId);
    };

    const getInitials = (fullName) => {
        if (!fullName) return '';
        const parts = fullName.split(' ');
        if (parts.length === 1) return parts[0]; // Только фамилия

        const surname = parts[0]; // Фамилия
        const initials = parts.slice(1)
            .map(name => name.charAt(0).toUpperCase())
            .join('.');

        return initials ? `${surname} ${initials}.` : surname;
    };

    const handleCreatePerson = async (values) => {
        try {
            setParticipantModalLoading(true);
            
            const personData = {
                name: values.name,
                projects: values.project_id ? [{
                    project_id: values.project_id,
                    role: values.role || ''
                }] : []
            };

            // Создаем персону и получаем _id от бекенда
            const createdPerson = await createPerson(personData);
            
            // Добавляем созданную персону в выбранные участники
            if (createdPerson && createdPerson._id) {
                addSelectedPerson(createdPerson._id);
            }
            
            // Сбрасываем форму и переключаемся в режим выбора
            form.resetFields();
            setParticipantModalMode('select');
        } catch (e) {
            console.error('Ошибка при создании участника:', e);
        } finally {
            setParticipantModalLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setParticipantModalLoading(true);
            
            if (participantModal.sessionId) {
                await updateSessionParticipants(
                    participantModal.sessionId, 
                    participantModal.selectedPersonIds
                );
            }
            
            closeParticipantModal();
        } catch (e) {
            console.error('Ошибка при сохранении участников:', e);
        } finally {
            setParticipantModalLoading(false);
        }
    };

    const handleCancel = () => {
        resetParticipantModal();
        closeParticipantModal();
    };

    // Фильтрация персон для поиска
    const filteredPersons = (persons_list || []).filter(person =>
        (person.name.toLowerCase().includes(participantModal.searchValue.toLowerCase()) ||
        (person.projects || []).some(p => p.project?.name.toLowerCase().includes(participantModal.searchValue.toLowerCase())) ||        
        (person.projects || []).some(p => p.role.toLowerCase().includes(participantModal.searchValue.toLowerCase())) 
    ) &&
        !participantModal.selectedPersonIds.includes(person._id)
    );

    // Получаем данные выбранных участников
    const selectedPersonsData = participantModal.selectedPersonIds.map(id =>
        (persons_list || []).find(p => p._id === id) ||
        participantModal.currentParticipants.find(p => p._id === id)
    ).filter(Boolean);

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
                <Button
                    key="save"
                    type="primary"
                    onClick={handleSave}
                    loading={participantModal.loading}
                >
                    Сохранить
                </Button>
            ]}
        >
            <div className="space-y-4">
                {/* Текущие участники */}
                <div>
                    {selectedPersonsData.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {selectedPersonsData.map((person) => (
                                <div key={person._id} className="flex items-start bg-gray-50 border border-gray-200 rounded px-2 py-1">
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">{getInitials(person.name)}</div>
                                        {!_.isEmpty(person.performer) ?
                                            <div className="text-xs text-gray-500">strato.space</div> :
                                            person.projects && person.projects.length > 0 && (
                                                <div className="text-xs text-gray-500">
                                                    {person.projects.map(p => p.project?.name ? `${p.project?.name} (${p.role})` : "").join(', ')}
                                                </div>
                                            )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handlePersonRemove(person._id)}
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

                {/* Выбор режима */}
                <div>
                    <Radio.Group value={participantModal.mode} onChange={handleModeChange}>
                        <Radio value="select">Выбрать существующего</Radio>
                        <Radio value="create">Создать нового</Radio>
                    </Radio.Group>
                </div>

                {/* Режим выбора */}
                {participantModal.mode === 'select' && (
                    <div>
                        <h4 className="text-sm font-medium mb-2">Поиск участников:</h4>
                        <Select
                            showSearch
                            placeholder="Введите имя для поиска..."
                            style={{ width: '100%', marginBottom: 16 }}
                            value={participantModal.searchValue}
                            onSearch={setParticipantModalSearchValue}
                            onSelect={(value, option) => {
                                handlePersonSelect(value);
                                setParticipantModalSearchValue('');
                            }}
                            filterOption={false}
                            notFoundContent={participantModal.searchValue ? "Участник не найден" : "Введите текст для поиска"}
                        >
                            {filteredPersons.map(person => (
                                <Select.Option key={person._id} value={person._id}>
                                    <div>
                                        <div>{person.name}</div>
                                        {!_.isEmpty(person.performer) ?
                                            <div className="text-xs text-gray-500">strato.space</div> :
                                            person.projects && person.projects.length > 0 && (
                                                <div className="text-xs text-gray-500">
                                                    {person.projects.map(p => `${p.project?.name}${p.role ? " (" + p.role + ")" : ""}`).join(', ')}
                                                </div>
                                            )}
                                    </div>
                                </Select.Option>
                            ))}
                        </Select>
                    </div>
                )}

                {/* Режим создания */}
                {participantModal.mode === 'create' && (
                    <div>
                        <h4 className="text-sm font-medium mb-2">Создать нового участника:</h4>
                        <Form
                            form={form}
                            layout="vertical"
                            onFinish={handleCreatePerson}
                        >
                            <Form.Item
                                name="name"
                                label="ФИО"
                                rules={[{ required: true, message: 'Введите ФИО' }]}
                            >
                                <Input placeholder="Иванов Иван Иванович" />
                            </Form.Item>

                            <Form.Item
                                name="project_id"
                                label="Проект (необязательно)"
                            >
                                <Select
                                    placeholder="Выберите проект"
                                    allowClear
                                    showSearch
                                    filterOption={(inputValue, option) =>
                                        option.label.toLowerCase().includes(inputValue.toLowerCase())
                                    }
                                >
                                    {Object.entries(_.groupBy(prepared_projects || [], 'project_group.name')).map(([project_group, projects]) => (
                                        <Select.OptGroup key={project_group} label={project_group}>
                                            {projects.map(project => (
                                                <Select.Option key={project._id} value={project._id} label={project.name}>
                                                    {project.name}
                                                </Select.Option>
                                            ))}
                                        </Select.OptGroup>
                                    ))}
                                </Select>
                            </Form.Item>

                            <Form.Item
                                name="role"
                                label="Роль в проекте (необязательно)"
                            >
                                <Input placeholder="Разработчик, Аналитик, Менеджер..." />
                            </Form.Item>

                            <Form.Item>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={participantModal.loading}
                                    block
                                >
                                    Создать и добавить
                                </Button>
                            </Form.Item>
                        </Form>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default AddParticipantModal;
