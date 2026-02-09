import { InfoCircleOutlined } from '@ant-design/icons';
import { Card, Col, Row, Statistic, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import { type ReactElement, type ReactNode } from 'react';
import {
  convertToRub,
} from '../services/expenseDirectory';
import { type ExpenseOperation } from '../services/expenseDirectory';
import { type EmployeeDirectoryEntry, getEmployeeMonthlySalary } from '../services/employeeDirectory';
import { type PlanFactClientRow, type PlanFactGridResponse } from '../services/types';
import { useFxStore } from '../store/fxStore';
import { useEmployeeStore } from '../store/employeeStore';
import { useExpensesStore } from '../store/expensesStore';
import { formatCurrency, formatHours, formatNumber } from '../utils/format';

interface Props {
  data: PlanFactGridResponse | null;
  months: string[];
}

interface KpiCardProps {
  title: string;
  tooltip: string;
  value: number;
  formatter: (value: number) => string;
  valueColor?: string;
  lines: ReactNode[];
}

const formatPercent = (value: number): string => `${formatNumber(Math.round(value))}%`;

const formatSignedPercent = (value: number): string => {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatPercent(Math.abs(value))}`;
};

const formatSignedCurrency = (value: number): string => {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatCurrency(Math.abs(value))}`;
};

const formatCurrencyPerHour = (value: number): string =>
  formatCurrency(Math.round(value)).replace(' ₽', ' ₽/ч');

const formatRatio = (value: number): string => `${value.toFixed(2).replace('.', ',')}×`;

const SecondaryText = ({ children, tone }: { children: ReactNode; tone?: 'positive' | 'negative' }): ReactElement => {
  const toneClass = tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-red-600' : 'text-slate-500';
  return (
    <Typography.Text className={`text-xs ${toneClass}`}>{children}</Typography.Text>
  );
};

const KpiTitle = ({ title, tooltip }: { title: string; tooltip: string }): ReactElement => (
  <Typography.Text type="secondary" className="text-xs flex flex-wrap items-center gap-1 leading-tight">
    {title}
    <Tooltip title={tooltip}>
      <InfoCircleOutlined className="text-[12px] text-slate-400" />
    </Tooltip>
  </Typography.Text>
);

const KpiCard = ({ title, tooltip, value, formatter, valueColor, lines }: KpiCardProps): ReactElement => (
  <Card className="min-h-[120px]" bodyStyle={{ padding: '10px 16px 12px' }}>
    <div className="flex min-h-[96px] min-w-0 flex-col gap-1">
      <KpiTitle title={title} tooltip={tooltip} />
      <Statistic
        value={value}
        formatter={(val: string | number): string => formatter(Number(val))}
        {...(valueColor ? { valueStyle: { color: valueColor } } : {})}
      />
      <div className="flex flex-col gap-1">
        {lines.map((line, index) => (
          <div key={`${title}-line-${index}`} className="min-w-0 break-words">
            {line}
          </div>
        ))}
      </div>
    </div>
  </Card>
);

const renderSecondary = (content: ReactNode, tone?: 'positive' | 'negative'): ReactElement => (
  <SecondaryText {...(tone ? { tone } : {})}>{content}</SecondaryText>
);

const sumRevenueByMonths = (
  data: PlanFactGridResponse | null,
  months: string[],
  fxRates: Record<string, { rate: number; base: number } | undefined>,
): { fact: number; forecast: number } => {
  if (!data || months.length === 0) {
    return { fact: 0, forecast: 0 };
  }
  let fact = 0;
  let forecast = 0;
  const getFxFactor = (month: string): number => {
    const fx = fxRates[month];
    return fx?.base ? fx.rate / fx.base : 1;
  };
  data.clients.forEach((client: PlanFactClientRow): void => {
    months.forEach((month) => {
      const cell = client.totals_by_month[month];
      if (!cell) {
        return;
      }
      const fxFactor = getFxFactor(month);
      fact += cell.fact_rub * fxFactor;
      forecast += cell.forecast_rub * fxFactor;
    });
  });
  return { fact, forecast };
};

const sumHoursByMonths = (data: PlanFactGridResponse | null, months: string[]): { fact: number; forecast: number } => {
  if (!data || months.length === 0) {
    return { fact: 0, forecast: 0 };
  }
  let fact = 0;
  let forecast = 0;
  data.clients.forEach((client) => {
    months.forEach((month) => {
      const cell = client.totals_by_month[month];
      if (!cell) {
        return;
      }
      fact += cell.fact_hours;
      forecast += cell.forecast_hours;
    });
  });
  return { fact, forecast };
};

const buildExpenseTotals = (
  months: string[],
  fxRates: Record<string, { rate: number; base: number } | undefined>,
  employees: EmployeeDirectoryEntry[],
  operations: ExpenseOperation[],
  fxRatesByMonth: Record<string, number>,
): { fact: number; forecast: number; payroll: number; other: number } => {
  if (months.length === 0) {
    return { fact: 0, forecast: 0, payroll: 0, other: 0 };
  }
  const payroll = months.reduce((sum, month) => {
    const monthPayroll = employees.reduce((acc, employee) => acc + getEmployeeMonthlySalary(employee, month), 0);
    return sum + monthPayroll;
  }, 0);
  const other = operations.reduce((sum, operation) => {
    if (!months.includes(operation.month)) {
      return sum;
    }
    const fallbackFx = fxRates[operation.month]?.rate ?? fxRatesByMonth[operation.month] ?? 0;
    return sum + convertToRub(operation, fallbackFx);
  }, 0);
  const fact = payroll + other;
  return { fact, forecast: fact, payroll, other };
};

export default function KpiCards({ data, months }: Props): ReactElement {
  const fxRates = useFxStore((state) => state.rates);
  const employees = useEmployeeStore((state) => state.employees);
  const expenseOperations = useExpensesStore((state) => state.operations);
  const fxRatesByMonth = useExpensesStore((state) => state.fxRatesByMonth);

  const revenueTotals = sumRevenueByMonths(data, months, fxRates);
  const revenueFact = revenueTotals.fact;
  const revenueForecast = revenueTotals.forecast;

  const expenseTotals = buildExpenseTotals(months, fxRates, employees, expenseOperations, fxRatesByMonth);
  const expenseFact = expenseTotals.fact;
  const expenseForecast = expenseTotals.forecast;

  const marginFact = revenueFact - expenseFact;
  const marginForecast = revenueForecast - expenseForecast;
  const marginPct = revenueFact ? (marginFact / revenueFact) * 100 : null;
  const marginPctForecast = revenueForecast ? (marginForecast / revenueForecast) * 100 : null;
  const marginPctValue = marginPct ?? 0;
  const marginPctColor = marginPct === null ? undefined : marginPct >= 0 ? '#16a34a' : '#dc2626';

  const hoursTotals = sumHoursByMonths(data, months);
  const hoursFact = hoursTotals.fact;
  const hoursForecast = hoursTotals.forecast;

  const singleMonth = months.length === 1 ? months[0] : null;
  const prevMonth = singleMonth ? dayjs(`${singleMonth}-01`).subtract(1, 'month').format('YYYY-MM') : null;
  const prevRevenue = prevMonth ? sumRevenueByMonths(data, [prevMonth], fxRates).fact : 0;
  const prevExpense = prevMonth
    ? buildExpenseTotals([prevMonth], fxRates, employees, expenseOperations, fxRatesByMonth).fact
    : 0;
  const prevProfit = prevRevenue - prevExpense;

  const revenueDelta = revenueFact - revenueForecast;
  const revenueDeltaPct = revenueForecast ? (revenueDelta / revenueForecast) * 100 : null;

  const expenseMoM = prevExpense ? ((expenseFact - prevExpense) / prevExpense) * 100 : null;
  const profitMoM = prevMonth ? marginFact - prevProfit : null;

  const billableHours = hoursFact;
  const crmHours = hoursFact;
  const overspendHours = crmHours - billableHours;
  const coverageRatio = billableHours && crmHours ? billableHours / crmHours : null;
  const savingsHours = billableHours - crmHours;
  const profitPerHour = billableHours ? marginFact / billableHours : null;
  const profitPerHourColor = profitPerHour === null ? undefined : profitPerHour >= 0 ? '#16a34a' : '#dc2626';

  const coverageStatus = coverageRatio === null
    ? 'нет данных'
    : coverageRatio >= 1
      ? 'в плюс'
      : 'перерасход';

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Выручка, факт"
          tooltip="Выручка факт — сумма выставленных клиенту счетов за период. Прогноз — значение из активной версии прогноза."
          value={revenueFact}
          formatter={formatCurrency}
          lines={[
            renderSecondary(`Прогноз: ${formatCurrency(revenueForecast)}`),
            renderSecondary(
              `Δ к прогнозу: ${revenueDeltaPct === null ? '—' : `${formatSignedCurrency(revenueDelta)} (${formatSignedPercent(revenueDeltaPct)})`}`,
              revenueDelta > 0 ? 'positive' : revenueDelta < 0 ? 'negative' : undefined,
            ),
          ]}
        />
      </Col>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Затраты, всего"
          tooltip="Затраты всего = зарплаты + прочие расходы за период. Общие прочие расходы входят в общую прибыль, но в MVP не распределяются по проектам."
          value={expenseFact}
          formatter={formatCurrency}
          lines={[
            renderSecondary(`Зарплаты: ${formatCurrency(expenseTotals.payroll)} • Прочие: ${formatCurrency(expenseTotals.other)}`),
            renderSecondary(
              singleMonth
                ? `к прошлому месяцу: ${expenseMoM === null ? '—' : formatSignedPercent(expenseMoM)}`
                : `За период: ${months.length} мес.`,
              expenseMoM !== null && expenseMoM !== 0 ? (expenseMoM > 0 ? 'negative' : 'positive') : undefined,
            ),
          ]}
        />
      </Col>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Прибыль, факт"
          tooltip="Операционная прибыль = Выручка факт − (Зарплаты + Прочие расходы). Это показатель прибыльности бизнеса за период."
          value={marginFact}
          valueColor={marginFact >= 0 ? '#16a34a' : '#dc2626'}
          formatter={formatCurrency}
          lines={[
            renderSecondary(`Маржа: ${marginPct === null ? '—' : formatPercent(marginPct)} • ${formatCurrency(marginFact)}`),
            renderSecondary(
              singleMonth
                ? `к прошлому месяцу: ${profitMoM === null ? '—' : formatSignedCurrency(profitMoM)}`
                : `За период: ${months.length} мес.`,
              profitMoM !== null && profitMoM !== 0 ? (profitMoM > 0 ? 'positive' : 'negative') : undefined,
            ),
          ]}
        />
      </Col>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Маржа, факт"
          tooltip="Маржа = Прибыль / Выручка. В % показывает долю прибыли в выручке. В ₽ — абсолютная прибыль."
          value={marginPctValue}
          {...(marginPctColor ? { valueColor: marginPctColor } : {})}
          formatter={(value: number): string => (marginPct === null ? '—' : formatPercent(value))}
          lines={[
            renderSecondary(`Маржа: ${formatCurrency(marginFact)}`),
            renderSecondary(`Прогноз: ${marginPctForecast === null ? '—' : formatPercent(marginPctForecast)}`),
          ]}
        />
      </Col>

      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Часы к биллингу, факт"
          tooltip="Часы к биллингу — часы, которые вы выставляете клиенту. В MVP берём факт‑часы из финтаблицы."
          value={billableHours}
          formatter={formatHours}
          lines={[
            renderSecondary(`Прогноз: ${formatHours(hoursForecast)}`),
            renderSecondary(`Период: ${months.length} мес.`),
          ]}
        />
      </Col>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Часы затрачено, billable"
          tooltip="Billable — часы, которые команда потратила на проект и считает биллабл (CRM). Actual — все часы. Перерасход = Actual − Billable. В MVP берём факт‑часы из финтаблицы, пока нет CRM."
          value={crmHours}
          formatter={formatHours}
          lines={[
            renderSecondary(`Actual: ${formatHours(crmHours)}`),
            renderSecondary(
              `Перерасход: ${formatHours(Math.abs(overspendHours))}`,
              overspendHours > 0 ? 'negative' : undefined,
            ),
          ]}
        />
      </Col>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Покрытие часов"
          tooltip="Покрытие = проданные часы / затраченные (billable). Пример: продано 100ч, затрачено 52ч → покрытие 1.92×, экономия 48ч."
          value={coverageRatio ?? 0}
          formatter={(value: number): string => (coverageRatio === null ? '—' : formatRatio(value))}
          lines={[
            renderSecondary(`Экономия: ${formatHours(Math.abs(savingsHours))}`, savingsHours >= 0 ? 'positive' : 'negative'),
            renderSecondary(`Статус: ${coverageStatus}`),
          ]}
        />
      </Col>
      <Col xs={24} md={12} lg={6}>
        <KpiCard
          title="Маржа на час, факт"
          tooltip="Маржа на час = (Выручка факт − Затраты всего) / часы к биллингу. Показывает, сколько прибыли приносит 1 час."
          value={profitPerHour ?? 0}
          {...(profitPerHourColor ? { valueColor: profitPerHourColor } : {})}
          formatter={(value: number): string => (profitPerHour === null ? '—' : formatCurrencyPerHour(value))}
          lines={[
            renderSecondary(`Прибыль: ${formatCurrency(marginFact)}`),
            renderSecondary(`Часы: ${formatHours(billableHours)}`),
          ]}
        />
      </Col>
    </Row>
  );
}
