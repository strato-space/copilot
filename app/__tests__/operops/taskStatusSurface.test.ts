import { describe, expect, it } from '@jest/globals';

import { getTaskStatusDisplayLabel } from '../../src/utils/taskStatusSurface';

describe('task status surface label mapping', () => {
  it('maps only exact canonical target statuses into target display labels', () => {
    expect(getTaskStatusDisplayLabel('Draft')).toBe('Draft');
    expect(getTaskStatusDisplayLabel('Ready')).toBe('Ready');
    expect(getTaskStatusDisplayLabel('Progress 10')).toBe('In Progress');
    expect(getTaskStatusDisplayLabel('Review / Ready')).toBe('Review');
    expect(getTaskStatusDisplayLabel('Done')).toBe('Done');
    expect(getTaskStatusDisplayLabel('Archive')).toBe('Archive');
    expect(getTaskStatusDisplayLabel('Backlog')).toBe('Backlog');
    expect(getTaskStatusDisplayLabel('Progress 25')).toBe('Progress 25');
    expect(getTaskStatusDisplayLabel('Review / Implement')).toBe('Review / Implement');
    expect(getTaskStatusDisplayLabel('Upload / Deadline')).toBe('Upload / Deadline');
    expect(getTaskStatusDisplayLabel('Complete')).toBe('Complete');
  });
});
