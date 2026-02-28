const DEFAULT_MAX_PINNED_MONTHS = 3;

export const normalizePinnedMonths = (
  previous: string[],
  availableMonths: string[],
  focusMonth: string,
  maxPinnedMonths = DEFAULT_MAX_PINNED_MONTHS,
): string[] => {
  let next = previous.filter((month) => availableMonths.includes(month));
  if (next.length === 0) {
    next = [focusMonth];
  }
  while (next.length > maxPinnedMonths) {
    next.shift();
  }
  return next;
};

export const togglePinnedMonth = (
  previous: string[],
  month: string,
  focusMonth: string,
  maxPinnedMonths = DEFAULT_MAX_PINNED_MONTHS,
): string[] => {
  if (previous.includes(month)) {
    return previous.filter((item) => item !== month);
  }

  const next = [...previous, month];
  if (!next.includes(focusMonth)) {
    next.push(focusMonth);
  }
  while (next.length > maxPinnedMonths) {
    next.shift();
  }
  return next;
};
