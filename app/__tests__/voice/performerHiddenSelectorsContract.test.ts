import { describe, expect, it } from '@jest/globals';

import { isPerformerSelectable } from '../../src/utils/performerLifecycle';

describe('Performer hidden selectors contract', () => {
  it('hides hard-blocked performers from active selectors by corporate email', () => {
    expect(
      isPerformerSelectable({
        name: 'Visible Name',
        corporate_email: 'gatitulin@strato.space',
      })
    ).toBe(false);
  });

  it('hides hard-blocked performers from active selectors by alias', () => {
    expect(
      isPerformerSelectable({
        name: 'ViLco_O',
      })
    ).toBe(false);
  });

  it('keeps regular active performers selectable', () => {
    expect(
      isPerformerSelectable({
        name: 'Normal User',
        corporate_email: 'normal.user@strato.space',
      })
    ).toBe(true);
  });
});
