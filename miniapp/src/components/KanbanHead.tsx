import dayjs from 'dayjs';
import { SyncOutlined } from '@ant-design/icons';

import { useKanban } from '../store/kanban';

const KanbanHead = () => {
    const { fetchTickets, tickets_updated_at } = useKanban();

    return (
        <div className="flex justify-between p-4">
            <div className="flex items-center gap-2">
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#3086ff]">
                    <div className="h-2 w-2 rounded-full bg-white" />
                </div>
                <div className="text-sm font-bold leading-tight">strato.design</div>
            </div>
            <div className="flex items-center gap-4">
                <SyncOutlined className="cursor-pointer text-[#fff]" onClick={() => void fetchTickets()} />
                <div className="text-[12px] text-[#fff]">
                    Data updated: {tickets_updated_at ? dayjs(tickets_updated_at).format('HH:mm') : '---'}
                </div>
            </div>
        </div>
    );
};

export default KanbanHead;
