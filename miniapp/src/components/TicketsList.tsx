import TicketHead from './TicketHead';
import { useKanban } from '../store/kanban';

const TicketsList = () => {
    const { setSelectedTicket, getFilteredTickets } = useKanban();
    const tickets = getFilteredTickets();

    return (
        <div className="inline-flex w-full flex-col items-start justify-start">
            {tickets.map((ticket) => (
                <TicketHead
                    isShownUpdatedAt
                    key={ticket.id ?? ticket._id}
                    ticket={ticket}
                    onClick={() => {
                        setSelectedTicket(ticket);
                    }}
                />
            ))}
        </div>
    );
};

export default TicketsList;
