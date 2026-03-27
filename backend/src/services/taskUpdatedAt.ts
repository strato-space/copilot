const SECONDS_TO_MILLISECONDS = 1000;
const EPOCH_MILLISECONDS_THRESHOLD = 1e12;
const PLAUSIBLE_OPERATIONAL_YEAR_MIN = 1990;
const PLAUSIBLE_OPERATIONAL_YEAR_MAX = 2100;

const isPlausibleOperationalEpochMs = (value: number): boolean => {
  const year = new Date(value).getUTCFullYear();
  return Number.isFinite(year) && year >= PLAUSIBLE_OPERATIONAL_YEAR_MIN && year <= PLAUSIBLE_OPERATIONAL_YEAR_MAX;
};

export const resolveDateLikeEpochMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    const dateMs = value.getTime();
    return Number.isFinite(dateMs) ? dateMs : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    if (Math.abs(normalized) >= EPOCH_MILLISECONDS_THRESHOLD) {
      return normalized;
    }

    const asMilliseconds = normalized;
    const asSeconds = normalized * SECONDS_TO_MILLISECONDS;
    const millisecondsPlausible = isPlausibleOperationalEpochMs(asMilliseconds);
    const secondsPlausible = isPlausibleOperationalEpochMs(asSeconds);

    if (secondsPlausible && !millisecondsPlausible) return asSeconds;
    if (millisecondsPlausible && !secondsPlausible) return asMilliseconds;
    return asMilliseconds;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return resolveDateLikeEpochMs(numeric);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const resolveMutationAnchorEpochMs = ({
  mutationEffectiveAt,
  serverNowUtc,
}: {
  mutationEffectiveAt?: unknown;
  serverNowUtc?: Date | undefined;
}): number => {
  const fallbackNow = serverNowUtc ?? new Date();
  return resolveDateLikeEpochMs(mutationEffectiveAt)
    ?? resolveDateLikeEpochMs(fallbackNow)
    ?? Date.now();
};

export const resolveMonotonicUpdatedAtNext = ({
  previousUpdatedAt,
  mutationEffectiveAt,
  serverNowUtc,
}: {
  previousUpdatedAt: unknown;
  mutationEffectiveAt?: unknown;
  serverNowUtc?: Date;
}): Date => {
  const previousEpochMs = resolveDateLikeEpochMs(previousUpdatedAt) ?? 0;
  const mutationEpochMs = resolveMutationAnchorEpochMs({ mutationEffectiveAt, serverNowUtc });
  return new Date(Math.max(previousEpochMs, mutationEpochMs));
};

export const buildMonotonicUpdatedAtBump = ({
  mutationEffectiveAt,
  serverNowUtc,
}: {
  mutationEffectiveAt?: unknown;
  serverNowUtc?: Date;
}): { $max: { updated_at: Date } } => {
  const mutationEpochMs = resolveMutationAnchorEpochMs({ mutationEffectiveAt, serverNowUtc });
  return {
    $max: {
      updated_at: new Date(mutationEpochMs),
    },
  };
};
