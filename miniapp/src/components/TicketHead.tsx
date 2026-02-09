import dayjs from 'dayjs';

import constants from '../constants';
import type { Ticket } from '../types/kanban';

interface TicketHeadProps {
    ticket: Ticket;
    isShownUpdatedAt?: boolean;
    onClick?: () => void;
}

const TicketHead = ({ ticket, isShownUpdatedAt = false, onClick }: TicketHeadProps) => {
    return (
        <div
            className="flex flex-col items-start justify-between gap-2 self-stretch border-b border-[#2b2b2b] px-4 py-2"
            onClick={onClick}
        >
            <div className="inline-flex items-center justify-between gap-2 self-stretch">
                <div className="flex gap-2">
                    {ticket.priority ? (
                        <div className="flex h-5 items-center justify-center gap-2.5 rounded-sm bg-[#ff3141]/20 px-1">
                            <div className="text-[11px] font-bold leading-none text-[#e6e6e6]">{ticket.priority}</div>
                        </div>
                    ) : null}
                    <div className="flex h-5 items-center justify-center gap-2.5 rounded-sm bg-[#3086ff]/20 px-1">
                        <div className="text-[11px] font-bold leading-none text-[#3086ff]">
                            {(constants.simplified_crm_statuses as Record<string, string>)[ticket.task_status]}
                        </div>
                    </div>
                </div>
                {isShownUpdatedAt ? (
                    <div className="w-40 text-right text-[11px] font-normal leading-none text-[#808080]">
                        Обновлено: {ticket.updated_at ? dayjs(ticket.updated_at).format('HH:mm, DD.MM.YY') : '---'}
                    </div>
                ) : null}
            </div>
            <div className="self-stretch text-sm font-bold leading-tight text-white">{ticket.name}</div>
            <div className="inline-flex items-center justify-start gap-2 self-stretch">
                <div className="grow shrink basis-0 text-[11px] font-normal leading-none text-[#b3b3b3]">
                    {[ticket.project, ticket.type].filter(Boolean).join(' • ')}
                </div>
            </div>
        </div>
    );
};

export default TicketHead;
