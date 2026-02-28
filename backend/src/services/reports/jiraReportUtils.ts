import type dayjs from 'dayjs';

type DayjsDate = dayjs.Dayjs;

export const setWeekStartMonday = (
  dayjsModule: typeof dayjs,
  localeName = 'en'
): void => {
  dayjsModule.locale(localeName);
  const localeData = (dayjsModule as unknown as { Ls?: Record<string, { weekStart?: number }> }).Ls;
  if (localeData?.[localeName]) {
    localeData[localeName].weekStart = 1;
  }
};

export const indexesToA1 = (row: number, column: number): string => {
  let current = Math.max(0, Math.floor(column)) + 1;
  let label = '';

  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = `${String.fromCharCode(65 + remainder)}${label}`;
    current = Math.floor((current - 1) / 26);
  }

  return `${label}${Math.max(0, Math.floor(row)) + 1}`;
};

export const buildDayKeys = (start: DayjsDate, end: DayjsDate): string[] => {
  const result: string[] = [];
  let currentDate = start.clone();

  while (!currentDate.isAfter(end, 'day')) {
    result.push(currentDate.format('YYYY-MM-DD'));
    currentDate = currentDate.add(1, 'day');
  }

  return result;
};

export const ensureDayBuckets = <T>(
  buckets: Record<string, T[]> | undefined,
  dayKeys: string[]
): Record<string, T[]> => {
  const prepared = buckets && typeof buckets === 'object' ? { ...buckets } : {};
  for (const dayKey of dayKeys) {
    if (!Array.isArray(prepared[dayKey])) {
      prepared[dayKey] = [];
    }
  }
  return prepared;
};
