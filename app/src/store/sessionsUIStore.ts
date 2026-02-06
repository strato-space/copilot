import { create } from 'zustand';
import { message } from 'antd';
import type { TicketsModalData, VoiceBotMessage, VoiceMessageRow } from '../types/voice';

interface ParticipantModalState {
    visible: boolean;
    loading: boolean;
    mode: 'select' | 'create';
    selectedPersonIds: string[];
    searchValue: string;
    sessionId: string | null;
    currentParticipants: Array<{ _id?: string } | string>;
}

interface AccessUsersModalState {
    visible: boolean;
    loading: boolean;
    selectedUserIds: string[];
    searchValue: string;
    sessionId: string | null;
    currentUsers: Array<{ _id?: string } | string>;
}

interface TicketsModalState {
    visible: boolean;
    loading: boolean;
    tickets: TicketsModalData['tickets'] | null;
    selectedTicketIds: string[];
    editingTickets: Record<string, unknown>;
    savedChanges: Record<string, unknown>;
}

interface CategorizationSortState {
    ascending: boolean;
}

export type CategorizationRow = VoiceMessageRow & {
    message_id?: string | undefined;
    timeStart?: number | string | undefined;
    timeEnd?: number | string | undefined;
};

interface SessionsUIState {
    participantModal: ParticipantModalState;
    accessUsersModal: AccessUsersModalState;
    selectedCategorizationRows: CategorizationRow[];
    categorizationSort: CategorizationSortState;
    ticketsModal: TicketsModalState;

    setParticipantModalVisible: (visible: boolean) => void;
    setParticipantModalLoading: (loading: boolean) => void;
    setParticipantModalMode: (mode: 'select' | 'create') => void;
    setParticipantModalSelectedPersonIds: (selectedPersonIds: string[]) => void;
    setParticipantModalSearchValue: (searchValue: string) => void;
    openParticipantModal: (sessionId: string, currentParticipants?: Array<{ _id?: string } | string>) => void;
    closeParticipantModal: () => void;
    resetParticipantModal: () => void;
    addSelectedPerson: (personId: string) => void;
    removeSelectedPerson: (personId: string) => void;

    setAccessUsersModalVisible: (visible: boolean) => void;
    setAccessUsersModalLoading: (loading: boolean) => void;
    setAccessUsersModalSelectedUserIds: (selectedUserIds: string[]) => void;
    setAccessUsersModalSearchValue: (searchValue: string) => void;
    openAccessUsersModal: (sessionId: string, currentUsers?: Array<{ _id?: string } | string>) => void;
    closeAccessUsersModal: () => void;
    resetAccessUsersModal: () => void;
    addSelectedUser: (userId: string) => void;
    removeSelectedUser: (userId: string) => void;

    setSelectedCategorizationRows: (rows: CategorizationRow[]) => void;
    addSelectedCategorizationRow: (row: CategorizationRow) => void;
    removeSelectedCategorizationRow: (row: CategorizationRow) => void;
    toggleSelectedCategorizationRow: (row: CategorizationRow) => void;
    isCategorizationRowSelected: (row: CategorizationRow) => boolean;
    clearSelectedCategorizationRows: () => void;
    toggleCategorizationSort: () => void;
    setCategorizationSortAscending: (ascending: boolean) => void;
    initCategorizationSort: (sessionIsActive?: boolean) => void;

    openTicketsModal: (data: TicketsModalData) => void;
    closeTicketsModal: () => void;
    setTicketsModalLoading: (loading: boolean) => void;
    setTicketsModalTickets: (tickets: TicketsModalData['tickets']) => void;
    setTicketsModalSelectedIds: (selectedTicketIds: string[]) => void;
    setSelectedTicketIds: (selectedTicketIds: string[]) => void;
    toggleTicketSelection: (ticketId: string) => void;
    setEditingTicket: (ticketId: string, updates: Record<string, unknown>) => void;
    setTicketEditing: (ticketId: string, field: string, value: unknown) => void;
    saveTicketEdit: (ticketId: string) => void;
    cancelTicketEdit: (ticketId: string) => void;
    isTicketEditing: (ticketId: string, field: string) => boolean;
    getTicketEditedValue: (ticketId: string, field: string, originalValue: unknown) => unknown;
    getUpdatedTickets: () => Array<Record<string, unknown>>;
    saveEditingTicket: (ticketId: string) => void;
    resetTicketEdits: () => void;
    generateSessionTitle: (
        sessionId: string,
        getSessionData: (
            sessionId: string
        ) => Promise<{ session_messages?: Array<Record<string, unknown>> | VoiceBotMessage[] }>,
        updateSessionName: (sessionId: string, name: string) => Promise<void>,
        sendMCPCall: (mcpServer: string, tool: string, args: unknown, stream?: boolean) => string,
        waitForCompletion: (requestId: string, timeoutMs?: number) => Promise<{ status: string; result?: unknown } | null>
    ) => Promise<void>;
}

const initialParticipantModal: ParticipantModalState = {
    visible: false,
    loading: false,
    mode: 'select',
    selectedPersonIds: [],
    searchValue: '',
    sessionId: null,
    currentParticipants: [],
};

const initialAccessUsersModal: AccessUsersModalState = {
    visible: false,
    loading: false,
    selectedUserIds: [],
    searchValue: '',
    sessionId: null,
    currentUsers: [],
};

const initialTicketsModal: TicketsModalState = {
    visible: false,
    loading: false,
    tickets: null,
    selectedTicketIds: [],
    editingTickets: {},
    savedChanges: {},
};

export const useSessionsUIStore = create<SessionsUIState>((set, get) => ({
    participantModal: initialParticipantModal,
    accessUsersModal: initialAccessUsersModal,
    selectedCategorizationRows: [],
    categorizationSort: { ascending: false },
    ticketsModal: initialTicketsModal,

    setParticipantModalVisible: (visible) =>
        set((state) => ({ participantModal: { ...state.participantModal, visible } })),
    setParticipantModalLoading: (loading) =>
        set((state) => ({ participantModal: { ...state.participantModal, loading } })),
    setParticipantModalMode: (mode) =>
        set((state) => ({ participantModal: { ...state.participantModal, mode } })),
    setParticipantModalSelectedPersonIds: (selectedPersonIds) =>
        set((state) => ({ participantModal: { ...state.participantModal, selectedPersonIds } })),
    setParticipantModalSearchValue: (searchValue) =>
        set((state) => ({ participantModal: { ...state.participantModal, searchValue } })),
    openParticipantModal: (sessionId, currentParticipants = []) =>
        set((state) => ({
            participantModal: {
                ...state.participantModal,
                visible: true,
                sessionId,
                currentParticipants,
                selectedPersonIds: currentParticipants.map((p) => (typeof p === 'string' ? p : p._id || '')),
                mode: 'select',
                searchValue: '',
                loading: false,
            },
        })),
    closeParticipantModal: () =>
        set((state) => ({ participantModal: { ...state.participantModal, ...initialParticipantModal } })),
    resetParticipantModal: () => set({ participantModal: initialParticipantModal }),
    addSelectedPerson: (personId) =>
        set((state) => {
            const { selectedPersonIds } = state.participantModal;
            if (selectedPersonIds.includes(personId)) return state;
            return {
                participantModal: {
                    ...state.participantModal,
                    selectedPersonIds: [...selectedPersonIds, personId],
                },
            };
        }),
    removeSelectedPerson: (personId) =>
        set((state) => ({
            participantModal: {
                ...state.participantModal,
                selectedPersonIds: state.participantModal.selectedPersonIds.filter((id) => id !== personId),
            },
        })),

    setAccessUsersModalVisible: (visible) =>
        set((state) => ({ accessUsersModal: { ...state.accessUsersModal, visible } })),
    setAccessUsersModalLoading: (loading) =>
        set((state) => ({ accessUsersModal: { ...state.accessUsersModal, loading } })),
    setAccessUsersModalSelectedUserIds: (selectedUserIds) =>
        set((state) => ({ accessUsersModal: { ...state.accessUsersModal, selectedUserIds } })),
    setAccessUsersModalSearchValue: (searchValue) =>
        set((state) => ({ accessUsersModal: { ...state.accessUsersModal, searchValue } })),
    openAccessUsersModal: (sessionId, currentUsers = []) =>
        set((state) => ({
            accessUsersModal: {
                ...state.accessUsersModal,
                visible: true,
                sessionId,
                currentUsers,
                selectedUserIds: currentUsers.map((u) => (typeof u === 'string' ? u : u._id || '')),
                searchValue: '',
                loading: false,
            },
        })),
    closeAccessUsersModal: () =>
        set((state) => ({ accessUsersModal: { ...state.accessUsersModal, ...initialAccessUsersModal } })),
    resetAccessUsersModal: () => set({ accessUsersModal: initialAccessUsersModal }),
    addSelectedUser: (userId) =>
        set((state) => {
            const { selectedUserIds } = state.accessUsersModal;
            if (selectedUserIds.includes(userId)) return state;
            return {
                accessUsersModal: {
                    ...state.accessUsersModal,
                    selectedUserIds: [...selectedUserIds, userId],
                },
            };
        }),
    removeSelectedUser: (userId) =>
        set((state) => ({
            accessUsersModal: {
                ...state.accessUsersModal,
                selectedUserIds: state.accessUsersModal.selectedUserIds.filter((id) => id !== userId),
            },
        })),

    setSelectedCategorizationRows: (rows) => set({ selectedCategorizationRows: rows }),
    addSelectedCategorizationRow: (row) =>
        set((state) => {
            const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
            const existingIndex = state.selectedCategorizationRows.findIndex(
                (selectedRow) => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` === rowId
            );
            if (existingIndex === -1) {
                return { selectedCategorizationRows: [...state.selectedCategorizationRows, row] };
            }
            return state;
        }),
    removeSelectedCategorizationRow: (row) =>
        set((state) => {
            const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
            return {
                selectedCategorizationRows: state.selectedCategorizationRows.filter(
                    (selectedRow) => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` !== rowId
                ),
            };
        }),
    toggleSelectedCategorizationRow: (row) =>
        set((state) => {
            const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
            const existingIndex = state.selectedCategorizationRows.findIndex(
                (selectedRow) => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` === rowId
            );
            if (existingIndex !== -1) {
                return {
                    selectedCategorizationRows: state.selectedCategorizationRows.filter((_, index) => index !== existingIndex),
                };
            }
            return { selectedCategorizationRows: [...state.selectedCategorizationRows, row] };
        }),
    isCategorizationRowSelected: (row) => {
        const state = get();
        const rowId = `${row.message_id}-${row.timeStart}-${row.timeEnd}`;
        return state.selectedCategorizationRows.some(
            (selectedRow) => `${selectedRow.message_id}-${selectedRow.timeStart}-${selectedRow.timeEnd}` === rowId
        );
    },
    clearSelectedCategorizationRows: () => set({ selectedCategorizationRows: [] }),
    toggleCategorizationSort: () =>
        set((state) => ({
            categorizationSort: { ascending: !state.categorizationSort.ascending },
        })),
    setCategorizationSortAscending: (ascending) =>
        set((state) => ({ categorizationSort: { ...state.categorizationSort, ascending } })),
    initCategorizationSort: (sessionIsActive) =>
        set((state) => ({
            categorizationSort: {
                ...state.categorizationSort,
                ascending: sessionIsActive === false,
            },
        })),

    openTicketsModal: (data) =>
        set({ ticketsModal: { ...initialTicketsModal, visible: true, tickets: data.tickets ?? null } }),
    closeTicketsModal: () => set({ ticketsModal: { ...initialTicketsModal } }),
    setTicketsModalLoading: (loading) =>
        set((state) => ({ ticketsModal: { ...state.ticketsModal, loading } })),
    setTicketsModalTickets: (tickets) =>
        set((state) => ({
            ticketsModal: {
                ...state.ticketsModal,
                tickets,
                selectedTicketIds: tickets ? tickets.map((ticket) => String(ticket.id)) : [],
            },
        })),
    setTicketsModalSelectedIds: (selectedTicketIds) =>
        set((state) => ({ ticketsModal: { ...state.ticketsModal, selectedTicketIds } })),
    setSelectedTicketIds: (selectedTicketIds) =>
        set((state) => ({ ticketsModal: { ...state.ticketsModal, selectedTicketIds } })),
    toggleTicketSelection: (ticketId) =>
        set((state) => {
            const selected = state.ticketsModal.selectedTicketIds;
            const next = selected.includes(ticketId)
                ? selected.filter((id) => id !== ticketId)
                : [...selected, ticketId];
            return { ticketsModal: { ...state.ticketsModal, selectedTicketIds: next } };
        }),
    setEditingTicket: (ticketId, updates) =>
        set((state) => ({
            ticketsModal: {
                ...state.ticketsModal,
                editingTickets: { ...state.ticketsModal.editingTickets, [ticketId]: updates },
            },
        })),
    setTicketEditing: (ticketId, field, value) =>
        set((state) => ({
            ticketsModal: {
                ...state.ticketsModal,
                editingTickets: {
                    ...state.ticketsModal.editingTickets,
                    [ticketId]: {
                        ...(state.ticketsModal.editingTickets[ticketId] as Record<string, unknown>),
                        [field]: value,
                    },
                },
            },
        })),
    saveTicketEdit: (ticketId) =>
        set((state) => {
            const editedData = state.ticketsModal.editingTickets[ticketId] as Record<string, unknown> | undefined;
            const newEditingTickets = { ...state.ticketsModal.editingTickets };
            delete newEditingTickets[ticketId];

            return {
                ticketsModal: {
                    ...state.ticketsModal,
                    editingTickets: newEditingTickets,
                    savedChanges: editedData
                        ? {
                            ...state.ticketsModal.savedChanges,
                            [ticketId]: {
                                ...(state.ticketsModal.savedChanges[ticketId] as Record<string, unknown>),
                                ...editedData,
                            },
                        }
                        : state.ticketsModal.savedChanges,
                },
            };
        }),
    cancelTicketEdit: (ticketId) =>
        set((state) => {
            const newEditingTickets = { ...state.ticketsModal.editingTickets };
            delete newEditingTickets[ticketId];
            return {
                ticketsModal: {
                    ...state.ticketsModal,
                    editingTickets: newEditingTickets,
                },
            };
        }),
    isTicketEditing: (ticketId, field) => {
        const state = get();
        return Boolean(
            state.ticketsModal.editingTickets[ticketId] &&
            (state.ticketsModal.editingTickets[ticketId] as Record<string, unknown>)[field] !== undefined
        );
    },
    getTicketEditedValue: (ticketId, field, originalValue) => {
        const state = get();
        const editing = state.ticketsModal.editingTickets[ticketId] as Record<string, unknown> | undefined;
        const saved = state.ticketsModal.savedChanges[ticketId] as Record<string, unknown> | undefined;
        if (editing && editing[field] !== undefined) return editing[field];
        if (saved && saved[field] !== undefined) return saved[field];
        return originalValue;
    },
    getUpdatedTickets: () => {
        const state = get();
        if (!state.ticketsModal.tickets) return [];
        return state.ticketsModal.tickets.map((ticket) => {
            const ticketId = String(ticket.id);
            const editing = state.ticketsModal.editingTickets[ticketId] as Record<string, unknown> | undefined;
            const saved = state.ticketsModal.savedChanges[ticketId] as Record<string, unknown> | undefined;
            return {
                ...ticket,
                ...saved,
                ...editing,
            } as Record<string, unknown>;
        });
    },
    saveEditingTicket: (ticketId) =>
        set((state) => ({
            ticketsModal: {
                ...state.ticketsModal,
                savedChanges: {
                    ...state.ticketsModal.savedChanges,
                    [ticketId]: state.ticketsModal.editingTickets[ticketId],
                },
            },
        })),
    resetTicketEdits: () => set((state) => ({ ticketsModal: { ...state.ticketsModal, editingTickets: {} } })),
    generateSessionTitle: async (sessionId, getSessionData, updateSessionName, sendMCPCall, waitForCompletion) => {
        try {
            const sessionData = await getSessionData(sessionId);
            const sessionMessages = sessionData?.session_messages || [];
            const hasCategorizationData = sessionMessages.some((msg) => {
                if (!msg || typeof msg !== 'object') return false;
                if ('categorization' in msg) {
                    const categorization = (msg as VoiceBotMessage).categorization;
                    return Array.isArray(categorization) && categorization.length > 0;
                }
                return false;
            });

            if (!hasCategorizationData) {
                message.error('Недостаточно данных для генерации названия');
                return;
            }

            const requestId = sendMCPCall('prompt_flow', 'generate_session_title', {
                session_messages: sessionMessages,
            });

            const result = await waitForCompletion(requestId, 120000);
            if (!result || result.status !== 'complete' || !result.result) {
                message.error('Не удалось сгенерировать название');
                return;
            }

            const title = (result.result as { title?: string }).title;
            if (!title) {
                message.error('Пустой результат генерации');
                return;
            }

            await updateSessionName(sessionId, title);
            message.success('Название сессии обновлено');
        } catch (error) {
            console.error('Ошибка при генерации названия:', error);
            message.error('Ошибка при генерации названия');
        }
    },
}));
