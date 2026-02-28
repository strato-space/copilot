import { ObjectId } from 'mongodb';
import { COLLECTIONS } from '../../src/constants.js';
import {
  buildWorkHoursLookupByTicketDbId,
  normalizeTicketDbId,
  toCrmIdString,
} from '../../src/utils/crmMiniappShared.js';

describe('crmMiniappShared utils', () => {
  test('toCrmIdString keeps id-like inputs stable', () => {
    const objectId = new ObjectId();
    expect(toCrmIdString(objectId)).toBe(objectId.toHexString());
    expect(toCrmIdString('abc')).toBe('abc');
    expect(toCrmIdString(42)).toBe('42');
    expect(toCrmIdString({ _id: { id: { key: objectId } } })).toBe(objectId.toHexString());
    expect(toCrmIdString(null)).toBeNull();
  });

  test('normalizeTicketDbId normalizes supported payloads', () => {
    const objectId = new ObjectId();
    expect(normalizeTicketDbId(objectId)).toBe(objectId.toHexString());
    expect(normalizeTicketDbId(` ${objectId.toHexString()} `)).toBe(objectId.toHexString());
    expect(normalizeTicketDbId({ $oid: objectId.toHexString() })).toBe(objectId.toHexString());
    expect(normalizeTicketDbId({ $oid: 'broken' })).toBeNull();
    expect(normalizeTicketDbId('   ')).toBeNull();
  });

  test('buildWorkHoursLookupByTicketDbId uses canonical lookup shape', () => {
    expect(buildWorkHoursLookupByTicketDbId()).toEqual({
      $lookup: {
        from: COLLECTIONS.WORK_HOURS,
        let: { taskDbId: { $toString: '$_id' } },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [
                  {
                    $convert: {
                      input: '$ticket_db_id',
                      to: 'string',
                      onError: '',
                      onNull: '',
                    },
                  },
                  '$$taskDbId',
                ],
              },
            },
          },
        ],
        as: 'work_data',
      },
    });
  });
});
