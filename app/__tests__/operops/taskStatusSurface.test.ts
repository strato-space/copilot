import { describe, expect, it } from '@jest/globals';

import { getTaskStatusDisplayLabel } from '../../src/utils/taskStatusSurface';

describe('task status surface label mapping', () => {
  it('maps legacy and raw task status values into target display labels', () => {
    expect(getTaskStatusDisplayLabel('Draft')).toBe('Draft');
    expect(getTaskStatusDisplayLabel('Backlog')).toBe('Ready');
    expect(getTaskStatusDisplayLabel('Ready')).toBe('Ready');
    expect(getTaskStatusDisplayLabel('Progress 10')).toBe('In Progress');
    expect(getTaskStatusDisplayLabel('Progress 25')).toBe('In Progress');
    expect(getTaskStatusDisplayLabel('Review / Ready')).toBe('Review');
    expect(getTaskStatusDisplayLabel('Review / Implement')).toBe('Review');
    expect(getTaskStatusDisplayLabel('Upload / Deadline')).toBe('Review');
    expect(getTaskStatusDisplayLabel('Done')).toBe('Done');
    expect(getTaskStatusDisplayLabel('Complete')).toBe('Done');
    expect(getTaskStatusDisplayLabel('Archive')).toBe('Archive');
  });
});
