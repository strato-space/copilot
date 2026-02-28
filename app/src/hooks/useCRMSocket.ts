import { useEffect, useRef } from 'react';
import {
    getSocket,
    subscribeToChannel,
    unsubscribeFromChannel,
    onSocketEvent,
    SOCKET_EVENTS,
    CHANNELS,
} from '../services/socket';
import { useKanbanStore } from '../store/kanbanStore';
import type { Ticket, Epic, Comment as CommentType, WorkData } from '../types/crm';

interface TicketEventPayload {
    ticket: Ticket;
}

interface EpicEventPayload {
    epic: Epic;
}

interface CommentEventPayload {
    ticket_id: string;
    comment: CommentType;
}

interface WorkHoursEventPayload {
    ticket_id: string;
    work: WorkData;
}

/**
 * Hook to manage CRM socket subscriptions and handle real-time updates
 */
export const useCRMSocket = () => {
    const cleanupRef = useRef<(() => void)[]>([]);
    const { fetchTickets, fetchDictionary } = useKanbanStore();

    useEffect(() => {
        // Initialize socket connection
        const socket = getSocket();

        // Subscribe to CRM channel
        subscribeToChannel(CHANNELS.CRM);

        // Set up event listeners
        const cleanups: (() => void)[] = [];

        // Ticket created
        cleanups.push(
            onSocketEvent<TicketEventPayload>(SOCKET_EVENTS.TICKET_CREATED, (data) => {
                // Refetch tickets to include new one
                fetchTickets();
            })
        );

        // Ticket updated
        cleanups.push(
            onSocketEvent<TicketEventPayload>(SOCKET_EVENTS.TICKET_UPDATED, (data) => {
                // Update the specific ticket in store
                const { tickets } = useKanbanStore.getState();
                const updatedTickets = tickets.map((t) =>
                    t._id === data.ticket._id ? { ...t, ...data.ticket } : t
                );
                useKanbanStore.setState({ tickets: updatedTickets, tickets_updated_at: Date.now() });
            })
        );

        // Ticket deleted
        cleanups.push(
            onSocketEvent<{ ticket_id: string }>(SOCKET_EVENTS.TICKET_DELETED, (data) => {
                const { tickets } = useKanbanStore.getState();
                const filteredTickets = tickets.filter((t) => t._id !== data.ticket_id);
                useKanbanStore.setState({ tickets: filteredTickets, tickets_updated_at: Date.now() });
            })
        );

        // Epic updated
        cleanups.push(
            onSocketEvent<EpicEventPayload>(SOCKET_EVENTS.EPIC_UPDATED, (data) => {
                const { epics } = useKanbanStore.getState();
                if (epics) {
                    useKanbanStore.setState({
                        epics: { ...epics, [data.epic._id]: data.epic },
                    });
                }
            })
        );

        // Comment added
        cleanups.push(
            onSocketEvent<CommentEventPayload>(SOCKET_EVENTS.COMMENT_ADDED, (data) => {
                // Could update comments in UI if needed
            })
        );

        // Work hours updated
        cleanups.push(
            onSocketEvent<WorkHoursEventPayload>(SOCKET_EVENTS.WORK_HOURS_UPDATED, (data) => {
                // Could trigger widgets refresh
            })
        );

        cleanupRef.current = cleanups;

        // Cleanup on unmount
        return () => {
            unsubscribeFromChannel(CHANNELS.CRM);
            cleanupRef.current.forEach((cleanup) => cleanup());
            cleanupRef.current = [];
        };
    }, [fetchTickets, fetchDictionary]);

    return { socket: getSocket() };
};

export default useCRMSocket;
