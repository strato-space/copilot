import { describe, expect, it } from '@jest/globals';

import {
  buildGroupedTaskTypeOptions,
  resolveTaskTypeSelectValue,
  taskTypeSelectLabel,
  UNNAMED_TASK_TYPE_LABEL,
} from '../../src/utils/taskTypeSelectOptions';

describe('PossibleTasks task type options contract', () => {
  it('reuses the shared hierarchical task type options helper', () => {
    const options = buildGroupedTaskTypeOptions([
      {
        title: 'PM-01',
        children: [
          {
            _id: 'tt-1',
            name: 'Review proposal',
            task_id: 'PM-01-01',
            parent: { title: 'PM-01' },
            long_name: 'PM-01 / Review proposal',
            path: 'PM-01 / Review proposal',
          },
          {
            _id: 'tt-2',
            title: 'Collect details',
            task_id: 'PM-01-02',
            parent: { title: 'PM-01' },
            long_name: 'PM-01 / Collect details',
            path: 'PM-01 / Collect details',
          },
        ],
      },
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]?.label).toBe('PM-01');
    expect(options[0]?.options).toEqual([
      {
        label: 'PM-01-01 / Review proposal',
        value: 'tt-1',
        title: 'PM-01 / Review proposal / PM-01-01 / Review proposal',
        searchLabel: 'PM-01 / Review proposal / PM-01-01 / Review proposal',
        hierarchyLabel: 'PM-01 / Review proposal',
      },
      {
        label: 'PM-01-02 / Collect details',
        value: 'tt-2',
        title: 'PM-01 / Collect details / PM-01-02 / Collect details',
        searchLabel: 'PM-01 / Collect details / PM-01-02 / Collect details',
        hierarchyLabel: 'PM-01 / Collect details',
      },
    ]);
  });

  it('keeps human-readable titles primary and falls back to ids only when needed', () => {
    const options = buildGroupedTaskTypeOptions([
      {
        _id: 'tt-3',
        task_id: 'PM-02',
        supertype: 'PM-02',
      },
    ]);

    expect(options[0]?.options[0]).toEqual({
      label: 'PM-02',
      value: 'tt-3',
      title: 'PM-02',
      searchLabel: 'PM-02',
      hierarchyLabel: '',
    });
  });

  it('uses task_id as the canonical option value when storage ids are absent', () => {
    const options = buildGroupedTaskTypeOptions([
      {
        task_id: 'PM-54',
        title: 'Организация pipeline',
        supertype: 'Процессы',
        long_name: 'Процессы / Организация pipeline',
      },
    ]);

    expect(options[0]?.options[0]).toEqual({
      label: 'PM-54 / Организация pipeline',
      value: 'PM-54',
      title: 'Процессы / Организация pipeline / PM-54 / Организация pipeline',
      searchLabel: 'Процессы / Организация pipeline / PM-54 / Организация pipeline',
      hierarchyLabel: 'Процессы / Организация pipeline',
    });
  });

  it('uses a neutral task type label when the current value cannot be resolved', () => {
    expect(taskTypeSelectLabel('tt-3', 'tt-3')).toBe(UNNAMED_TASK_TYPE_LABEL);
    expect(taskTypeSelectLabel('PM-02', 'tt-3')).toBe('PM-02');
  });

  it('resolves task type labels back to canonical option values for shared selector parity', () => {
    expect(
      resolveTaskTypeSelectValue(
        [
          {
            _id: 'tt-54',
            task_id: 'PM-54',
            title: 'Организация pipeline',
            supertype: 'Процессы',
            long_name: 'Процессы / Организация pipeline',
          },
        ],
        'PM-54 / Организация pipeline'
      )
    ).toBe('tt-54');
  });
});
