import { act } from 'react-dom/test-utils';
import constants from '../src/constants';
import { useKanban } from '../src/store/kanban';

describe('useKanban store', () => {
    beforeEach(() => {
        useKanban.setState({
            tickets: [],
            statusesFilter: ['PROGRESS_10'],
            selectedTicket: null,
            activeActionSheet: null,
        });
    });

    it('filters tickets by statuses', () => {
        useKanban.setState({
            tickets: [
                { _id: '1', name: 'A', task_status: constants.task_statuses.PROGRESS_10 },
                { _id: '2', name: 'B', task_status: constants.task_statuses.REVIEW_10 },
            ],
        });

        const filtered = useKanban.getState().getFilteredTickets();
        expect(filtered).toHaveLength(1);
        expect(filtered[0]._id).toBe('1');
    });

    it('updates selected ticket', () => {
        act(() => {
            useKanban.getState().setSelectedTicket({ _id: '1', name: 'A', task_status: constants.task_statuses.PROGRESS_10 });
        });

        expect(useKanban.getState().selectedTicket?._id).toBe('1');
    });
});
