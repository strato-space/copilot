# FinOps Bonuses & Fund (spec)

Version: v1
Status: draft-for-implementation

## Goal
Add a new "Бонусы" tab (copy of "Затраты") with bonus/fund calculations, plus a "Фонд" tab (summary by months).

## Scope
Frontend only (uses existing data and calculations in UI). No backend changes.

## New Tabs
1) **Бонусы** (copy of "Затраты" UI/UX)
2) **Фонд** (summary by months; uses fund calculation only)

## Data Sources
- **Доход / Итого факт**: from current Income table totals (PlanFact).
- **Затраты / Итого**: from current Expenses totals (Zatraty).
- **Бонусы / Фонд**: computed in UI.

## "Бонусы" tab rules
### Rows (only these 5 rows)
1. Юрий Кожевников
2. Никита Ренье
3. Антон Б. (Антон Бастрыкин)
4. Валерий С. (Валерий Сысик)
5. Фонд (summary row after people)

### Calculation (per month)
> **Important:** Calculations start from **February 2026**.
> **January 2026** remains **current data as-is** (no bonus re-calculation).
1. **Fund** = 10% * (Income Total факт − Expense Total)
   - Fund can be negative.
2. **Base for bonuses** = Income Total факт − Expense Total − Fund
3. Bonuses:
   - Антон = 10% of Base
   - Никита = 23% of Base
   - Валерий = 8% of Base
   - Юрий = остаток Base (Base − Антон − Никита − Валерий)

### Display
- Show **amounts only** (no hours).
- "Фонд" shown as a **summary row after people**.

### Rounding
- Round each bonus value to **nearest 100 ₽**.
- If exactly between two hundreds, round **toward the person** (up).
  - Example: 12,350 → 12,400.

## "Фонд" tab rules
Show fund by months:
- Start from **Nov 2025 = 1,827,127 ₽**.
- Dec 2025 will be provided later. For now:
  - Dec 2025 = same base as Nov 2025 (temporary).
- From **Feb 2026** onward:
  - Use Fund formula from above.
- **Jan 2026** shows current data as-is.

## UI/UX
- "Бонусы" tab is visually identical to "Затраты".
- Keep existing filters and layout.
- Add new tab "Фонд" (placeholder table or simple list of months with fund).

## Acceptance Criteria
- "Бонусы" tab shows only 5 rows and correct monthly values.
- Fund row matches 10% formula.
- Bonus split matches percentages + residual rule for Юрий.
- Rounding matches nearest 100 rule.
- "Фонд" tab shows values from Nov 2025 onward.
