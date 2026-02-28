import { describe, expect, it } from '@jest/globals';

import {
  formatCurrency,
  formatDateLabel,
  formatHours,
  formatMonthLabel,
  formatNumber,
} from '../../src/utils/format';

describe('format utils', () => {
  it('formats currency with rounding and ruble suffix', () => {
    const formatted = formatCurrency(1_234_567.6);
    expect(formatted.endsWith(' ₽')).toBe(true);
    expect(formatted.replace(/[^\d]/g, '')).toBe('1234568');
  });

  it('formats plain numbers and hours labels', () => {
    expect(formatNumber(98_765.4).replace(/[^\d]/g, '')).toBe('98765');
    expect(formatHours(1_500).endsWith(' ч')).toBe(true);
    expect(formatHours(1_500).replace(/[^\d]/g, '')).toBe('1500');
  });

  it('formats month and date labels with explicit fallbacks', () => {
    expect(formatMonthLabel('2026-02')).toBe('01.02.26');
    expect(formatDateLabel(undefined)).toBe('—');
    expect(formatDateLabel('2026-03')).toBe('01.03.26');
    expect(formatDateLabel('2026-03-14')).toBe('14.03.26');
    expect(formatDateLabel('custom-label')).toBe('custom-label');
  });
});
