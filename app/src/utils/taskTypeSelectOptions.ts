type UnknownTaskTypeLike = {
  _id?: unknown;
  id?: unknown;
  key?: unknown;
  task_id?: unknown;
  name?: unknown;
  title?: unknown;
  supertype?: unknown;
  long_name?: unknown;
  path?: unknown;
  parent?: unknown;
  children?: unknown;
};

export type GroupedTaskTypeOption = {
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

export const UNNAMED_TASK_TYPE_LABEL = 'Без названия';

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
  const normalized = normalizeText(value);
  if (!normalized || looksLikeOpaqueId(normalized)) return '';
  return normalized;
};

const readRelatedTitle = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const record = value as { title?: unknown; name?: unknown };
  return sanitizeDisplayText(record.title) || sanitizeDisplayText(record.name);
};

const joinDistinctTextParts = (...parts: string[]): string => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const normalized = normalizeText(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result.join(' / ');
};

export const taskTypeOptionValue = (taskType: UnknownTaskTypeLike): string =>
  normalizeText(taskType._id) ||
  normalizeText(taskType.id) ||
  normalizeText(taskType.key) ||
  normalizeText(taskType.task_id);

const taskTypeCode = (taskType: UnknownTaskTypeLike): string =>
  normalizeText(taskType.task_id);

const taskTypeHumanTitle = (taskType: UnknownTaskTypeLike): string =>
  sanitizeDisplayText(taskType.name) ||
  sanitizeDisplayText(taskType.title) ||
  sanitizeDisplayText(taskType.long_name) ||
  sanitizeDisplayText(taskType.path);

export const taskTypeDisplayLabel = (taskType: UnknownTaskTypeLike): string =>
  joinDistinctTextParts(taskTypeCode(taskType), taskTypeHumanTitle(taskType)) ||
  taskTypeCode(taskType) ||
  taskTypeHumanTitle(taskType) ||
  UNNAMED_TASK_TYPE_LABEL;

export const taskTypeHierarchyLabel = (taskType: UnknownTaskTypeLike): string => {
  const primaryLabel = taskTypeDisplayLabel(taskType).toLowerCase();
  const hierarchyHint =
    sanitizeDisplayText(taskType.long_name) ||
    sanitizeDisplayText(taskType.path) ||
    sanitizeDisplayText(taskType.supertype);

  if (!hierarchyHint) return '';
  if (hierarchyHint.toLowerCase() === primaryLabel) return '';
  return hierarchyHint;
};

export const taskTypeSearchLabel = (taskType: UnknownTaskTypeLike): string =>
  taskTypeHierarchyLabel(taskType)
    ? joinDistinctTextParts(taskTypeHierarchyLabel(taskType), taskTypeDisplayLabel(taskType))
    : joinDistinctTextParts(
        taskTypeDisplayLabel(taskType),
        taskTypeCode(taskType),
        normalizeText(taskType.supertype)
      );

export const taskTypeIdentityTokens = (taskType: UnknownTaskTypeLike): string[] =>
  uniqNormalizedTokens(
    taskTypeOptionValue(taskType),
    taskTypeCode(taskType),
    taskTypeHumanTitle(taskType),
    sanitizeDisplayText(taskType.name),
    sanitizeDisplayText(taskType.title),
    sanitizeDisplayText(taskType.long_name),
    sanitizeDisplayText(taskType.path),
    sanitizeDisplayText(taskType.supertype),
    taskTypeDisplayLabel(taskType),
    taskTypeHierarchyLabel(taskType),
    taskTypeSearchLabel(taskType)
  );

export const taskTypeLookupTokens = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === 'string') {
    return uniqNormalizedTokens(value, sanitizeDisplayText(value));
  }
  if (typeof value !== 'object' || Array.isArray(value)) return [];

  const record = value as UnknownTaskTypeLike;
  return uniqNormalizedTokens(
    taskTypeOptionValue(record),
    normalizeText(record.task_id),
    sanitizeDisplayText(record.name),
    sanitizeDisplayText(record.title),
    sanitizeDisplayText(record.long_name),
    sanitizeDisplayText(record.path),
    sanitizeDisplayText(record.supertype)
  );
};

export const taskTypeSelectLabel = (label: unknown, value: unknown): string => {
  const labelText = normalizeText(label);
  const valueText = normalizeText(value);
  if (labelText && (!valueText || labelText !== valueText || !looksLikeOpaqueId(valueText))) {
    return labelText;
  }
  return UNNAMED_TASK_TYPE_LABEL;
};

const asTaskTypeArray = (value: unknown): UnknownTaskTypeLike[] =>
  Array.isArray(value) ? (value as UnknownTaskTypeLike[]) : [];

const flattenTaskTypes = (
  taskTypesLike: UnknownTaskTypeLike[] | null | undefined
): UnknownTaskTypeLike[] => {
  const taskTypes = Array.isArray(taskTypesLike) ? taskTypesLike : [];
  const flattened: UnknownTaskTypeLike[] = [];

  const walk = (nodes: UnknownTaskTypeLike[], inheritedGroup = '', inheritedPath = ''): void => {
    for (const node of nodes) {
      const nodeLabel =
        sanitizeDisplayText(node.name) ||
        sanitizeDisplayText(node.title) ||
        sanitizeDisplayText(node.long_name) ||
        sanitizeDisplayText(node.path) ||
        normalizeText(node.task_id);
      const ownPath = sanitizeDisplayText(node.path);
      const nextPath = ownPath || [inheritedPath, nodeLabel].filter(Boolean).join(' / ');
      const nextGroup = sanitizeDisplayText(node.supertype) || readRelatedTitle(node.parent) || inheritedGroup;
      const children = asTaskTypeArray(node.children);

      if (children.length > 0) {
        walk(children, nextGroup || nodeLabel, nextPath);
        continue;
      }

      flattened.push({
        ...node,
        supertype: nextGroup || 'Без группы',
        path: ownPath || nextPath,
        long_name: sanitizeDisplayText(node.long_name) || nextPath || nodeLabel,
      });
    }
  };

  walk(taskTypes);
  return flattened;
};

export const resolveTaskTypeOption = (
  taskTypesLike: UnknownTaskTypeLike[] | null | undefined,
  value: unknown
): UnknownTaskTypeLike | null => {
  const flattenedTaskTypes = flattenTaskTypes(taskTypesLike);
  const lookupTokens = new Set(taskTypeLookupTokens(value));
  if (lookupTokens.size === 0) return null;

  for (const taskType of flattenedTaskTypes) {
    const optionValue = taskTypeOptionValue(taskType);
    if (optionValue && lookupTokens.has(optionValue.trim().toLowerCase())) {
      return taskType;
    }
    const taskId = taskTypeCode(taskType);
    if (taskId && lookupTokens.has(taskId.trim().toLowerCase())) {
      return taskType;
    }
  }

  for (const taskType of flattenedTaskTypes) {
    if (taskTypeIdentityTokens(taskType).some((token) => lookupTokens.has(token))) {
      return taskType;
    }
  }

  return null;
};

export const resolveTaskTypeSelectValue = (
  taskTypesLike: UnknownTaskTypeLike[] | null | undefined,
  value: unknown
): string | null => {
  const resolved = resolveTaskTypeOption(taskTypesLike, value);
  return resolved ? taskTypeOptionValue(resolved) || null : null;
};

export const buildGroupedTaskTypeOptions = (
  taskTypesLike: UnknownTaskTypeLike[] | null | undefined
): GroupedTaskTypeOption[] => {
  const taskTypes = flattenTaskTypes(taskTypesLike);
  const grouped = new Map<string, UnknownTaskTypeLike[]>();

  for (const taskType of taskTypes) {
    const groupName = normalizeText(taskType.supertype) || 'Без группы';
    if (!grouped.has(groupName)) grouped.set(groupName, []);
    grouped.get(groupName)?.push(taskType);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .map(([groupName, groupTaskTypes]) => ({
      label: groupName,
      title: groupName,
      options: groupTaskTypes
        .slice()
        .sort((left, right) =>
          taskTypeDisplayLabel(left).localeCompare(taskTypeDisplayLabel(right), undefined, {
            sensitivity: 'base',
          }) ||
          taskTypeHierarchyLabel(left).localeCompare(taskTypeHierarchyLabel(right), undefined, {
            sensitivity: 'base',
          })
        )
        .map((taskType) => ({
          label: taskTypeDisplayLabel(taskType),
          value: taskTypeOptionValue(taskType),
          title: taskTypeSearchLabel(taskType) || taskTypeDisplayLabel(taskType),
          searchLabel: taskTypeSearchLabel(taskType),
          hierarchyLabel: taskTypeHierarchyLabel(taskType),
        })),
    }));
};
