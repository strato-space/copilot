import { ObjectId } from 'mongodb';
import { describe, expect, it } from '@jest/globals';

import {
  buildActivePerformerFilter,
  buildPerformerSelectorFilter,
} from '../../src/services/performerLifecycle.js';

describe('performer lifecycle service', () => {
  it('extends canonical active selector filter with hidden performer denylist', () => {
    expect(buildActivePerformerFilter()).toEqual({
      $and: [
        { is_deleted: { $ne: true } },
        { is_active: { $ne: false } },
        { active: { $ne: false } },
        {
          $nor: [
            { corporate_email: { $in: [/^gatitulin@strato\.space$/i, /^vilco@yandex\.ru$/i] } },
            { email: { $in: [/^gatitulin@strato\.space$/i, /^vilco@yandex\.ru$/i] } },
            { name: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
            { real_name: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
            { username: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
            { telegram_username: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
            { login: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
          ],
        },
      ],
    });
  });

  it('keeps include_ids passthrough for historical assignments', () => {
    const includedPerformerId = new ObjectId('507f1f77bcf86cd799439051');

    expect(buildPerformerSelectorFilter({ includeIds: [includedPerformerId] })).toEqual({
      $or: [
        {
          $and: [
            { is_deleted: { $ne: true } },
            { is_active: { $ne: false } },
            { active: { $ne: false } },
            {
              $nor: [
                { corporate_email: { $in: [/^gatitulin@strato\.space$/i, /^vilco@yandex\.ru$/i] } },
                { email: { $in: [/^gatitulin@strato\.space$/i, /^vilco@yandex\.ru$/i] } },
                { name: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { real_name: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { username: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { telegram_username: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
                { login: { $in: [/^d1zmens$/i, /^vilco_o$/i] } },
              ],
            },
          ],
        },
        { _id: { $in: [includedPerformerId] } },
      ],
    });
  });
});
