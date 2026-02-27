type PerformerLifecycleRecord = {
  is_deleted?: unknown;
  is_active?: unknown;
  active?: unknown;
};

export const isPerformerSelectable = (
  performer: PerformerLifecycleRecord | null | undefined
): boolean => {
  if (!performer) return false;
  if (performer.is_deleted === true) return false;
  if (performer.is_active === false) return false;
  if (performer.active === false) return false;
  return true;
};
