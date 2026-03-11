import { deterministicJobId } from '../src/jobs/enqueue.js';

describe('deterministicJobId', () => {
  it('builds stable ids for file and webhook jobs', () => {
    expect(deterministicJobId.syncFileTree('file-1', 'webhook')).toBe('sync-file--file-1--webhook');
    expect(deterministicJobId.webhook('wh-1:FILE_UPDATE:file-1:2026-03-11T10:00:00Z')).toBe(
      'webhook--wh-1-FILE_UPDATE-file-1-2026-03-11T10-00-00Z'
    );
  });
});
