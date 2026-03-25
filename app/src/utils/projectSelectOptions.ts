export type ProjectOptionSource = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  title?: unknown;
  customerName?: unknown;
  projectGroupName?: unknown;
  project_group?: unknown;
  customer?: unknown;
};

type UnknownProjectGroupLike = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  title?: unknown;
  customer?: unknown;
};

type UnknownCustomerLike = {
  _id?: unknown;
  id?: unknown;
  name?: unknown;
  title?: unknown;
};

export type GroupedSelectOption = {
  label: string;
  title?: string;
  options: Array<{
    label: string;
    value: string;
    title?: string;
    searchLabel?: string;
    hierarchyLabel?: string;
  }>;
};

export const UNGROUPED_PROJECTS_LABEL = 'Без группы';
export const UNGROUPED_CUSTOMERS_LABEL = 'Без клиента';
export const UNNAMED_PROJECT_LABEL = 'Без названия';

const normalizeOptionalString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const uniqNormalizedTokens = (...values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

const looksLikeOpaqueId = (value: string): boolean => {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/\s/.test(normalized)) return false;
  if (/^[a-f0-9]{24}$/i.test(normalized)) return true;
  if (/^[a-f0-9-]{16,}$/i.test(normalized)) return true;
  if (/^[a-z]{1,4}-\d+(?:-\d+)*$/.test(normalized)) return true;
  if (/^[a-z]\d+$/.test(normalized)) return true;
  return false;
};

const sanitizeDisplayText = (value: unknown): string => {
  const normalized = normalizeOptionalString(value);
  if (!normalized || looksLikeOpaqueId(normalized)) return '';
  return normalized;
};

const normalizeIdLike = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  const record = value as {
    $oid?: unknown;
    oid?: unknown;
    toHexString?: (() => string) | unknown;
    _id?: unknown;
    id?: unknown;
  };

  if (typeof record.$oid === 'string') return record.$oid.trim();
  if (typeof record.oid === 'string') return record.oid.trim();
  if (typeof record.toHexString === 'function') {
    try {
      const hex = record.toHexString();
      if (typeof hex === 'string') return hex.trim();
    } catch {
      return '';
    }
  }

  return normalizeIdLike(record._id) || normalizeIdLike(record.id);
};

const readRelatedName = (value: unknown): string => {
  if (typeof value === 'string') return sanitizeDisplayText(value);
  if (!value || typeof value !== 'object') return '';
  const record = value as { name?: unknown; title?: unknown };
  return sanitizeDisplayText(record.name) || sanitizeDisplayText(record.title);
};

const readRelatedId = (value: unknown): string => {
  return normalizeIdLike(value);
};

const joinDistinctTextParts = (...parts: string[]): string => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = normalizeOptionalString(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result.join(' / ');
};

const projectHumanLabel = (project: ProjectOptionSource): string =>
  sanitizeDisplayText(project.name) || sanitizeDisplayText(project.title);

export const projectDisplayName = (project: ProjectOptionSource): string =>
  projectHumanLabel(project) || UNNAMED_PROJECT_LABEL;

export const projectOptionValue = (project: ProjectOptionSource): string =>
  normalizeIdLike(project._id) || normalizeIdLike(project.id);

export const projectIdentityTokens = (project: ProjectOptionSource): string[] => {
  return uniqNormalizedTokens(
    projectOptionValue(project),
    normalizeIdLike(project.id),
    projectHumanLabel(project),
    sanitizeDisplayText(project.name),
    sanitizeDisplayText(project.title),
    resolveCustomerName(project),
    resolveProjectGroupName(project),
    projectHierarchyLabel(project),
    projectSearchLabel(project)
  );
};

export const resolveProjectGroupName = (project: ProjectOptionSource): string =>
  sanitizeDisplayText(project.projectGroupName) || readRelatedName(project.project_group);

export const resolveCustomerName = (project: ProjectOptionSource): string =>
  sanitizeDisplayText(project.customerName) || readRelatedName(project.customer);

export const buildProjectHierarchyPath = (project: ProjectOptionSource): string[] => [
  resolveCustomerName(project) || UNGROUPED_CUSTOMERS_LABEL,
  resolveProjectGroupName(project) || UNGROUPED_PROJECTS_LABEL,
];

export const projectHierarchyLabel = (project: ProjectOptionSource): string => {
  const hierarchy = buildProjectHierarchyPath(project).join(' / ');
  return hierarchy === `${UNGROUPED_CUSTOMERS_LABEL} / ${UNGROUPED_PROJECTS_LABEL}` ? '' : hierarchy;
};

export const projectSearchLabel = (project: ProjectOptionSource): string =>
  joinDistinctTextParts(projectHierarchyLabel(project), projectDisplayName(project));

export const projectLookupTokens = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === 'string') {
    return uniqNormalizedTokens(value, sanitizeDisplayText(value));
  }
  if (typeof value !== 'object' || Array.isArray(value)) return [];

  const record = value as ProjectOptionSource;
  return uniqNormalizedTokens(
    normalizeIdLike(record._id),
    normalizeIdLike(record.id),
    sanitizeDisplayText(record.name),
    sanitizeDisplayText(record.title),
    sanitizeDisplayText(record.customerName),
    sanitizeDisplayText(record.projectGroupName),
    projectHierarchyLabel(record),
    projectSearchLabel(record)
  );
};

export const resolveProjectOption = (
  projectsLike: ProjectOptionSource[] | null | undefined,
  value: unknown
): ProjectOptionSource | null => {
  const projects = Array.isArray(projectsLike) ? projectsLike : [];
  const lookupTokens = new Set(projectLookupTokens(value));
  if (lookupTokens.size === 0) return null;

  for (const project of projects) {
    const projectValue = projectOptionValue(project);
    if (!projectValue) continue;
    if (lookupTokens.has(projectValue.trim().toLowerCase())) {
      return project;
    }
  }

  for (const project of projects) {
    if (projectIdentityTokens(project).some((token) => lookupTokens.has(token))) {
      return project;
    }
  }

  return null;
};

export const resolveProjectSelectValue = (
  projectsLike: ProjectOptionSource[] | null | undefined,
  value: unknown
): string | null => {
  const resolved = resolveProjectOption(projectsLike, value);
  return resolved ? projectOptionValue(resolved) || null : null;
};

export const projectSelectLabel = (label: unknown, value: unknown): string => {
  const labelText = normalizeOptionalString(label);
  const valueText = normalizeOptionalString(value);
  if (labelText && (!valueText || labelText !== valueText || !looksLikeOpaqueId(valueText))) {
    return labelText;
  }
  return UNNAMED_PROJECT_LABEL;
};

export const hydrateProjectsWithRelations = (
  projectsLike: ProjectOptionSource[] | null | undefined,
  projectGroupsLike: UnknownProjectGroupLike[] | null | undefined,
  customersLike: UnknownCustomerLike[] | null | undefined
): ProjectOptionSource[] => {
  const projects = Array.isArray(projectsLike) ? projectsLike : [];
  const projectGroups = Array.isArray(projectGroupsLike) ? projectGroupsLike : [];
  const customers = Array.isArray(customersLike) ? customersLike : [];

  return projects.map((project) => {
    const explicitProjectGroupName = resolveProjectGroupName(project);
    const explicitCustomerName = resolveCustomerName(project);
    if (explicitProjectGroupName && explicitCustomerName) return project;

    const projectGroupId = readRelatedId(project.project_group);
    const projectGroup =
      projectGroups.find((group) => readRelatedId(group) === projectGroupId) ?? null;
    const customerId = readRelatedId(projectGroup?.customer);
    const customer =
      customers.find((entry) => readRelatedId(entry) === customerId) ?? null;

    return {
      ...project,
      projectGroupName: explicitProjectGroupName || readRelatedName(projectGroup) || UNGROUPED_PROJECTS_LABEL,
      customerName: explicitCustomerName || readRelatedName(customer) || UNGROUPED_CUSTOMERS_LABEL,
    };
  });
};

export const buildGroupedProjectOptions = (
  projectsLike: ProjectOptionSource[] | null | undefined
): GroupedSelectOption[] => {
  const projects = Array.isArray(projectsLike) ? projectsLike : [];
  const grouped = new Map<string, ProjectOptionSource[]>();

  for (const project of projects) {
    const groupName = buildProjectHierarchyPath(project).join(' / ');
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName)?.push(project);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => {
      const leftIsUngrouped = left.startsWith(`${UNGROUPED_CUSTOMERS_LABEL} / ${UNGROUPED_PROJECTS_LABEL}`);
      const rightIsUngrouped = right.startsWith(`${UNGROUPED_CUSTOMERS_LABEL} / ${UNGROUPED_PROJECTS_LABEL}`);
      if (leftIsUngrouped !== rightIsUngrouped) return leftIsUngrouped ? -1 : 1;
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    })
    .map(([groupName, groupProjects]) => ({
      label: groupName,
      title: groupName,
      options: groupProjects
        .slice()
        .sort((left, right) =>
          projectDisplayName(left).localeCompare(projectDisplayName(right), undefined, { sensitivity: 'base' })
        )
        .map((project) => ({
          label: projectDisplayName(project),
          value: projectOptionValue(project),
          title: projectSearchLabel(project) || projectDisplayName(project),
          searchLabel: projectSearchLabel(project),
          hierarchyLabel: projectHierarchyLabel(project),
        })),
    }));
};
