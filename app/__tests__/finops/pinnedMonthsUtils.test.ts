import fs from 'node:fs';
import path from 'node:path';

import { normalizePinnedMonths, togglePinnedMonth } from '../../src/utils/pinnedMonths';

describe('pinned months helpers', () => {
  it('normalizes months list, keeps focus fallback, and enforces max length', () => {
    expect(normalizePinnedMonths(['2026-01'], ['2026-02', '2026-03'], '2026-03')).toEqual(['2026-03']);
    expect(
      normalizePinnedMonths(
        ['2026-01', '2026-02', '2026-03', '2026-04'],
        ['2026-01', '2026-02', '2026-03', '2026-04'],
        '2026-04',
      )
    ).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it('toggles pinned month preserving focus pin and max length behavior', () => {
    expect(togglePinnedMonth(['2026-01', '2026-02'], '2026-02', '2026-01')).toEqual(['2026-01']);
    expect(togglePinnedMonth(['2026-01', '2026-02'], '2026-03', '2026-01')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(togglePinnedMonth(['2026-02', '2026-03', '2026-04'], '2026-05', '2026-01')).toEqual([
      '2026-04',
      '2026-05',
      '2026-01',
    ]);
  });
});

describe('pinned months dedupe wiring contract', () => {
  const planFactPath = path.resolve(process.cwd(), 'src/components/PlanFactGrid.tsx');
  const expensesPath = path.resolve(process.cwd(), 'src/components/ExpensesGrid.tsx');
  const bonusesPath = path.resolve(process.cwd(), 'src/components/BonusesGrid.tsx');
  const planFactSource = fs.readFileSync(planFactPath, 'utf8');
  const expensesSource = fs.readFileSync(expensesPath, 'utf8');
  const bonusesSource = fs.readFileSync(bonusesPath, 'utf8');

  it('uses shared pinned-month helpers in all finops grids', () => {
    const helperImport = "import { normalizePinnedMonths, togglePinnedMonth } from '../utils/pinnedMonths';";
    expect(planFactSource).toContain(helperImport);
    expect(expensesSource).toContain(helperImport);
    expect(bonusesSource).toContain(helperImport);

    expect(planFactSource).toContain('setPinnedMonths((prev) => normalizePinnedMonths(prev, months, focusMonth));');
    expect(expensesSource).toContain('setPinnedMonths((prev) => normalizePinnedMonths(prev, months, focusMonth));');
    expect(bonusesSource).toContain('setPinnedMonths((prev) => normalizePinnedMonths(prev, months, focusMonth));');

    expect(planFactSource).toContain('setPinnedMonths((prev) => togglePinnedMonth(prev, month, focusMonth));');
    expect(expensesSource).toContain('setPinnedMonths((prev) => togglePinnedMonth(prev, month, focusMonth));');
    expect(bonusesSource).toContain('setPinnedMonths((prev) => togglePinnedMonth(prev, month, focusMonth));');
  });
});
