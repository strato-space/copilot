import { useEffect } from 'react';
import { ConfigProvider, Tabs } from 'antd';

import KanbanHead from '../components/KanbanHead';
import TicketsList from '../components/TicketsList';
import ASTicketMenu from '../components/ASTicketMenu';
import ASChangeStatus from '../components/ASChangeStatus';
import ASTrackTime from '../components/ASTrackTime';
import ASRejectTicket from '../components/ASRejectTicket';
import LoadingScreen from '../components/LoadingScreen';
import OneTicket from '../components/OneTicket';

import { useKanban } from '../store/kanban';
import constants from '../constants';

const tabs: Record<string, string> = {
    '1': 'Draft',
    '2': 'Ready',
    '3': 'In Progress',
    '4': 'Review',
    '5': 'Done',
    '6': 'Archive',
};

const statuses: Record<string, string[]> = {
    Draft: [constants.task_statuses.DRAFT_10],
    Ready: [constants.task_statuses.READY_10],
    'In Progress': [constants.task_statuses.PROGRESS_10],
    Review: [constants.task_statuses.REVIEW_10],
    Done: [constants.task_statuses.DONE_10],
    Archive: [constants.task_statuses.ARCHIVE],
};

const KanbanPage = () => {
    const { selectedTicket, activeActionSheet, setStatusesFilter, tickets_loaded, fetchTickets } = useKanban();

    useEffect(() => {
        void fetchTickets();
    }, [fetchTickets]);

    if (!tickets_loaded) {
        return <LoadingScreen />;
    }

    if (selectedTicket) {
        return (
            <>
                <OneTicket />
                {activeActionSheet === constants.action_sheets.REJECT_TICKET ? <ASRejectTicket /> : null}
                {activeActionSheet === constants.action_sheets.CHANGE_STATUS ? <ASChangeStatus /> : null}
                {activeActionSheet === constants.action_sheets.TRACK_TIME ? <ASTrackTime /> : null}
                {activeActionSheet === constants.action_sheets.TICKET_MENU ? <ASTicketMenu /> : null}
            </>
        );
    }

    return (
        <>
            <KanbanHead />
            <ConfigProvider
                theme={{
                    components: {
                        Tabs: {
                            itemColor: '#E6E6E6',
                            inkBarColor: '#3086FF',
                            itemHoverColor: '#3086FF',
                            itemSelectedColor: '#3086FF',
                            horizontalMargin: '0 0 0 0',
                            horizontalItemPadding: '12px 0',
                            titleFontSize: 15,
                        },
                    },
                }}
            >
                <Tabs
                    defaultActiveKey="2"
                    items={['1', '2', '3', '4', '5', '6'].map((i) => ({
                        key: i,
                        label: tabs[i],
                        children: <TicketsList />,
                    }))}
                    centered
                    onChange={(key) => {
                        const tabLabel = tabs[key];
                        if (!tabLabel) {
                            return;
                        }
                        const nextStatuses = statuses[tabLabel];
                        if (!nextStatuses) {
                            return;
                        }
                        setStatusesFilter(nextStatuses);
                    }}
                />
            </ConfigProvider>
        </>
    );
};

export default KanbanPage;
