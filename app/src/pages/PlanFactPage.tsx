import { Button, Card, Tabs, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import PlanFactDrawer from '../components/PlanFactDrawer';
import PlanFactGrid from '../components/PlanFactGrid';
import ExpensesGrid, { type ExpensesGridHandle } from '../components/ExpensesGrid';
import BonusesGrid from '../components/BonusesGrid';
import FundGrid from '../components/FundGrid';
import PageHeader from '../components/PageHeader';
import { usePlanFactStore } from '../store/planFactStore';
import { type PlanFactCellContext, type PlanFactMonthCell } from '../services/types';
import { formatMonthLabel } from '../utils/format';
import { useEmployeeStore } from '../store/employeeStore';
import { useNotificationStore } from '../store/notificationStore';
import { convertToRub } from '../services/expenseDirectory';
import { type EmployeeDirectoryEntry, getEmployeeMonthlySalary } from '../services/employeeDirectory';
import { useExpensesStore } from '../store/expensesStore';
import { useMonthCloseStore } from '../store/monthCloseStore';
import { apiClient } from '../services/api';

const buildYearMonths = (year: number): string[] => {
  const start = dayjs(`${year}-01-01`);
  return Array.from({ length: 12 }, (_, index): string =>
    start.add(index, 'month').format('YYYY-MM'),
  );
};

export default function PlanFactPage(): ReactElement {
  const {
    data,
    loading,
    error,
    focusMonth,
    dateRange,
    usingMock,
    year,
    forecastVersionId,
    setFocusMonth,
    setDateRange,
    setYear,
    fetchPlanFact,
    updateProjectMonth,
  } = usePlanFactStore();

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerContext, setDrawerContext] = useState<PlanFactCellContext | null>(null);
  const [activeTab, setActiveTab] = useState<'income' | 'expense' | 'bonus' | 'fund'>('income');
  const expensesRef = useRef<ExpensesGridHandle | null>(null);
  const triggerCheck = useNotificationStore((state) => state.triggerCheck);
  const employees = useEmployeeStore((state) => state.employees);
  const expenseCategories = useExpensesStore((state) => state.categories);
  const expenseOperations = useExpensesStore((state) => state.operations);
  const fxRatesByMonth = useExpensesStore((state) => state.fxRatesByMonth);
  const setExpenseCategories = useExpensesStore((state) => state.setCategories);
  const setExpenseOperations = useExpensesStore((state) => state.setOperations);
  const setFxRatesByMonth = useExpensesStore((state) => state.setFxRatesByMonth);
  const isMonthClosed = useMonthCloseStore((state) => state.isClosed);
  const closedMonths = useMonthCloseStore((state) => state.closedMonths);
  const setClosedMonths = useMonthCloseStore((state) => state.setClosedMonths);
  const setEmployees = useEmployeeStore((state) => state.setEmployees);

  const bonusNameAliases = useMemo(
    () => ['юрий кожевников', 'никита ренье', 'антон бастрыкин', 'антон б.', 'валерий сысик', 'валерий с.'],
    [],
  );
  const expenseEmployees = useMemo(() => {
    const normalize = (value: string): string => value.trim().toLowerCase();
    return employees.filter((employee) => {
      const name = normalize(employee.name);
      return !bonusNameAliases.some((alias) => name.includes(alias));
    });
  }, [employees, bonusNameAliases]);

  const yearMonths = useMemo((): string[] => buildYearMonths(year), [year]);

  const incomeTotals = useMemo((): Record<string, number> => {
    const totals: Record<string, number> = {};
    yearMonths.forEach((month) => {
      totals[month] = 0;
    });
    if (!data) {
      return totals;
    }
    data.clients.forEach((client) => {
      client.projects.forEach((project) => {
        yearMonths.forEach((month) => {
          const cell = project.months[month];
          if (!cell) {
            return;
          }
          const isFix = project.contract_type === 'Fix';
          const factRub = isFix ? Math.max(cell.fact_rub, cell.forecast_rub) : cell.fact_rub;
          totals[month] = (totals[month] ?? 0) + (factRub ?? 0);
        });
      });
    });
    return totals;
  }, [data, yearMonths]);

  const expenseTotals = useMemo((): Record<string, number> => {
    const totals: Record<string, number> = {};
    yearMonths.forEach((month) => {
      totals[month] = 0;
    });
    expenseEmployees.forEach((employee) => {
      yearMonths.forEach((month) => {
        totals[month] = (totals[month] ?? 0) + getEmployeeMonthlySalary(employee, month);
      });
    });
    expenseCategories
      .filter((category) => category.is_active || expenseOperations.some((op) => op.category_id === category.id))
      .forEach((category) => {
        yearMonths.forEach((month) => {
          const monthOps = expenseOperations.filter(
            (operation) => operation.category_id === category.id && operation.month === month,
          );
          const amount = monthOps.reduce((sum, op) => sum + convertToRub(op, fxRatesByMonth[month] ?? 0), 0);
          totals[month] = (totals[month] ?? 0) + amount;
        });
      });
    return totals;
  }, [expenseEmployees, yearMonths, expenseCategories, expenseOperations, fxRatesByMonth]);

  const fundDeltaByMonth = useMemo((): Record<string, number | undefined> => {
    const totals: Record<string, number | undefined> = {};
    yearMonths.forEach((month) => {
      // Fund delta is calculated only for the current actual month (Jan 2026).
      // If there are no фактические данные, we keep it empty ("—").
      if (month === '2026-01') {
        const income = incomeTotals[month] ?? 0;
        const expense = expenseTotals[month] ?? 0;
        const hasActuals = income !== 0 || expense !== 0;
        totals[month] = hasActuals ? 0.1 * (income - expense) : undefined;
        return;
      }
      totals[month] = undefined;
    });
    return totals;
  }, [expenseTotals, incomeTotals, yearMonths]);

  useEffect((): void => {
    void fetchPlanFact();
  }, [fetchPlanFact, year, usingMock]);

  useEffect((): void => {
    const from = yearMonths[0];
    const to = yearMonths[yearMonths.length - 1];
    if (!from || !to) {
      return;
    }

    const loadExpenses = async (): Promise<void> => {
      try {
        const [categoriesRes, operationsRes, fxRes, closuresRes, employeesRes] = await Promise.all([
          apiClient.get('/finops/expenses/categories'),
          apiClient.get('/finops/expenses/operations', { params: { from, to } }),
          apiClient.get('/finops/fx-rates', { params: { from, to } }),
          apiClient.get('/finops/month-closures', { params: { from, to } }),
          apiClient.get('/finops/employees', { params: { from, to } }),
        ]);

        const categories = (categoriesRes.data?.data ?? []).map((item: { category_id: string; name: string; is_active: boolean }) => ({
          id: item.category_id,
          name: item.name,
          is_active: item.is_active,
        }));
        setExpenseCategories(categories);

        const operations = (operationsRes.data?.data ?? []).map((item: {
          operation_id: string;
          category_id: string;
          month: string;
          amount: number;
          currency: 'RUB' | 'USD';
          fx_used?: number | null;
          vendor?: string | null;
          comment?: string | null;
          attachments?: string[];
        }) => ({
          id: item.operation_id,
          category_id: item.category_id,
          month: item.month,
          amount: item.amount,
          currency: item.currency,
          ...(typeof item.fx_used === 'number' ? { fx_used: item.fx_used } : {}),
          ...(item.vendor ? { vendor: item.vendor } : {}),
          ...(item.comment ? { comment: item.comment } : {}),
          ...(item.attachments ? { attachments: item.attachments } : {}),
        }));
        setExpenseOperations(operations);

        const fxRatesData = (fxRes.data?.data ?? []) as { month: string; rate: number }[];
        const fxRates = fxRatesData.reduce((acc, rate) => {
          acc[rate.month] = rate.rate;
          return acc;
        }, {} as Record<string, number>);
        setFxRatesByMonth(fxRates);

        const closures = (closuresRes.data?.data ?? []) as { month: string; is_closed: boolean }[];
        setClosedMonths(closures.filter((item) => item.is_closed).map((item) => item.month));

        const employees = (employeesRes.data?.data ?? []) as EmployeeDirectoryEntry[];
        setEmployees(employees);
      } catch {
        message.error('Не удалось загрузить данные по затратам');
      }
    };

    void loadExpenses();
  }, [setExpenseCategories, setExpenseOperations, setFxRatesByMonth, setClosedMonths, setEmployees, yearMonths]);

  const snapshotAgeHours = useMemo((): number | null => {
    if (!data?.snapshot_date) {
      return null;
    }
    const snapshotMoment = dayjs(data.snapshot_date);
    if (!snapshotMoment.isValid()) {
      return null;
    }
    return dayjs().diff(snapshotMoment, 'hour', true);
  }, [data?.snapshot_date]);

  const snapshotLabel = useMemo((): string => {
    if (!data?.snapshot_date) {
      return 'нет данных';
    }
    const snapshotMoment = dayjs(data.snapshot_date);
    if (!snapshotMoment.isValid()) {
      return 'нет данных';
    }
    return snapshotMoment.format('YYYY-MM-DD HH:mm');
  }, [data?.snapshot_date]);

  const rangeLabel = useMemo((): string => {
    const [start, end] = dateRange;
    if (!start || !end) {
      return formatMonthLabel(focusMonth);
    }
    return `${formatMonthLabel(start)} — ${formatMonthLabel(end)}`;
  }, [dateRange, focusMonth]);

  const isSnapshotStale = snapshotAgeHours !== null && snapshotAgeHours > 1;

  useEffect((): void => {
    const [rangeStart, rangeEnd] = dateRange;
    if (!rangeStart || !rangeEnd) {
      const start = dayjs(`${focusMonth}-01`);
      const end = start.add(2, 'month');
      setDateRange([start.format('YYYY-MM'), end.format('YYYY-MM')]);
      return;
    }
    if (rangeStart !== focusMonth) {
      const monthsCount = dayjs(`${rangeEnd}-01`).diff(dayjs(`${rangeStart}-01`), 'month') + 1;
      const start = dayjs(`${focusMonth}-01`);
      const end = start.add(Math.max(monthsCount - 1, 0), 'month');
      setDateRange([start.format('YYYY-MM'), end.format('YYYY-MM')]);
    }
  }, [focusMonth, dateRange, setDateRange]);

  const handleOpenDrawer = (context: PlanFactCellContext): void => {
    if (isMonthClosed(context.month)) {
      message.warning('Месяц закрыт — изменения недоступны. Откройте месяц в разделе «Бонусы».');
      return;
    }
    setDrawerContext(context);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = (): void => {
    setDrawerOpen(false);
    setDrawerContext(null);
  };

  const handleApply = (context: PlanFactCellContext, values: PlanFactMonthCell): void => {
    const mode = context.edit_mode ?? 'forecast';
    const payload = {
      project_id: context.project_id,
      month: context.month,
      mode,
      contract_type: context.contract_type,
      hours: mode === 'fact' ? values.fact_hours : values.forecast_hours,
      amount_rub: mode === 'fact' ? values.fact_rub : values.forecast_rub,
      comment: mode === 'fact' ? values.fact_comment : values.forecast_comment,
      forecast_version_id: mode === 'forecast' ? forecastVersionId : undefined,
    };
    void apiClient
      .put('/plan-fact/entry', payload)
      .then(() => {
        updateProjectMonth(context.client_id, context.project_id, context.month, values);
        handleCloseDrawer();
        message.success('Изменения сохранены');
      })
      .catch(() => {
        message.error('Не удалось сохранить изменения. Проверьте подключение к серверу.');
      });
  };

  const handleToggleMonthClosed = async (): Promise<void> => {
    const isClosed = isMonthClosed(focusMonth);
    const nextClosed = isClosed
      ? closedMonths.filter((item) => item !== focusMonth)
      : [...closedMonths, focusMonth];
    try {
      await apiClient.post('/finops/month-closures', {
        month: focusMonth,
        is_closed: !isClosed,
      });
      setClosedMonths(nextClosed);
    } catch {
      message.error('Не удалось изменить статус месяца');
    }
  };

  const handleFocusMonthChange = (month: string): void => {
    const start = dayjs(`${month}-01`);
    const monthsCount =
      dateRange[0] && dateRange[1]
        ? dayjs(`${dateRange[1]}-01`).diff(dayjs(`${dateRange[0]}-01`), 'month') + 1
        : 3;
    const end = start.add(Math.max(monthsCount - 1, 0), 'month');
    setDateRange([start.format('YYYY-MM'), end.format('YYYY-MM')]);
    setFocusMonth(month);
    setYear(start.year());
  };

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Финансы"
        description={
          <div className="flex flex-wrap items-center gap-2">
            <span>Период: {rangeLabel}</span>
            <span>•</span>
            <span>CRM snapshot: {snapshotLabel}</span>
            {snapshotAgeHours !== null && (
              <Tag color={isSnapshotStale ? 'red' : 'green'}>
                {isSnapshotStale ? 'Данные устарели' : `Обновлено ${snapshotAgeHours.toFixed(1)} ч назад`}
              </Tag>
            )}
            {usingMock && <Tag color="gold">Демо‑данные</Tag>}
          </div>
        }
        actions={
          <Button
            type="primary"
            loading={loading}
            onClick={(): void => {
              void fetchPlanFact().then(() => triggerCheck('refresh'));
            }}
          >
            Обновить
          </Button>
        }
      />

      {error && (
        <Typography.Text type="danger" className="block">
          Ошибка загрузки: {error}
        </Typography.Text>
      )}

      <Card className="finops-table-card">
        <Tabs
          activeKey={activeTab}
          onChange={(key): void => setActiveTab(key as 'income' | 'expense' | 'bonus' | 'fund')}
          tabBarExtraContent={
            activeTab === 'expense' ? (
              <Button
                type="default"
                className="border border-slate-300 text-slate-900"
                onClick={(): void => {
                  if (isMonthClosed(focusMonth)) {
                    message.warning('Месяц закрыт — изменения недоступны. Откройте месяц в разделе «Бонусы».');
                    return;
                  }
                  expensesRef.current?.openAddExpense();
                }}
              >
                + Расход
              </Button>
            ) : activeTab === 'bonus' ? (
              <Button
                type="default"
                className="border border-slate-300 text-slate-900"
                onClick={(): void => {
                  void handleToggleMonthClosed();
                }}
              >
                {isMonthClosed(focusMonth)
                  ? `Открыть ${formatMonthLabel(focusMonth)}`
                  : `Закрыть ${formatMonthLabel(focusMonth)}`}
              </Button>
            ) : null
          }
          items={[
            {
              key: 'income',
              label: 'Доход',
              children: (
                <PlanFactGrid
                  clients={data?.clients ?? []}
                  months={yearMonths}
                  focusMonth={focusMonth}
                  onFocusMonthChange={handleFocusMonthChange}
                  onOpenDrawer={handleOpenDrawer}
                />
              ),
            },
            {
              key: 'expense',
              label: 'Затраты',
              children: (
                <ExpensesGrid
                  ref={expensesRef}
                  employees={expenseEmployees}
                  months={yearMonths}
                  focusMonth={focusMonth}
                  onFocusMonthChange={handleFocusMonthChange}
                  isMonthClosed={isMonthClosed}
                />
              ),
            },
            {
              key: 'bonus',
              label: 'Бонусы',
              children: (
                <BonusesGrid
                  employees={employees}
                  months={yearMonths}
                  focusMonth={focusMonth}
                  onFocusMonthChange={handleFocusMonthChange}
                  incomeTotals={incomeTotals}
                  isMonthClosed={isMonthClosed}
                />
              ),
            },
            {
              key: 'fund',
              label: 'Фонд',
              children: (
                <FundGrid
                  months={yearMonths}
                  fundDeltaByMonth={fundDeltaByMonth}
                />
              ),
            },
          ]}
        />
      </Card>
      {activeTab === 'income' && (
        <PlanFactDrawer
          open={drawerOpen}
          context={drawerContext}
          onClose={handleCloseDrawer}
          onApply={handleApply}
        />
      )}
    </div>
  );
}
