import {
  calcCost,
  calcMargin,
  calcOverrun,
  calcRevenueFix,
  calcRevenueTM,
} from '../src/utils/financeCalc.js';

describe('financeCalc', () => {
  test('calcRevenueTM rounds to rubles', () => {
    expect(calcRevenueTM(10.25, 1000)).toBe(10250);
  });

  test('calcRevenueFix uses fx', () => {
    expect(calcRevenueFix(100, 95.5)).toBe(9550);
  });

  test('calcCost rounds to rubles', () => {
    expect(calcCost(12.5, 80)).toBe(1000);
  });

  test('calcMargin handles zero revenue', () => {
    expect(calcMargin(0, 100)).toEqual({ marginRub: -100, marginPct: 0 });
  });

  test('calcOverrun returns diff', () => {
    expect(calcOverrun(120, 100)).toBe(20);
  });
});
