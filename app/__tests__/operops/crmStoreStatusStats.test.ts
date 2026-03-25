import { jest } from '@jest/globals';
import { useCRMStore } from '../../src/store/crmStore';
import type { Ticket } from '../../src/types/crm';

jest.mock('../../src/store/requestStore', () => ({
  useRequestStore: {
    getState: () => ({
      api_request: jest.fn(),
    }),
  },
}));

describe('CRM store status stats idempotence', () => {
  afterEach(() => {
    useCRMStore.setState({ all_statuses_stat: {} });
  });

  it('does not rewrite all_statuses_stat when counts are unchanged', () => {
    const tickets = [
      { task_status: 'DRAFT_10' },
      { task_status: 'READY_10' },
      { task_status: 'READY_10' },
    ] as Ticket[];

    useCRMStore.getState().calculateStatusesStat(tickets);
    const firstStatsRef = useCRMStore.getState().all_statuses_stat;

    useCRMStore.getState().calculateStatusesStat(tickets);
    const secondStatsRef = useCRMStore.getState().all_statuses_stat;

    expect(secondStatsRef).toBe(firstStatsRef);
    expect(secondStatsRef).toEqual({
      DRAFT_10: 1,
      READY_10: 2,
    });
  });
});
