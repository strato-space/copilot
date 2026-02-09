import { useState } from 'react';
import classNames from 'classnames';

import ActionSheet from './ActionSheet';
import { useKanban } from '../store/kanban';
import constants from '../constants';

const ASChangeStatus = () => {
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const { selectedTicket, setActiveActionSheet, changeTicketStatus } = useKanban();

    if (!selectedTicket) {
        return null;
    }

    return (
        <ActionSheet onClose={() => setActiveActionSheet(null)}>
            <div className="flex w-full flex-col gap-3 pt-3">
                {Object.entries(constants.performer_crm_statuses).map(([label, value]) => (
                    <div
                        key={value}
                        className={classNames('flex h-12 items-center justify-between px-4', {
                            'opacity-40':
                                label ===
                                (constants.simplified_crm_statuses as Record<string, string>)[selectedTicket.task_status],
                            'bg-[#2B2B2B]': label === selectedStatus,
                        })}
                        onClick={() => setSelectedStatus(value)}
                    >
                        <div className="text-[17px] font-normal leading-normal text-[#e6e6e6]">{label}</div>
                        {value === selectedStatus ? (
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="M7.63848 14.8121C7.26 14.8123 6.89702 14.6619 6.62962 14.394L3.57952 11.345C3.25133 11.0167 3.25133 10.4846 3.57952 10.1563C3.90782 9.82809 4.43999 9.82809 4.76829 10.1563L7.63848 13.0265L15.2318 5.43316C15.5601 5.10496 16.0923 5.10496 16.4206 5.43316C16.7488 5.76145 16.7488 6.29363 16.4206 6.62192L8.64733 14.394C8.37993 14.6619 8.01696 14.8123 7.63848 14.8121Z"
                                    fill="white"
                                />
                            </svg>
                        ) : null}
                    </div>
                ))}
            </div>
            <div className="mt-3 inline-flex items-end justify-center gap-4 border-t border-[#2b2b2b] bg-[#1a1a1a] px-4 pt-4">
                <div
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-[#2b2b2b] bg-[#1a1a1a] p-3"
                    onClick={() => setActiveActionSheet(null)}
                >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M14.9593 9.16733H6.62598L9.36764 6.42566C9.44575 6.34819 9.50775 6.25602 9.55005 6.15447C9.59236 6.05293 9.61414 5.944 9.61414 5.83399C9.61414 5.72398 9.59236 5.61506 9.55005 5.51351C9.50775 5.41196 9.44575 5.3198 9.36764 5.24233C9.21151 5.08712 9.0003 5 8.78014 5C8.55999 5 8.34878 5.08712 8.19264 5.24233L4.61764 8.82566C4.30465 9.13679 4.12784 9.55935 4.12598 10.0007C4.13003 10.4391 4.30668 10.8582 4.61764 11.1673L8.19264 14.7507C8.27034 14.8278 8.36248 14.8889 8.46379 14.9304C8.56509 14.972 8.67359 14.9932 8.78309 14.9928C8.89259 14.9924 9.00093 14.9705 9.10195 14.9282C9.20296 14.8859 9.29466 14.8242 9.37181 14.7465C9.44896 14.6688 9.51005 14.5767 9.5516 14.4754C9.59314 14.374 9.61433 14.2655 9.61394 14.156C9.61355 14.0466 9.5916 13.9382 9.54934 13.8372C9.50708 13.7362 9.44534 13.6445 9.36764 13.5673L6.62598 10.834H14.9593C15.1803 10.834 15.3923 10.7462 15.5486 10.5899C15.7048 10.4336 15.7926 10.2217 15.7926 10.0007C15.7926 9.77965 15.7048 9.56769 15.5486 9.41141C15.3923 9.25512 15.1803 9.16733 14.9593 9.16733Z"
                            fill="white"
                        />
                    </svg>
                </div>
                <div
                    className="flex h-12 grow shrink basis-0 items-center justify-center gap-2 rounded-full border border-[#3086ff] bg-[#3086ff] p-3"
                    onClick={() => {
                        if (!selectedStatus) {
                            return;
                        }
                        void changeTicketStatus(selectedTicket, selectedStatus);
                        setActiveActionSheet(null);
                    }}
                >
                    <div className="text-center text-lg font-normal leading-[24px] text-white">Change status</div>
                </div>
            </div>
        </ActionSheet>
    );
};

export default ASChangeStatus;
