import { describe, expect, it } from '@jest/globals';

import {
  buildGroupedProjectOptions,
  projectIdentityTokens,
  projectOptionValue,
  resolveProjectSelectValue,
  projectSelectLabel,
  UNNAMED_PROJECT_LABEL,
  UNGROUPED_CUSTOMERS_LABEL,
  UNGROUPED_PROJECTS_LABEL,
} from '../../src/utils/projectSelectOptions';

describe('Voice project selector options', () => {
  it('groups projects by customer/project_group and keeps the ungrouped bucket first', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: 'p3',
        name: 'Copilot',
        customerName: 'Ops',
        projectGroupName: 'AI Agents',
      },
      {
        _id: 'p1',
        title: 'PMO',
      },
      {
        _id: 'p2',
        name: 'CRM desktop',
        customerName: 'Ops',
        projectGroupName: 'AI Agents',
      },
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]?.label).toBe(`${UNGROUPED_CUSTOMERS_LABEL} / ${UNGROUPED_PROJECTS_LABEL}`);
    expect(options[0]?.options).toEqual([
      {
        label: 'PMO',
        value: 'p1',
        title: 'PMO',
        searchLabel: 'PMO',
        hierarchyLabel: '',
      },
    ]);
    expect(options[1]?.label).toBe('Ops / AI Agents');
    expect(options[1]?.options).toEqual([
      {
        label: 'Copilot',
        value: 'p3',
        title: 'Ops / AI Agents / Copilot',
        searchLabel: 'Ops / AI Agents / Copilot',
        hierarchyLabel: 'Ops / AI Agents',
      },
      {
        label: 'CRM desktop',
        value: 'p2',
        title: 'Ops / AI Agents / CRM desktop',
        searchLabel: 'Ops / AI Agents / CRM desktop',
        hierarchyLabel: 'Ops / AI Agents',
      },
    ]);
  });

  it('uses a neutral project label when both name and title are missing', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: '507f1f77bcf86cd799439011',
      },
    ]);

    expect(options[0]?.options[0]).toEqual({
      label: UNNAMED_PROJECT_LABEL,
      value: '507f1f77bcf86cd799439011',
      title: UNNAMED_PROJECT_LABEL,
      searchLabel: UNNAMED_PROJECT_LABEL,
      hierarchyLabel: '',
    });
  });

  it('hydrates nested customer/project-group hierarchy into grouped options', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: 'p4',
        name: 'Future Vision',
        customerName: 'MediaGen',
        projectGroupName: 'Promo',
      },
    ]);

    expect(options[0]?.label).toBe('MediaGen / Promo');
    expect(options[0]?.options[0]).toEqual({
      label: 'Future Vision',
      value: 'p4',
      title: 'MediaGen / Promo / Future Vision',
      searchLabel: 'MediaGen / Promo / Future Vision',
      hierarchyLabel: 'MediaGen / Promo',
    });
  });

  it('uses title-based related labels when project-group/customer records expose title instead of name', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: 'p5',
        name: 'Copilot PM',
        project_group: { title: 'Operations' },
        customer: { title: 'Strato' },
      },
    ]);

    expect(options[0]?.label).toBe('Strato / Operations');
    expect(options[0]?.options[0]).toMatchObject({
      label: 'Copilot PM',
      searchLabel: 'Strato / Operations / Copilot PM',
      hierarchyLabel: 'Strato / Operations',
    });
  });

  it('normalizes object-shaped ids instead of degrading them to [object Object]', () => {
    const options = buildGroupedProjectOptions([
      {
        _id: { $oid: '507f1f77bcf86cd799439012' },
        name: 'MediaGen',
        project_group: { _id: { $oid: 'group-1' }, title: 'Promo' },
        customer: { _id: { $oid: 'customer-1' }, title: 'Strato' },
      },
    ]);

    expect(options[0]?.options[0]).toEqual({
      label: 'MediaGen',
      value: '507f1f77bcf86cd799439012',
      title: 'Strato / Promo / MediaGen',
      searchLabel: 'Strato / Promo / MediaGen',
      hierarchyLabel: 'Strato / Promo',
    });
  });

  it('exposes normalized project identity tokens for hook-level parity', () => {
    const project = {
      _id: { $oid: '507f1f77bcf86cd799439012' },
      name: 'MediaGen',
    };

    expect(projectOptionValue(project)).toBe('507f1f77bcf86cd799439012');
    expect(projectIdentityTokens(project)).toEqual(['507f1f77bcf86cd799439012', 'mediagen']);
  });

  it('falls back to project name only when canonical id is absent', () => {
    const project = {
      name: 'MediaGen',
    };

    expect(projectIdentityTokens(project)).toEqual(['mediagen']);
  });

  it('renders unresolved project values with a neutral fallback instead of raw ids', () => {
    expect(projectSelectLabel('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439011')).toBe(
      UNNAMED_PROJECT_LABEL
    );
    expect(projectSelectLabel('Copilot', '507f1f77bcf86cd799439011')).toBe('Copilot');
  });

  it('resolves project names back to canonical ids for shared selector parity', () => {
    expect(
      resolveProjectSelectValue(
        [
          {
            _id: 'p1',
            name: 'Copilot',
            customerName: 'Strato',
            projectGroupName: 'Core',
          },
        ],
        'Copilot'
      )
    ).toBe('p1');
  });
});
