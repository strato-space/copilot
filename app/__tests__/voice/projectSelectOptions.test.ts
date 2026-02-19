import { describe, expect, it } from '@jest/globals';

import { buildGroupedProjectOptions, UNGROUPED_PROJECTS_LABEL } from '../../src/components/voice/projectSelectOptions';

describe('Voice project selector options', () => {
  it('groups projects by project_group.name and keeps ungrouped bucket first', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: 'p3',
        name: 'Copilot',
        project_group: { name: 'AI Agents' },
      },
      {
        _id: 'p1',
        title: 'PMO',
      },
      {
        _id: 'p2',
        name: 'CRM desktop',
        project_group: { name: 'AI Agents' },
      },
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]?.label).toBe(UNGROUPED_PROJECTS_LABEL);
    expect(options[0]?.options).toEqual([{ label: 'PMO', value: 'p1' }]);
    expect(options[1]?.label).toBe('AI Agents');
    expect(options[1]?.options).toEqual([
      { label: 'Copilot', value: 'p3' },
      { label: 'CRM desktop', value: 'p2' },
    ]);
  });

  it('falls back to project id if both name and title are missing', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: '507f1f77bcf86cd799439011',
      },
    ]);

    expect(options[0]?.options[0]?.label).toBe('507f1f77bcf86cd799439011');
  });
});
