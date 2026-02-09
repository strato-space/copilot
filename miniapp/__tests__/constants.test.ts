import constants from '../src/constants';

describe('constants', () => {
    it('maps statuses to simplified crm statuses', () => {
        expect(constants.simplified_crm_statuses['Progress 10']).toBe('In Progress');
        expect(constants.simplified_crm_statuses['Review / Ready']).toBe('Review');
    });

    it('has performer status mapping', () => {
        expect(constants.performer_crm_statuses.Ready).toBe('Ready');
        expect(constants.performer_crm_statuses.Review).toBe('Review / Ready');
    });
});
