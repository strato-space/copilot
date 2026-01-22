import { Card, Col, DatePicker, Empty, List, Progress, Row, Select, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import KpiCards from '../components/KpiCards';
import PageHeader from '../components/PageHeader';
import { usePlanFactStore } from '../store/planFactStore';
import { formatCurrency, formatHours, formatMonthLabel } from '../utils/format';

interface AlertItem {
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

const alerts: AlertItem[] = [
  {
    title: 'Aurora Retail: перерасход часов',
    description: 'Факт превышает прогноз на 12% за январь.',
    severity: 'high',
  },
  {
    title: 'Northwind Labs: прогноз без ставки',
    description: 'Нет ставки T&M, требуется подтверждение.',
    severity: 'medium',
  },
  {
    title: 'Сегмент Fix: риск просадки маржи',
    description: 'Маржа в феврале может уйти ниже 20%.',
    severity: 'low',
  },
];

const severityColor: Record<AlertItem['severity'], string> = {
  high: 'red',
  medium: 'orange',
  low: 'green',
};

const buildRangeMonths = (startMonth: string, endMonth: string): string[] => {
  if (!startMonth || !endMonth) {
    return [];
  }
  const start = dayjs(`${startMonth}-01`);
  const end = dayjs(`${endMonth}-01`);
  if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
    return [];
  }
  const months: string[] = [];
  let cursor = start;
  while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
    months.push(cursor.format('YYYY-MM'));
    cursor = cursor.add(1, 'month');
  }
  return months;
};

export default function AnalyticsPage(): ReactElement {
  const { RangePicker } = DatePicker;
  const [pieMetric, setPieMetric] = useState<'rub' | 'hours'>('rub');
  const {
    focusMonth,
    forecastVersionId,
    data,
    dateRange,
    fetchPlanFact,
    setDateRange,
    setFocusMonth,
    setYear,
  } = usePlanFactStore();
  const focusMonths = useMemo(
    (): string[] => buildRangeMonths(dateRange[0], dateRange[1]),
    [dateRange],
  );
  const rangeValue = useMemo((): [Dayjs, Dayjs] | null => {
    const [start, end] = dateRange;
    if (!start || !end) {
      return null;
    }
    return [dayjs(`${start}-01`), dayjs(`${end}-01`)];
  }, [dateRange]);
  const rangeLabel = useMemo((): string => {
    const [start, end] = dateRange;
    if (!start || !end) {
      return formatMonthLabel(focusMonth);
    }
    return `${formatMonthLabel(start)} — ${formatMonthLabel(end)}`;
  }, [dateRange, focusMonth]);

  const pieData = useMemo((): { name: string; value: number }[] => {
    if (!data?.clients?.length) {
      return [];
    }
    const activeMonths = focusMonths.length > 0 ? focusMonths : [focusMonth];
    const totals = new Map<string, number>();
    data.clients.forEach((client) => {
      client.projects.forEach((project) => {
        let sum = 0;
        activeMonths.forEach((month) => {
          const cell = project.months[month];
          if (!cell) {
            return;
          }
          sum += pieMetric === 'rub' ? cell.forecast_rub : cell.forecast_hours;
        });
        if (sum > 0) {
          totals.set(project.project_name, (totals.get(project.project_name) ?? 0) + sum);
        }
      });
    });
    const sorted = Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 6) {
      return sorted;
    }
    const top = sorted.slice(0, 6);
    const othersValue = sorted.slice(6).reduce((acc, item) => acc + item.value, 0);
    if (othersValue > 0) {
      top.push({ name: 'Другие', value: othersValue });
    }
    return top;
  }, [data?.clients, focusMonths, focusMonth, pieMetric]);

  const pieTotal = useMemo(
    (): number => pieData.reduce((acc, item) => acc + item.value, 0),
    [pieData],
  );
  const pieColors = ['#1677ff', '#13c2c2', '#52c41a', '#fadb14', '#fa8c16', '#f5222d', '#722ed1', '#eb2f96'];
  const pieSegments = useMemo((): { color: string; percent: number; name: string; value: number }[] => {
    if (!pieTotal) {
      return [];
    }
    let acc = 0;
    return pieData.map((item, index) => {
      const percent = (item.value / pieTotal) * 100;
      acc += percent;
      return {
        color: pieColors[index % pieColors.length],
        percent,
        name: item.name,
        value: item.value,
      };
    });
  }, [pieData, pieTotal]);

  const pieGradient = useMemo((): string => {
    if (!pieTotal || pieSegments.length === 0) {
      return '#e2e8f0';
    }
    let start = 0;
    const parts = pieSegments.map((segment) => {
      const end = start + segment.percent;
      const slice = `${segment.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      start = end;
      return slice;
    });
    return `conic-gradient(${parts.join(', ')})`;
  }, [pieSegments, pieTotal]);

  const handleRangeChange = (value: [Dayjs | null, Dayjs | null] | null): void => {
    if (!value || !value[0] || !value[1]) {
      return;
    }
    const [start, end] = value;
    setDateRange([start.format('YYYY-MM'), end.format('YYYY-MM')]);
    setFocusMonth(start.format('YYYY-MM'));
    setYear(start.year());
  };

  const handlePieMetricChange = (value: 'rub' | 'hours'): void => {
    setPieMetric(value);
  };

  useEffect((): void => {
    void fetchPlanFact();
  }, [fetchPlanFact, focusMonth, forecastVersionId]);

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Аналитика"
        actions={
          <RangePicker
            picker="month"
            value={rangeValue}
            onChange={(value): void => handleRangeChange(value)}
            className="min-w-[220px]"
            allowClear={false}
          />
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <Typography.Text type="secondary">Рекомендуемое действие</Typography.Text>
            <Typography.Paragraph className="!mb-0">
              Запросить синхронизацию CRM и проверить фактические часы за {formatMonthLabel(focusMonth)}.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Typography.Text type="secondary">Версия прогноза</Typography.Text>
            <Typography.Paragraph className="!mb-0">
              Активна версия <strong>{forecastVersionId}</strong>. Используйте Copy Forecast перед закрытием месяца.
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Typography.Text type="secondary">Фокус окна</Typography.Text>
            <Typography.Paragraph className="!mb-0">
              Период: {focusMonths.map((month): string => formatMonthLabel(month)).join(' • ')}
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
      <KpiCards data={data} focusMonth={focusMonth} />
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <Typography.Title level={5} className="!mb-0">
              Распределение по проектам
            </Typography.Title>
            <Typography.Text type="secondary">Период: {rangeLabel}</Typography.Text>
          </div>
          <Select<'rub' | 'hours'>
            value={pieMetric}
            onChange={(value): void => handlePieMetricChange(value)}
            options={[
              { value: 'rub', label: 'Выручка, ₽' },
              { value: 'hours', label: 'Часы' },
            ]}
            className="min-w-[160px]"
          />
        </div>
        {pieData.length === 0 || pieTotal === 0 ? (
          <Empty description="Нет данных для графика" />
        ) : (
          <div className="finops-pie-layout">
            <div className="finops-pie" style={{ background: pieGradient }}>
              <div className="finops-pie-center">
                <div className="text-xs text-slate-500">Итого</div>
                <div className="text-base font-semibold text-slate-900">
                  {pieMetric === 'rub' ? formatCurrency(pieTotal) : formatHours(pieTotal)}
                </div>
              </div>
            </div>
            <div className="finops-pie-legend">
              {pieSegments.map((segment) => (
                <div key={segment.name} className="finops-pie-legend-item">
                  <span className="finops-pie-swatch" style={{ background: segment.color }} />
                  <div>
                    <div className="text-sm font-medium text-slate-900">{segment.name}</div>
                    <div className="text-xs text-slate-500">
                      {pieMetric === 'rub' ? formatCurrency(segment.value) : formatHours(segment.value)}
                      {' • '}
                      {Math.round(segment.percent)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <Typography.Text type="secondary">Маржа, средняя</Typography.Text>
            <Typography.Title level={4} className="!mt-2">31%</Typography.Title>
            <Progress percent={31} showInfo={false} strokeColor="#16a34a" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Typography.Text type="secondary">Доля Fix‑контрактов</Typography.Text>
            <Typography.Title level={4} className="!mt-2">42%</Typography.Title>
            <Progress percent={42} showInfo={false} strokeColor="#2563eb" />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Typography.Text type="secondary">Проекты с рисками</Typography.Text>
            <Typography.Title level={4} className="!mt-2">6</Typography.Title>
            <Progress percent={60} showInfo={false} strokeColor="#f97316" />
          </Card>
        </Col>
      </Row>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <Typography.Title level={5} className="!mb-0">Список внимания</Typography.Title>
          <Typography.Text type="secondary">Последнее обновление 15 минут назад</Typography.Text>
        </div>
        <List
          dataSource={alerts}
          renderItem={(item: AlertItem): ReactElement => (
            <List.Item>
              <List.Item.Meta
                title={
                  <div className="flex items-center gap-2">
                    <Tag color={severityColor[item.severity]}>{item.severity.toUpperCase()}</Tag>
                    <span className="font-medium text-slate-900">{item.title}</span>
                  </div>
                }
                description={item.description}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
