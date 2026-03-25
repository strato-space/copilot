type SearchableOption = {
  label?: unknown;
  title?: unknown;
  searchLabel?: unknown;
};

const toSearchText = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const searchLabelFilterOption = (input: string, option?: SearchableOption): boolean => {
  const needle = toSearchText(input);
  if (!needle) return true;

  const haystack = [option?.searchLabel, option?.label, option?.title]
    .map(toSearchText)
    .filter(Boolean)
    .join(' ');

  return haystack.includes(needle);
};
