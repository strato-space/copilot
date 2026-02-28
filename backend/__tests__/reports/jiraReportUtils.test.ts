import dayjs from 'dayjs';
import { describe, expect, it } from '@jest/globals';

import { buildDayKeys, ensureDayBuckets, indexesToA1, setWeekStartMonday } from '../../src/services/reports/jiraReportUtils.js';

describe('jiraReportUtils', () => {
  it('converts row/column indexes to A1 notation', () => {
    expect(indexesToA1(0, 0)).toBe('A1');
    expect(indexesToA1(0, 25)).toBe('Z1');
    expect(indexesToA1(0, 26)).toBe('AA1');
    expect(indexesToA1(4, 27)).toBe('AB5');
    expect(indexesToA1(-5, -2)).toBe('A1');
  });

  it('builds inclusive day keys between start and end dates', () => {
    const keys = buildDayKeys(dayjs('2026-02-01'), dayjs('2026-02-03'));
    expect(keys).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });

  it('initializes missing day buckets and keeps existing entries', () => {
    const prepared = ensureDayBuckets(
      {
        '2026-02-01': [{ hours: 2 }],
      },
      ['2026-02-01', '2026-02-02', '2026-02-03']
    );

    expect(prepared['2026-02-01']).toEqual([{ hours: 2 }]);
    expect(prepared['2026-02-02']).toEqual([]);
    expect(prepared['2026-02-03']).toEqual([]);
  });

  it('sets locale week start to Monday', () => {
    setWeekStartMonday(dayjs, 'en');
    const localeData = (dayjs as unknown as { Ls?: Record<string, { weekStart?: number }> }).Ls;
    expect(localeData?.en?.weekStart).toBe(1);
  });
});
