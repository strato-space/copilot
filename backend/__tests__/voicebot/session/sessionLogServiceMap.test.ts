import { describe, expect, it } from '@jest/globals';
import { ObjectId } from 'mongodb';

import { mapEventForApi } from '../../../src/services/voicebotSessionLog.js';

describe('voicebotSessionLog mapEventForApi', () => {
  it('exposes correlation and idempotency keys for summary audit events', () => {
    const mapped = mapEventForApi({
      _id: new ObjectId('507f1f77bcf86cd799439011'),
      session_id: new ObjectId('507f1f77bcf86cd799439012'),
      event_name: 'summary_telegram_send',
      correlation_id: 'corr-123',
      metadata: {
        idempotency_key: 'idem-123',
      },
    } as any);

    expect(mapped).toEqual(
      expect.objectContaining({
        correlation_id: 'corr-123',
        correlation_key: 'corr-123',
        idempotency_key: 'idem-123',
      })
    );
  });
});
