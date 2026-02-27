type PerformerLifecycleRecord = {
  is_deleted?: unknown;
  is_active?: unknown;
  active?: unknown;
  corporate_email?: unknown;
  email?: unknown;
  name?: unknown;
  username?: unknown;
  telegram_username?: unknown;
  login?: unknown;
};

const HIDDEN_PERFORMER_EMAILS = new Set([
  'gatitulin@strato.space',
  'vilco@yandex.ru',
]);

const HIDDEN_PERFORMER_ALIASES = new Set([
  'd1zmens',
  'vilco_o',
]);

const toNormalizedText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const isHiddenPerformerFromActiveSelectors = (
  performer: PerformerLifecycleRecord | null | undefined
): boolean => {
  if (!performer) return false;

  const emailCandidates = [
    performer.corporate_email,
    performer.email,
  ];
  for (const emailValue of emailCandidates) {
    const normalizedEmail = toNormalizedText(emailValue);
    if (normalizedEmail && HIDDEN_PERFORMER_EMAILS.has(normalizedEmail)) {
      return true;
    }
  }

  const aliasCandidates = [
    performer.name,
    performer.username,
    performer.telegram_username,
    performer.login,
  ];
  for (const aliasValue of aliasCandidates) {
    const normalizedAlias = toNormalizedText(aliasValue);
    if (normalizedAlias && HIDDEN_PERFORMER_ALIASES.has(normalizedAlias)) {
      return true;
    }
  }

  return false;
};

export const isPerformerSelectable = (
  performer: PerformerLifecycleRecord | null | undefined
): boolean => {
  if (!performer) return false;
  if (performer.is_deleted === true) return false;
  if (performer.is_active === false) return false;
  if (performer.active === false) return false;
  if (isHiddenPerformerFromActiveSelectors(performer)) return false;
  return true;
};
