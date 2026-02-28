import { create } from 'zustand';
import update from 'immutability-helper';
import _ from 'lodash';
import type { MessageInstance } from 'antd/es/message/interface';

import constants from '../constants';
import { useRequest } from './request';
import type { Ticket, TrackTimePayload } from '../types/kanban';

interface MiniappKanbanDataSlice {
    messageApi: MessageInstance | null;
    statusesFilter: string[];
    tickets: Ticket[];
    boards: string[];
    clients: string[];
    tracks: string[];
    task_types: string[];
    task_types_tree: unknown[];
    tree: unknown[];
    performers: Array<Record<string, unknown>>;
    selectedTicket: Ticket | null;
    activeActionSheet: string | null;
    tickets_updated_at: number | null;
    tickets_loaded: boolean;
}

interface MiniappKanbanUiActionsSlice {
    setupMessageApi: (messageApi: MessageInstance) => void;
    setStatusesFilter: (statuses: string[]) => void;
    setSelectedTicket: (ticket: Ticket | null) => void;
    setActiveActionSheet: (activeSheet: string | null) => void;
    getFilteredTickets: () => Ticket[];
    fetchTickets: () => Promise<void>;
}

interface MiniappKanbanTicketActionsSlice {
    changeTicketStatus: (ticket: Ticket, newStatus: string) => Promise<void>;
    trackTicketTime: (formData: TrackTimePayload) => Promise<void>;
    rejectTicket: (values: { ticket_id: string; comment: string }) => Promise<void>;
}

type MiniappKanbanStoreShape = MiniappKanbanDataSlice &
    MiniappKanbanUiActionsSlice &
    MiniappKanbanTicketActionsSlice;

export const useKanban = create<MiniappKanbanStoreShape>((set, get) => {
    const api_request = useRequest.getState().api_request;

    const fetchTickets = async () => {
        try {
            get().messageApi?.loading('Loading tickets..', 0);
            const response = await api_request<{ tickets: Ticket[] }>(
                'tickets',
                {},
                () => {
                    get().messageApi?.destroy();
                },
                () => {
                    get().messageApi?.error('Server error.');
                }
            );

            if (!response) {
                return;
            }

            const handleData = response.tickets.map((item) => ({
                ...item,
                status: item.status ?? constants.notion_ticket_statuses.NONE,
            }));

            const boards = handleData.map((ticket) => ticket.board ?? '').filter(Boolean);
            const performers = _.uniqBy(
                handleData.map((ticket) => ticket.performer).filter(Boolean) as Array<Record<string, unknown>>,
                'id'
            ).filter((performer) => Boolean((performer as { name?: string }).name));

            set({
                tickets: handleData,
                boards,
                performers,
                tickets_loaded: true,
                tickets_updated_at: Date.now(),
            });
        } catch (error) {
            console.error(error);
        }
    };

    return {
        setupMessageApi: (messageApi) => {
            if (!get().messageApi) {
                set({ messageApi });
            }
        },
        messageApi: null,
        statusesFilter: ['PROGRESS_10', 'PROGRESS_20', 'PROGRESS_30', 'PROGRESS_40'],
        setStatusesFilter: (statuses) => set({ statusesFilter: statuses }),
        tickets: [],
        boards: [],
        clients: [],
        tracks: [],
        task_types: [],
        task_types_tree: [],
        tree: [],
        performers: [],
        selectedTicket: null,
        setSelectedTicket: (ticket) => set({ selectedTicket: ticket }),
        activeActionSheet: null,
        setActiveActionSheet: (activeSheet) => set({ activeActionSheet: activeSheet }),
        getFilteredTickets: () => {
            const filterStatuses = get().statusesFilter.map(
                (status) => (constants.task_statuses as Record<string, string>)[status]
            );
            return get().tickets.filter((ticket) => filterStatuses.includes(ticket.task_status));
        },
        fetchTickets,
        tickets_updated_at: null,
        tickets_loaded: false,
        changeTicketStatus: async (ticket, newStatus) => {
            const response = await api_request(
                'tickets/set-status',
                { ticket: ticket._id, newStatus },
                () => {
                    get().messageApi?.info('Status changed.');
                },
                () => {
                    get().messageApi?.error('Server error.');
                }
            );

            if (!response) {
                return;
            }

            const recordIndex = _.findIndex(get().tickets, (item) => item._id === ticket._id);
            if (recordIndex < 0) {
                return;
            }

            const updatedTickets = update(get().tickets, {
                [recordIndex]: { task_status: { $set: newStatus } },
            });

            set({
                tickets: updatedTickets,
                selectedTicket: updatedTickets[recordIndex] ?? null,
            });
        },
        trackTicketTime: async (formData) => {
            await api_request(
                'tickets/track-time',
                { ...formData } as Record<string, unknown>,
                () => {
                    get().messageApi?.info(`Hours tracked: ${formData.time}`);
                },
                () => {
                    get().messageApi?.error('Server error.');
                }
            );
        },
        rejectTicket: async (values) => {
            const recordIndex = _.findIndex(get().tickets, (item) => item._id === values.ticket_id);
            if (recordIndex < 0) {
                return;
            }

            const updatedTickets = update(get().tickets, {
                [recordIndex]: { task_status: { $set: constants.task_statuses.NEW_0 } },
            });

            set({ tickets: updatedTickets });

            const ticket = get().tickets[recordIndex];
            if (!ticket) {
                return;
            }

            await api_request('tickets/set-status', {
                ticket: ticket._id,
                newStatus: constants.task_statuses.NEW_0,
            });

            await api_request('tickets/comment', values);
        },
    };
});
