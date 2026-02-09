import { ClockCircleOutlined, FireOutlined } from '@ant-design/icons';

import ActionSheet from './ActionSheet';
import TicketHead from './TicketHead';

import { useKanban } from '../store/kanban';
import constants from '../constants';

const ASTicketMenu = () => {
    const { selectedTicket, setActiveActionSheet } = useKanban();

    if (!selectedTicket) {
        return null;
    }

    return (
        <ActionSheet onClose={() => setActiveActionSheet(null)}>
            <TicketHead ticket={selectedTicket} />
            <div className="flex w-full flex-col gap-3 px-4 pt-3">
                <div
                    className="flex h-14 items-center justify-between rounded-lg bg-neutral-950 px-3"
                    onClick={() => setActiveActionSheet(constants.action_sheets.CHANGE_STATUS)}
                >
                    <div className="flex gap-3">
                        <FireOutlined className="text-white" />
                        <div className="self-stretch text-[15px] font-bold leading-[21px] text-[#e6e6e6]">Change status</div>
                    </div>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M12.6418 7.65837L9.07494 4.09154C8.85608 3.87278 8.55929 3.74993 8.24985 3.75C7.9404 3.75007 7.64367 3.87307 7.42491 4.09193C7.20616 4.31078 7.0833 4.60758 7.08337 4.91702C7.08345 5.22646 7.20644 5.5232 7.4253 5.74195L10.9921 9.308C11.0283 9.34413 11.0571 9.38704 11.0767 9.43429C11.0963 9.48153 11.1064 9.53218 11.1064 9.58333C11.1064 9.63448 11.0963 9.68513 11.0767 9.73238C11.0571 9.77962 11.0283 9.82254 10.9921 9.85866L7.4253 13.4247C7.20644 13.6435 7.08345 13.9402 7.08337 14.2496C7.0833 14.5591 7.20616 14.8559 7.42491 15.0747C7.64367 15.2936 7.9404 15.4166 8.24985 15.4167C8.55929 15.4167 8.85608 15.2939 9.07494 15.0751L12.6418 11.5083C13.1514 10.9973 13.4376 10.305 13.4376 9.58333C13.4376 8.86163 13.1514 8.16938 12.6418 7.65837Z"
                            fill="white"
                        />
                    </svg>
                </div>
                <div
                    className="flex h-14 items-center justify-between rounded-lg bg-neutral-950 px-3"
                    onClick={() => setActiveActionSheet(constants.action_sheets.TRACK_TIME)}
                >
                    <div className="flex gap-3">
                        <ClockCircleOutlined className="text-white" />
                        <div className="self-stretch text-[15px] font-bold leading-[21px] text-[#e6e6e6]">Track time</div>
                    </div>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M12.6418 7.65837L9.07494 4.09154C8.85608 3.87278 8.55929 3.74993 8.24985 3.75C7.9404 3.75007 7.64367 3.87307 7.42491 4.09193C7.20616 4.31078 7.0833 4.60758 7.08337 4.91702C7.08345 5.22646 7.20644 5.5232 7.4253 5.74195L10.9921 9.308C11.0283 9.34413 11.0571 9.38704 11.0767 9.43429C11.0963 9.48153 11.1064 9.53218 11.1064 9.58333C11.1064 9.63448 11.0963 9.68513 11.0767 9.73238C11.0571 9.77962 11.0283 9.82254 10.9921 9.85866L7.4253 13.4247C7.20644 13.6435 7.08345 13.9402 7.08337 14.2496C7.0833 14.5591 7.20616 14.8559 7.42491 15.0747C7.64367 15.2936 7.9404 15.4166 8.24985 15.4167C8.55929 15.4167 8.85608 15.2939 9.07494 15.0751L12.6418 11.5083C13.1514 10.9973 13.4376 10.305 13.4376 9.58333C13.4376 8.86163 13.1514 8.16938 12.6418 7.65837Z"
                            fill="white"
                        />
                    </svg>
                </div>
            </div>
        </ActionSheet>
    );
};

export default ASTicketMenu;
