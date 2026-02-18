import { create } from 'zustand';
import { getMessageCategorizationRows } from '../utils/categorization';

export const useSessionsUI = create((set, get) => ({
    // Состояние модального окна участников
    participantModal: {
        visible: false,
        loading: false,
        mode: 'select', // 'select' или 'create'
        selectedPersonIds: [],
        searchValue: '',
        sessionId: null,
        currentParticipants: []
    },

    // Состояние модального окна управления пользователями с доступом (для RESTRICTED)
    accessUsersModal: {
        visible: false,
        loading: false,
        selectedUserIds: [],
        searchValue: '',
        sessionId: null,
        currentUsers: []
    },

    // Состояние выделенных строк таблицы категоризации
    selectedCategorizationRows: [],

    // Состояние сортировки категоризации
    categorizationSort: {
        ascending: false, // по умолчанию по убыванию
    },

    // Состояние модального окна предварительного просмотра задач
    ticketsModal: {
        visible: false,
        loading: false,
        tickets: null,
        selectedTicketIds: [],
        editingTickets: {},
        savedChanges: {}
    },

    // Действия для модального окна участников
    setParticipantModalVisible: (visible) => set(state => ({
        participantModal: { ...state.participantModal, visible }
    })),

    setParticipantModalLoading: (loading) => set(state => ({
        participantModal: { ...state.participantModal, loading }
    })),

    setParticipantModalMode: (mode) => set(state => ({
        participantModal: { ...state.participantModal, mode }
    })),

    setParticipantModalSelectedPersonIds: (selectedPersonIds) => set(state => ({
        participantModal: { ...state.participantModal, selectedPersonIds }
    })),

    setParticipantModalSearchValue: (searchValue) => set(state => ({
        participantModal: { ...state.participantModal, searchValue }
    })),

    openParticipantModal: (sessionId, currentParticipants = []) => set(state => ({
        participantModal: {
            ...state.participantModal,
            visible: true,
            sessionId,
            currentParticipants,
            selectedPersonIds: currentParticipants.map(p => p._id || p),
            mode: 'select',
            searchValue: '',
            loading: false
        }
    })),

    closeParticipantModal: () => set(state => ({
        participantModal: {
            ...state.participantModal,
            visible: false,
            sessionId: null,
            currentParticipants: [],
            selectedPersonIds: [],
            searchValue: '',
            loading: false
        }
    })),

    addSelectedPerson: (personId) => set(state => {
        const { selectedPersonIds } = state.participantModal;
        if (!selectedPersonIds.includes(personId)) {
            return {
                participantModal: {
                    ...state.participantModal,
                    selectedPersonIds: [...selectedPersonIds, personId]
                }
            };
        }
        return state;
    }),

    removeSelectedPerson: (personId) => set(state => ({
        participantModal: {
            ...state.participantModal,
            selectedPersonIds: state.participantModal.selectedPersonIds.filter(id => id !== personId)
        }
    })),

    resetParticipantModal: () => set(state => ({
        participantModal: {
            ...state.participantModal,
            selectedPersonIds: state.participantModal.currentParticipants.map(p => p._id || p),
            mode: 'select',
            searchValue: '',
            loading: false
        }
    })),

    // Действия для модального окна управления пользователями с доступом (RESTRICTED)
    setAccessUsersModalVisible: (visible) => set(state => ({
        accessUsersModal: { ...state.accessUsersModal, visible }
    })),

    setAccessUsersModalLoading: (loading) => set(state => ({
        accessUsersModal: { ...state.accessUsersModal, loading }
    })),

    setAccessUsersModalSelectedUserIds: (selectedUserIds) => set(state => ({
        accessUsersModal: { ...state.accessUsersModal, selectedUserIds }
    })),

    setAccessUsersModalSearchValue: (searchValue) => set(state => ({
        accessUsersModal: { ...state.accessUsersModal, searchValue }
    })),

    openAccessUsersModal: (sessionId, currentUsers = []) => set(state => ({
        accessUsersModal: {
            ...state.accessUsersModal,
            visible: true,
            sessionId,
            currentUsers,
            selectedUserIds: currentUsers.map(u => u._id || u),
            searchValue: '',
            loading: false
        }
    })),

    closeAccessUsersModal: () => set(state => ({
        accessUsersModal: {
            ...state.accessUsersModal,
            visible: false,
            sessionId: null,
            currentUsers: [],
            selectedUserIds: [],
            searchValue: '',
            loading: false
        }
    })),

    addSelectedUser: (userId) => set(state => {
        const { selectedUserIds } = state.accessUsersModal;
        if (!selectedUserIds.includes(userId)) {
            return {
                accessUsersModal: {
                    ...state.accessUsersModal,
                    selectedUserIds: [...selectedUserIds, userId]
                }
            };
        }
        return state;
    }),

    removeSelectedUser: (userId) => set(state => ({
        accessUsersModal: {
            ...state.accessUsersModal,
            selectedUserIds: state.accessUsersModal.selectedUserIds.filter(id => id !== userId)
        }
    })),

    resetAccessUsersModal: () => set(state => ({
        accessUsersModal: {
            ...state.accessUsersModal,
            selectedUserIds: state.accessUsersModal.currentUsers.map(u => u._id || u),
            searchValue: '',
            loading: false
        }
    })),

    // Методы для управления выделенными строками таблицы категоризации
    setSelectedCategorizationRows: (selectedRows) => set(() => ({
        selectedCategorizationRows: selectedRows
    })),

    addSelectedCategorizationRow: (row) => set(state => {
        const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
        const existingIndex = state.selectedCategorizationRows.findIndex(
            selectedRow => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` === rowId
        );

        if (existingIndex === -1) {
            return {
                selectedCategorizationRows: [...state.selectedCategorizationRows, row]
            };
        }
        return state;
    }),

    removeSelectedCategorizationRow: (row) => set(state => {
        const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
        return {
            selectedCategorizationRows: state.selectedCategorizationRows.filter(
                selectedRow => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` !== rowId
            )
        };
    }),

    toggleSelectedCategorizationRow: (row) => set(state => {
        const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
        const existingIndex = state.selectedCategorizationRows.findIndex(
            selectedRow => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` === rowId
        );

        if (existingIndex !== -1) {
            return {
                selectedCategorizationRows: state.selectedCategorizationRows.filter((_, index) => index !== existingIndex)
            };
        } else {
            return {
                selectedCategorizationRows: [...state.selectedCategorizationRows, row]
            };
        }
    }),

    clearSelectedCategorizationRows: () => set(() => ({
        selectedCategorizationRows: []
    })),

    isCategorizationRowSelected: (row) => {
        const state = get();
        const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
        return state.selectedCategorizationRows.some(
            selectedRow => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` === rowId
        );
    },

    // Управление модальным окном предварительного просмотра задач
    setTicketsModalVisible: (visible) => set(state => ({
        ticketsModal: { ...state.ticketsModal, visible }
    })),

    setTicketsModalLoading: (loading) => set(state => ({
        ticketsModal: { ...state.ticketsModal, loading }
    })),

    setTicketsModalTickets: (tickets) => set(state => ({
        ticketsModal: {
            ...state.ticketsModal,
            tickets,
            selectedTicketIds: tickets ? tickets.map(ticket => ticket.id) : []
        }
    })),

    setTicketsModalSelectedIds: (selectedTicketIds) => set(state => ({
        ticketsModal: { ...state.ticketsModal, selectedTicketIds }
    })),

    openTicketsModal: (tickets) => set(state => ({
        ticketsModal: {
            visible: true,
            loading: false,
            tickets,
            selectedTicketIds: tickets ? tickets.map(ticket => ticket.id) : [],
            editingTickets: {},
            savedChanges: {}
        }
    })),

    closeTicketsModal: () => set(state => ({
        ticketsModal: {
            visible: false,
            loading: false,
            tickets: null,
            selectedTicketIds: [],
            editingTickets: {},
            savedChanges: {}
        }
    })),

    resetTicketsModal: () => set(state => ({
        ticketsModal: {
            ...state.ticketsModal,
            selectedTicketIds: state.ticketsModal.tickets ? state.ticketsModal.tickets.map(ticket => ticket.id) : [],
            loading: false
        }
    })),

    // Управление редактированием задач
    setTicketEditing: (ticketId, field, value) => set(state => ({
        ticketsModal: {
            ...state.ticketsModal,
            editingTickets: {
                ...state.ticketsModal.editingTickets,
                [ticketId]: {
                    ...state.ticketsModal.editingTickets[ticketId],
                    [field]: value
                }
            }
        }
    })),

    saveTicketEdit: (ticketId) => set(state => {
        const editedData = state.ticketsModal.editingTickets[ticketId];
        const newEditingTickets = { ...state.ticketsModal.editingTickets };
        delete newEditingTickets[ticketId];

        return {
            ticketsModal: {
                ...state.ticketsModal,
                editingTickets: newEditingTickets,
                savedChanges: editedData ? {
                    ...state.ticketsModal.savedChanges,
                    [ticketId]: {
                        ...state.ticketsModal.savedChanges[ticketId],
                        ...editedData
                    }
                } : state.ticketsModal.savedChanges
            }
        };
    }),

    cancelTicketEdit: (ticketId) => set(state => {
        const newEditingTickets = { ...state.ticketsModal.editingTickets };
        delete newEditingTickets[ticketId];

        return {
            ticketsModal: {
                ...state.ticketsModal,
                editingTickets: newEditingTickets
            }
        };
    }),

    isTicketEditing: (ticketId, field) => {
        const state = get();
        return state.ticketsModal.editingTickets[ticketId] &&
            state.ticketsModal.editingTickets[ticketId][field] !== undefined;
    },

    getTicketEditedValue: (ticketId, field, originalValue) => {
        const state = get();
        // Сначала проверяем текущие редактируемые значения
        if (state.ticketsModal.editingTickets[ticketId] &&
            state.ticketsModal.editingTickets[ticketId][field] !== undefined) {
            return state.ticketsModal.editingTickets[ticketId][field];
        }
        // Затем проверяем сохраненные изменения
        if (state.ticketsModal.savedChanges[ticketId] &&
            state.ticketsModal.savedChanges[ticketId][field] !== undefined) {
            return state.ticketsModal.savedChanges[ticketId][field];
        }
        // Иначе возвращаем оригинальное значение
        return originalValue;
    },

    getUpdatedTickets: () => {
        const state = get();
        if (!state.ticketsModal.tickets) return [];

        return state.ticketsModal.tickets.map(ticket => {
            const editedData = state.ticketsModal.editingTickets[ticket.id];
            const savedData = state.ticketsModal.savedChanges[ticket.id];

            return {
                ...ticket,
                name: (editedData && editedData.name !== undefined) ? editedData.name :
                    (savedData && savedData.name !== undefined) ? savedData.name : ticket.name,
                description: (editedData && editedData.description !== undefined) ? editedData.description :
                    (savedData && savedData.description !== undefined) ? savedData.description : ticket.description,
                priority: (editedData && editedData.priority !== undefined) ? editedData.priority :
                    (savedData && savedData.priority !== undefined) ? savedData.priority : ticket.priority,
                performer_id: (editedData && editedData.performer_id !== undefined) ? editedData.performer_id :
                    (savedData && savedData.performer_id !== undefined) ? savedData.performer_id : ticket.performer_id,
                project_id: (editedData && editedData.project_id !== undefined) ? editedData.project_id :
                    (savedData && savedData.project_id !== undefined) ? savedData.project_id : ticket.project_id,
                // новое поле: тип задачи
                task_type_id: (editedData && editedData.task_type_id !== undefined) ? editedData.task_type_id :
                    (savedData && savedData.task_type_id !== undefined) ? savedData.task_type_id : ticket.task_type_id
            };
        });
    },

    // Методы для управления сортировкой категоризации
    setCategorizationSortAscending: (ascending) => set(state => ({
        categorizationSort: { ...state.categorizationSort, ascending }
    })),

    toggleCategorizationSort: () => set(state => ({
        categorizationSort: { ...state.categorizationSort, ascending: !state.categorizationSort.ascending }
    })),

    initCategorizationSort: (sessionIsActive) => set(state => ({
        categorizationSort: {
            ...state.categorizationSort,
            ascending: sessionIsActive === false // для завершенных сессий - по возрастанию
        }
    })),

    // Функция генерации заголовка с помощью AI
    generateSessionTitle: async (sessionId, getSessionData, updateSessionName, sendMCPCall, waitForCompletion) => {
        try {
            // Получаем полные данные сессии с сообщениями
            const sessionData = await getSessionData(sessionId);
            const sessionMessages = sessionData?.session_messages || [];

            // Проверяем наличие категоризации
            const hasCategorizationData = sessionMessages.some(msg =>
                getMessageCategorizationRows(msg).length > 0
            );

            if (!hasCategorizationData) {
                return { success: false, error: 'В сообщениях сессии нет данных категоризации для генерации заголовка' };
            }

            // Собираем все категоризации из сообщений сессии
            const allCategorizations = sessionMessages
                .filter(msg => getMessageCategorizationRows(msg).length > 0)
                .map(msg => getMessageCategorizationRows(msg))
                .flat()
                .map(cat => ({
                    ...cat,
                    // Нормализуем topic_keywords: если строка, то конвертируем в массив
                    topic_keywords: typeof cat.topic_keywords === 'string'
                        ? cat.topic_keywords.split(',').map(keyword => keyword.trim()).filter(keyword => keyword.length > 0)
                        : cat.topic_keywords || [],
                    keywords_grouped: JSON.parse(cat.keywords_grouped || '[]'),
                    mentioned_roles: typeof cat.mentioned_roles === 'string'
                        ? cat.mentioned_roles.split(',').map(role => role.trim()).filter(role => role.length > 0)
                        : cat.mentioned_roles || [],
                    referenced_systems: typeof cat.referenced_systems === 'string'
                        ? cat.referenced_systems.split(',').map(system => system.trim()).filter(system => system.length > 0)
                        : cat.referenced_systems || [],
                }));

            // Get agents MCP server URL
            const agentsMcpServerUrl = window.agents_api_url;
            if (!agentsMcpServerUrl) {
                return { success: false, error: 'Не настроен URL сервиса агентов (window.agents_api_url)' };
            }

            // Send MCP request to generate session title
            const requestId = sendMCPCall(
                agentsMcpServerUrl,
                'generate_session_title',
                {
                    message: JSON.stringify(allCategorizations)
                },
                false // No streaming
            );

            // Wait for completion
            const result = await waitForCompletion(requestId, 2 * 60 * 1000); // 2 minute timeout

            console.log('📦 Session title generation result:', result);

            // Check for errors first
            if (result && result.isError) {
                const errorMessage = result.content?.[0]?.text || 'Ошибка при генерации заголовка';
                console.error('❌ Error from agent:', errorMessage);
                return { success: false, error: errorMessage };
            }

            // Extract title from result
            let generatedTitle;
            if (result && typeof result === 'object') {
                // Result might be in result.content[0].text or result.title
                if (result.content && Array.isArray(result.content) && result.content[0]?.text) {
                    const textContent = result.content[0].text;
                    try {
                        const parsed = JSON.parse(textContent);
                        generatedTitle = parsed.title || parsed;
                    } catch {
                        generatedTitle = textContent;
                    }
                } else if (result.title) {
                    generatedTitle = result.title;
                } else if (result.text) {
                    generatedTitle = result.text;
                }
            } else if (typeof result === 'string') {
                generatedTitle = result;
            }

            if (!generatedTitle) {
                return { success: false, error: 'Не удалось извлечь заголовок из ответа агента' };
            }

            console.log('✅ Generated title:', generatedTitle);

            // Update session title
            await updateSessionName(sessionId, generatedTitle);

            return { success: true, title: generatedTitle };

        } catch (error) {
            console.error('❌ Error generating session title:', error);
            return {
                success: false,
                error: error.message || 'Ошибка при генерации заголовка'
            };
        }
    },
}));
