import { describe, expect, it } from '@jest/globals';

import { buildCanonicalTaskSourceRef } from '../../src/services/taskSourceRef.js';

describe('taskSourceRef', () => {
  it('returns empty string when task id is missing', () => {
    expect(buildCanonicalTaskSourceRef(undefined)).toBe('');
    expect(buildCanonicalTaskSourceRef(null)).toBe('');
    expect(buildCanonicalTaskSourceRef('')).toBe('');
  });

  it('builds canonical operops task url for valid task ids', () => {
    expect(buildCanonicalTaskSourceRef('6996ab2f639be97b877f6d75')).toBe(
      'https://copilot.stratospace.fun/operops/task/6996ab2f639be97b877f6d75'
    );
  });
});
