const roundRub = (value: number): number => Math.round(value);

const calcRevenueTM = (billedHours: number, rateRubPerHour: number): number => {
  return roundRub(billedHours * rateRubPerHour);
};

const calcRevenueFix = (amountOriginal: number, fx: number): number => {
  return roundRub(amountOriginal * fx);
};

const calcCost = (billableHours: number, costRate: number): number => {
  return roundRub(billableHours * costRate);
};

const calcMargin = (revenueRub: number, costRub: number): { marginRub: number; marginPct: number } => {
  const marginRub = revenueRub - costRub;
  if (revenueRub <= 0) {
    return { marginRub, marginPct: 0 };
  }
  return { marginRub, marginPct: marginRub / revenueRub };
};

const calcOverrun = (actualHours: number, billableHours: number): number => {
  return actualHours - billableHours;
};

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
