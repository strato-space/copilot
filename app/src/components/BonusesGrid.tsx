import {
  AutoComplete,
  Button,
  Table,
  Tag,
} from 'antd';
import { FilterOutlined, PushpinFilled, PushpinOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement, TdHTMLAttributes } from 'react';
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { formatCurrency, formatMonthLabel } from '../utils/format';
import {
  type EmployeeDirectoryEntry,
  getEmployeeMonthlySalary,
} from '../services/employeeDirectory';
import {
  convertToRub,
  type ExpenseCategory,
  type ExpenseOperation,
} from '../services/expenseDirectory';
import { useExpensesStore } from '../store/expensesStore';
import { normalizePinnedMonths, togglePinnedMonth } from '../utils/pinnedMonths';

interface BonusMonthCell {
  amount: number;
}

interface BonusRow {
  key: string;
  typeLabel: string;
  name: string;
  role?: string;
  team?: string;
  months: Record<string, BonusMonthCell>;
  isFund?: boolean;
}

interface Props {
  employees: EmployeeDirectoryEntry[];
  months: string[];
  focusMonth: string;
  onFocusMonthChange: (month: string) => void;
  incomeTotals: Record<string, number>;
  isMonthClosed: (month: string) => boolean;
}

type SummaryCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  index: number;
  colSpan?: number;
  rowSpan?: number;
};

const SummaryCell = Table.Summary.Cell as unknown as (props: SummaryCellProps) => ReactElement;

const PIN_STORAGE_KEY = 'finopsPinnedBonusMonths';
const TYPE_COL_WIDTH = 96;
const NAME_COL_WIDTH = 240;
const ACTION_COL_WIDTH = 32;
const MONTH_COL_WIDTH = 112;

const BONUS_START_MONTH = '2026-02';

const roundToNearestHundred = (value: number): number => {
  return Math.round(value / 100) * 100;
};

const normalizeName = (value: string): string => value.trim().toLowerCase();

const targetEmployees = [
  { display: 'Юрий Кожевников', match: ['юрий кожевников'] },
  { display: 'Никита Ренье', match: ['никита ренье'] },
  { display: 'Антон Б.', match: ['антон бастрыкин', 'антон б.'] },
  { display: 'Валерий С.', match: ['валерий сысик', 'валерий с.'] },
];

const resolveEmployee = (
  employees: EmployeeDirectoryEntry[],
  aliases: string[],
): EmployeeDirectoryEntry | null => {
  const normalized = employees.map((employee) => ({
    employee,
    name: normalizeName(employee.name),
  }));
  for (const alias of aliases) {
    const matchedEmployeeEntry = normalized.find((entry) => entry.name.includes(alias));
    if (matchedEmployeeEntry) {
      return matchedEmployeeEntry.employee;
    }
  }
  return null;
};

const buildExpenseTotals = (
  employees: EmployeeDirectoryEntry[],
  categories: ExpenseCategory[],
  operations: ExpenseOperation[],
  months: string[],
  fxRatesByMonth: Record<string, number>,
): Record<string, number> => {
  const totals: Record<string, number> = {};
  months.forEach((month) => {
    totals[month] = 0;
  });

  employees.forEach((employee) => {
    months.forEach((month) => {
      totals[month] = (totals[month] ?? 0) + getEmployeeMonthlySalary(employee, month);
    });
  });

  categories
    .filter((category) => category.is_active || operations.some((op) => op.category_id === category.id))
    .forEach((category) => {
      months.forEach((month) => {
        const monthOps = operations.filter(
          (operation) => operation.category_id === category.id && operation.month === month,
        );
        const amount = monthOps.reduce((sum, op) => sum + convertToRub(op, fxRatesByMonth[month] ?? 0), 0);
        totals[month] = (totals[month] ?? 0) + amount;
      });
    });

  return totals;
};

const buildBonusRows = (
  employees: EmployeeDirectoryEntry[],
  months: string[],
  incomeTotals: Record<string, number>,
  expenseTotals: Record<string, number>,
  isMonthClosed: (month: string) => boolean,
): BonusRow[] => {
  const resolvedEmployees = targetEmployees.map((target) => ({
    target,
    employee: resolveEmployee(employees, target.match),
  }));

  const fundByMonth: Record<string, number> = {};
  const baseByMonth: Record<string, number> = {};

  months.forEach((month) => {
    if (month >= BONUS_START_MONTH) {
      const income = incomeTotals[month] ?? 0;
      const expense = expenseTotals[month] ?? 0;
      if (isMonthClosed(month) && income > 0) {
        const fund = 0.1 * (income - expense);
        fundByMonth[month] = fund;
        baseByMonth[month] = income - expense - fund;
      } else {
        fundByMonth[month] = 0;
        baseByMonth[month] = 0;
      }
    } else {
      fundByMonth[month] = 0;
      baseByMonth[month] = 0;
    }
  });

  const percentMap: Record<string, number> = {
    'Антон Б.': 0.1,
    'Никита Ренье': 0.23,
    'Валерий С.': 0.08,
  };

  const rows: BonusRow[] = resolvedEmployees.map(({ target, employee }) => {
    const monthsData: Record<string, BonusMonthCell> = {};
    months.forEach((month) => {
      if (month < BONUS_START_MONTH) {
        monthsData[month] = {
          amount: employee ? getEmployeeMonthlySalary(employee, month) : 0,
        };
        return;
      }
      if (!isMonthClosed(month) || (incomeTotals[month] ?? 0) <= 0) {
        monthsData[month] = { amount: 0 };
        return;
      }
      const base = baseByMonth[month] ?? 0;
      const percent = percentMap[target.display];
      if (typeof percent === 'number') {
        monthsData[month] = { amount: roundToNearestHundred(base * percent) };
      } else {
        const allocated =
          roundToNearestHundred(base * 0.1) +
          roundToNearestHundred(base * 0.23) +
          roundToNearestHundred(base * 0.08);
        monthsData[month] = { amount: roundToNearestHundred(base - allocated) };
      }
    });

    return {
      key: `bonus-${target.display}`,
      typeLabel: 'Бонус',
      name: target.display,
      ...(employee?.role ? { role: employee.role } : {}),
      ...(employee?.team ? { team: employee.team } : {}),
      months: monthsData,
    };
  });

  const fundRow: BonusRow = {
    key: 'bonus-fund',
    typeLabel: 'Фонд',
    name: 'Фонд',
    months: months.reduce<Record<string, BonusMonthCell>>((acc, month) => {
      acc[month] = {
        amount:
          month >= BONUS_START_MONTH && isMonthClosed(month) && (incomeTotals[month] ?? 0) > 0
            ? roundToNearestHundred(fundByMonth[month] ?? 0)
            : 0,
      };
      return acc;
    }, {}),
    isFund: true,
  };

  return [...rows, fundRow];
};

const BonusesGrid = ({
  employees,
  months,
  focusMonth,
  onFocusMonthChange,
  incomeTotals,
  isMonthClosed,
}: Props): ReactElement => {
  const [searchValue, setSearchValue] = useState<string>('');
  const [pinnedMonths, setPinnedMonths] = useState<string[]>(() => {
    if (typeof window === 'undefined') {
      return [focusMonth];
    }
    try {
      const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
      if (!raw) {
        return [focusMonth];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.filter((value): value is string => typeof value === 'string');
        return sanitized.length > 0 ? sanitized : [focusMonth];
      }
    } catch {
      return [focusMonth];
    }
    return [focusMonth];
  });

  const categories = useExpensesStore((state) => state.categories);
  const operations = useExpensesStore((state) => state.operations);
  const fxRatesByMonth = useExpensesStore((state) => state.fxRatesByMonth);

  const expenseTotals = useMemo(
    () => buildExpenseTotals(employees, categories, operations, months, fxRatesByMonth),
    [employees, categories, operations, months, fxRatesByMonth],
  );

  const rows = useMemo(
    () => buildBonusRows(employees, months, incomeTotals, expenseTotals, isMonthClosed),
    [employees, months, incomeTotals, expenseTotals, isMonthClosed],
  );

  const filteredRows = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) => row.name.toLowerCase().includes(query));
  }, [rows, searchValue]);

  useEffect((): void => {
    setPinnedMonths((prev) => normalizePinnedMonths(prev, months, focusMonth));
  }, [focusMonth, months]);

  useEffect((): void => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedMonths));
  }, [pinnedMonths]);

  const handleTogglePin = (month: string): void => {
    setPinnedMonths((prev) => togglePinnedMonth(prev, month, focusMonth));
  };

  const autoCompleteOptions = useMemo(
    () => [
      {
        label: 'Бонусы',
        options: rows.map((row) => ({ value: row.name })),
      },
    ],
    [rows],
  );

  const pinnedSet = new Set(pinnedMonths);
  const orderedMonths = [
    ...months.filter((month) => pinnedSet.has(month)),
    ...months.filter((month) => !pinnedSet.has(month)),
  ];

  const baseColumns: ColumnsType<BonusRow> = [
    {
      title: 'Тип',
      dataIndex: 'typeLabel',
      key: 'type',
      width: TYPE_COL_WIDTH,
      fixed: 'left',
      render: (value: string, row: BonusRow): ReactElement => (
        <Tag color={row.isFund ? 'volcano' : 'blue'} className="text-xs">
          {value}
        </Tag>
      ),
    },
    {
      title: 'Вид',
      dataIndex: 'name',
      key: 'name',
      filteredValue: searchValue ? [searchValue] : null,
      filterIcon: (filtered: boolean): ReactElement => (
        <FilterOutlined className={filtered ? 'text-blue-600' : 'text-slate-400'} />
      ),
      filterDropdown: ({ confirm, clearFilters }): ReactElement => (
        <div className="ant-table-filter-dropdown" style={{ width: 320 }}>
          <div className="ant-table-filter-dropdown-search">
            <AutoComplete
              style={{ width: '100%' }}
              options={autoCompleteOptions}
              placeholder="Поиск"
              value={searchValue}
              onSearch={setSearchValue}
              onSelect={(value): void => {
                setSearchValue(value);
                confirm({ closeDropdown: true });
              }}
              allowClear
              onClear={(): void => {
                setSearchValue('');
                clearFilters?.();
              }}
            />
          </div>
          <div className="ant-table-filter-dropdown-btns">
            <Button
              size="small"
              onClick={(): void => {
                setSearchValue('');
                clearFilters?.();
                confirm({ closeDropdown: true });
              }}
            >
              Сброс
            </Button>
            <Button type="primary" size="small" onClick={(): void => confirm({ closeDropdown: true })}>
              ОК
            </Button>
          </div>
        </div>
      ),
      width: NAME_COL_WIDTH,
      fixed: 'left',
      render: (_: string, row: BonusRow): ReactElement => (
        <div>
          <div className="text-sm font-semibold text-slate-900">{row.name}</div>
          {row.isFund ? (
            <div className="text-xs text-slate-500">Итого по фонду</div>
          ) : (
            <div className="text-xs text-slate-500">{row.team} • {row.role}</div>
          )}
        </div>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: ACTION_COL_WIDTH,
      fixed: 'left',
      className: 'finops-actions-col',
      onHeaderCell: (): { className: string } => ({ className: 'finops-actions-col' }),
      render: (): ReactElement => <span className="inline-block w-6" />,
    },
  ];

  const monthColumns: ColumnsType<BonusRow> = orderedMonths.map((month) => {
    const isPinned = pinnedSet.has(month);
    const isHighlighted = isPinned || month === focusMonth;
    const focusClass = isHighlighted ? 'finops-focus-left finops-focus-right' : '';
    const fixedProps = isPinned ? { fixed: 'left' as const } : {};
    return {
      title: (
        <div className={`finops-month-header ${isPinned ? 'is-pinned' : ''}`}>
          <button
            type="button"
            onClick={(): void => onFocusMonthChange(month)}
            className="finops-month-button finops-month-label text-slate-700 bg-transparent border-0 p-0 m-0 shadow-none rounded-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          >
            <span className="font-semibold">{formatMonthLabel(month)}</span>
          </button>
          <button
            type="button"
            onClick={(): void => handleTogglePin(month)}
            aria-label={isPinned ? 'Снять закрепление' : 'Закрепить месяц'}
            className="finops-pin-button"
          >
            {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </div>
      ),
      key: month,
      width: MONTH_COL_WIDTH,
      className: focusClass,
      onHeaderCell: (): { className: string } => ({ className: focusClass }),
      align: 'center' as const,
      ...fixedProps,
      render: (_: unknown, row: BonusRow): ReactElement => {
        const cell = row.months[month] ?? { amount: 0 };
        const hasValue = cell.amount !== 0;
        return (
          <div className="finops-cell-text px-2">
            <div className={hasValue ? 'text-[10px] font-semibold text-slate-900' : 'text-[10px] font-semibold text-slate-400'}>
              {hasValue ? formatCurrency(cell.amount) : '—'}
            </div>
          </div>
        );
      },
    };
  });

  return (
    <Table
      rowKey="key"
      columns={[...baseColumns, ...monthColumns]}
      dataSource={filteredRows}
      pagination={false}
      size="middle"
      scroll={{ x: 1200, y: 560 }}
      sticky
      summary={(pageData): ReactElement => {
        const fundRow = pageData.find((row) => row.isFund);
        if (!fundRow) {
          return <Table.Summary fixed />;
        }
        return (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <SummaryCell index={0} colSpan={3}>
                <strong className="text-sm">Фонд</strong>
              </SummaryCell>
              {orderedMonths.map((month, index) => {
                const amount = fundRow.months[month]?.amount ?? 0;
                return (
                  <SummaryCell key={month} index={index + 1}>
                    <div className="text-[10px] font-semibold text-slate-900">
                      {amount ? formatCurrency(amount) : '—'}
                    </div>
                  </SummaryCell>
                );
              })}
            </Table.Summary.Row>
          </Table.Summary>
        );
      }}
    />
  );
};

export default BonusesGrid;
