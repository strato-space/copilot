import type { VoiceBotProject } from '../../types/voice';

export const UNGROUPED_PROJECTS_LABEL = 'Без группы';

const normalizeOptionalString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const projectDisplayName = (project: VoiceBotProject): string =>
  normalizeOptionalString(project.name) || normalizeOptionalString(project.title) || String(project._id || '');

export type ProjectSelectOptionGroup = {
  label: string;
  title: string;
  options: Array<{
    label: string;
    value: string;
  }>;
};

export const buildGroupedProjectOptions = (
  preparedProjects: VoiceBotProject[] | null | undefined
): ProjectSelectOptionGroup[] => {
  const projects = Array.isArray(preparedProjects) ? preparedProjects : [];
  const grouped = new Map<string, VoiceBotProject[]>();

  for (const project of projects) {
    const groupName = normalizeOptionalString(project.project_group?.name);
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName)?.push(project);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      if (!left && right) return -1;
      if (!right && left) return 1;
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    })
    .map(([groupName, groupProjects]) => ({
      label: groupName || UNGROUPED_PROJECTS_LABEL,
      title: groupName || UNGROUPED_PROJECTS_LABEL,
      options: groupProjects
        .slice()
        .sort((left, right) =>
          projectDisplayName(left).localeCompare(projectDisplayName(right), undefined, { sensitivity: 'base' })
        )
        .map((project) => ({
          label: projectDisplayName(project),
          value: String(project._id),
        })),
    }));
};
