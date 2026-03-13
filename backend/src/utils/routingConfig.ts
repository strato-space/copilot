type RoutingProjectSource = {
  project_id: string;
  name: string | null;
  alias: string | null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const extractRoutingProjectSources = (item: Record<string, unknown>): RoutingProjectSource[] => {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  const deduped = new Map<string, RoutingProjectSource>();

  for (const source of sources) {
    const sourceRecord = toRecord(source);
    const projectRecord = toRecord(sourceRecord?.project);
    const projectId = normalizeText(projectRecord?.project_id);
    if (!projectId) continue;
    if (deduped.has(projectId)) continue;

    deduped.set(projectId, {
      project_id: projectId,
      name: normalizeText(projectRecord?.name),
      alias: normalizeText(projectRecord?.alias),
    });
  }

  return Array.from(deduped.values());
};
