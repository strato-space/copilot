import { Button, Card, Tabs, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import PlanFactDrawer from '../components/PlanFactDrawer';
import PlanFactGrid from '../components/PlanFactGrid';
import ExpensesGrid, { type ExpensesGridHandle } from '../components/ExpensesGrid';
import PageHeader from '../components/PageHeader';
import { usePlanFactStore } from '../store/planFactStore';
import { type PlanFactCellContext, type PlanFactMonthCell } from '../services/types';
import { formatMonthLabel } from '../utils/format';
import { employeeDirectory } from '../services/employeeDirectory';

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
    setFocusMonth,
    setDateRange,
    setYear,
    fetchPlanFact,
    updateProjectMonth,
  } = usePlanFactStore();

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerContext, setDrawerContext] = useState<PlanFactCellContext | null>(null);
  const [activeTab, setActiveTab] = useState<'income' | 'expense'>('income');
  const expensesRef = useRef<ExpensesGridHandle | null>(null);

  const yearMonths = useMemo((): string[] => buildYearMonths(year), [year]);

  useEffect((): void => {
    void fetchPlanFact();
  }, [fetchPlanFact, year, usingMock]);

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
    setDrawerContext(context);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = (): void => {
    setDrawerOpen(false);
    setDrawerContext(null);
  };

  const handleApply = (context: PlanFactCellContext, values: PlanFactMonthCell): void => {
    updateProjectMonth(context.client_id, context.project_id, context.month, values);
    handleCloseDrawer();
    message.success('Изменения сохранены локально');
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
          <Button type="primary" loading={loading} onClick={(): void => void fetchPlanFact()}>
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
          onChange={(key): void => setActiveTab(key as 'income' | 'expense')}
          tabBarExtraContent={
            activeTab === 'expense' ? (
              <Button
                type="default"
                className="border border-slate-300 text-slate-900"
                onClick={(): void => expensesRef.current?.openAddExpense()}
              >
                + Расход
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
                  employees={employeeDirectory}
                  months={yearMonths}
                  focusMonth={focusMonth}
                  onFocusMonthChange={handleFocusMonthChange}
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
