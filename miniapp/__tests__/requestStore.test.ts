import axios from 'axios';
import { useRequest } from '../src/store/request';

describe('useRequest store', () => {
    beforeEach(() => {
        useRequest.setState({ loading: false, error: '' });
    });

    it('returns data on success', async () => {
        const postMock = jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: { ok: true } });

        const result = await useRequest.getState().api_request('ping', {}, undefined, undefined);

        expect(result).toEqual({ ok: true });
        expect(postMock).toHaveBeenCalled();

        postMock.mockRestore();
    });

    it('sets error on failure', async () => {
        const postMock = jest.spyOn(axios, 'post').mockRejectedValue(new Error('Network error'));

        const result = await useRequest.getState().api_request('ping', {}, undefined, undefined);

        expect(result).toBeUndefined();
        expect(useRequest.getState().error).toBe('Network error');

        postMock.mockRestore();
    });
});
