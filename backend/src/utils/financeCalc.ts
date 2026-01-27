export const roundRub = (value: number): number => Math.round(value);

export const calcRevenueTM = (billedHours: number, rateRubPerHour: number): number => {
  return roundRub(billedHours * rateRubPerHour);
};

export const calcRevenueFix = (amountOriginal: number, fx: number): number => {
  return roundRub(amountOriginal * fx);
};

export const calcCost = (billableHours: number, costRate: number): number => {
  return roundRub(billableHours * costRate);
};

export const calcMargin = (revenueRub: number, costRub: number): { marginRub: number; marginPct: number } => {
  const marginRub = revenueRub - costRub;
  if (revenueRub <= 0) {
    return { marginRub, marginPct: 0 };
  }
  return { marginRub, marginPct: marginRub / revenueRub };
};

export const calcOverrun = (actualHours: number, billableHours: number): number => {
  return actualHours - billableHours;
};
