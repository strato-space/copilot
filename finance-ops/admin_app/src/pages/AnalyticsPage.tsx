import { Card, Col, DatePicker, Empty, List, Progress, Row, Select, Tag, Tooltip, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import KpiCards from '../components/KpiCards';
import PageHeader from '../components/PageHeader';
import { usePlanFactStore } from '../store/planFactStore';
import { useFxStore } from '../store/fxStore';
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
  const [pieValueMode, setPieValueMode] = useState<'forecast' | 'fact'>('forecast');
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
  const fxRates = useFxStore((state) => state.rates);
  const getFxFactor = (month: string): number => {
    const item = fxRates[month];
    if (!item || !item.base) {
      return 1;
    }
    return item.rate / item.base;
  };
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

  const pieData = useMemo((): { client: string; project: string; value: number }[] => {
    if (!data?.clients?.length) {
      return [];
    }
    const activeMonths = focusMonths.length > 0 ? focusMonths : [focusMonth];
    const items: { client: string; project: string; value: number }[] = [];
    data.clients.forEach((client) => {
      client.projects.forEach((project) => {
        let sum = 0;
        activeMonths.forEach((month) => {
          const cell = project.months[month];
          if (!cell) {
            return;
          }
          if (pieMetric === 'rub') {
            const rubValue = pieValueMode === 'forecast' ? cell.forecast_rub : cell.fact_rub;
            sum += rubValue * getFxFactor(month);
            return;
          }
          sum += pieValueMode === 'forecast' ? cell.forecast_hours : cell.fact_hours;
        });
        if (sum > 0) {
          items.push({
            client: client.client_name,
            project: project.project_name,
            value: sum,
          });
        }
      });
    });
    return items.sort((a, b) => {
      if (a.client === b.client) {
        return b.value - a.value;
      }
      return a.client.localeCompare(b.client);
    });
  }, [data?.clients, focusMonths, focusMonth, pieMetric, pieValueMode, fxRates]);

  const pieTotal = useMemo(
    (): number => pieData.reduce((acc, item) => acc + item.value, 0),
    [pieData],
  );
  const pieColors = ['#1677ff', '#13c2c2', '#52c41a', '#fadb14', '#fa8c16', '#f5222d', '#722ed1', '#eb2f96'];
  const tintColor = (hex: string, amount: number): string => {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const mix = (channel: number): number => Math.round(channel + (255 - channel) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  };
  const darkenColor = (hex: string, amount: number): string => {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    const mix = (channel: number): number => Math.round(channel * (1 - amount));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  };
  const pieSegments = useMemo(
    (): { color: string; percent: number; name: string; value: number; client: string }[] => {
      if (!pieTotal) {
        return [];
      }
      const byClient = new Map<string, { project: string; value: number }[]>();
      const clientOrder: string[] = [];
      pieData.forEach((item) => {
        if (!byClient.has(item.client)) {
          byClient.set(item.client, []);
          clientOrder.push(item.client);
        }
        byClient.get(item.client)?.push({ project: item.project, value: item.value });
      });
      return clientOrder.flatMap((client, clientIndex) => {
        const projects = (byClient.get(client) ?? []).sort((a, b) => b.value - a.value);
        const base = pieColors[clientIndex % pieColors.length] ?? '#94a3b8';
        const total = projects.length;
        return projects.map((project, index) => {
          const tone = total <= 1 ? 0.2 : 0.15 + (0.5 - 0.15) * (index / (total - 1));
          return {
            color: tintColor(base, tone),
            percent: (project.value / pieTotal) * 100,
            name: project.project,
            value: project.value,
            client,
          };
        });
      });
    },
    [pieData, pieTotal],
  );

  const pieSlices = useMemo(
    (): Array<{ start: number; end: number; color: string; client: string; name: string; value: number; percent: number }> => {
      if (!pieTotal) {
        return [];
      }
      let angle = -90;
      return pieSegments.map((segment) => {
        const sweep = (segment.percent / 100) * 360;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        return {
          start,
          end,
          color: segment.color,
          client: segment.client,
          name: segment.name,
          value: segment.value,
          percent: segment.percent,
        };
      });
    },
    [pieSegments, pieTotal],
  );

  const legendSegments = useMemo(
    () => [...pieSegments].sort((a, b) => b.value - a.value).slice(0, 4),
    [pieSegments],
  );

  const lineMonths = useMemo((): string[] => {
    const start = dayjs('2026-01-01');
    const months: string[] = [];
    let cursor = start;
    for (let i = 0; i < 12; i += 1) {
      months.push(cursor.format('YYYY-MM'));
      cursor = cursor.add(1, 'month');
    }
    return months;
  }, []);
  const lineSeries = useMemo(
    (): { key: 'forecast' | 'fact'; label: string; color: string; values: number[] }[] => {
      const base = [
        { key: 'forecast' as const, label: 'Прогноз', color: '#1677ff' },
        { key: 'fact' as const, label: 'Факт', color: '#14b8a6' },
      ];
      return base.map((series) => {
        const values = lineMonths.map((month) => {
          let sum = 0;
          if (!data?.clients?.length) {
            return 0;
          }
          data.clients.forEach((client) => {
            client.projects.forEach((project) => {
              const cell = project.months[month];
              if (!cell) {
                return;
              }
              if (series.key === 'forecast') {
                if (pieMetric === 'rub') {
                  sum += cell.forecast_rub * getFxFactor(month);
                } else {
                  sum += cell.forecast_hours;
                }
              } else {
                if (pieMetric === 'rub') {
                  sum += cell.fact_rub * getFxFactor(month);
                } else {
                  sum += cell.fact_hours;
                }
              }
            });
          });
          return sum;
        });
        return { ...series, values };
      });
    },
    [data?.clients, lineMonths, pieMetric, fxRates],
  );
  const lineMax = useMemo((): number => {
    const values = lineSeries.flatMap((series) => series.values);
    return values.reduce((acc, item) => Math.max(acc, item), 0);
  }, [lineSeries]);
  const buildLinePath = (values: number[]): string => {
    if (values.length === 0) {
      return '';
    }
    const width = 360;
    const height = 200;
    const padding = 32;
    const points = values.map((value, index) => {
      const x = values.length === 1
        ? width / 2
        : padding + (index / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - (value / Math.max(lineMax, 1)) * (height - padding * 2);
      return { x, y };
    });
    const firstPoint = points[0] ?? { x: width / 2, y: height / 2 };
    if (points.length === 1) {
      return `M ${firstPoint.x} ${firstPoint.y}`;
    }
    const smoothing = 0.12;
    let path = `M ${firstPoint.x} ${firstPoint.y}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] ?? firstPoint;
      const p1 = points[i] ?? firstPoint;
      const p2 = points[i + 1] ?? firstPoint;
      const p3 = points[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) * smoothing;
      const cp1y = p1.y + (p2.y - p0.y) * smoothing;
      const cp2x = p2.x - (p3.x - p1.x) * smoothing;
      const cp2y = p2.y - (p3.y - p1.y) * smoothing;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  };
  const buildLinePoints = (values: number[]): { x: number; y: number }[] => {
    if (values.length === 0) {
      return [];
    }
    const width = 360;
    const height = 200;
    const padding = 32;
    return values.map((value, index) => {
      const x = values.length === 1
        ? width / 2
        : padding + (index / (values.length - 1)) * (width - padding * 2);
      const y = height - padding - (value / Math.max(lineMax, 1)) * (height - padding * 2);
      return { x, y };
    });
  };

  const describeArc = (startAngle: number, endAngle: number): string => {
    const radius = 90;
    const innerRadius = 55;
    const center = 100;
    const toPoint = (angle: number, r: number): [number, number] => {
      const radians = (Math.PI / 180) * angle;
      return [
        center + r * Math.cos(radians),
        center + r * Math.sin(radians),
      ];
    };
    const [sx, sy] = toPoint(startAngle, radius);
    const [ex, ey] = toPoint(endAngle, radius);
    const [isx, isy] = toPoint(endAngle, innerRadius);
    const [iex, iey] = toPoint(startAngle, innerRadius);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      `M ${sx} ${sy}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey}`,
      `L ${isx} ${isy}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${iex} ${iey}`,
      'Z',
    ].join(' ');
  };

  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);

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
  const handlePieValueModeChange = (value: 'forecast' | 'fact'): void => {
    setPieValueMode(value);
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
          <div className="flex items-center gap-2">
            <Select<'forecast' | 'fact'>
              value={pieValueMode}
              onChange={(value): void => handlePieValueModeChange(value)}
              options={[
                { value: 'forecast', label: 'Прогноз' },
                { value: 'fact', label: 'Факт' },
              ]}
              className="min-w-[120px]"
            />
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
        </div>
        {pieData.length === 0 || pieTotal === 0 ? (
          <Empty description="Нет данных для графика" />
        ) : (
          <div className="finops-chart-grid">
            <div className="finops-pie-layout">
              <div className="finops-pie">
                <svg viewBox="0 0 200 200" className="finops-pie-svg">
                  {pieSlices.map((slice, index) => (
                    <Tooltip
                      key={`${slice.client}-${slice.name}`}
                      title={`${slice.client} • ${slice.name}: ${
                        pieMetric === 'rub' ? formatCurrency(slice.value) : formatHours(slice.value)
                      } (${Math.round(slice.percent)}%)`}
                    >
                      <path
                        d={describeArc(slice.start, slice.end)}
                        fill={hoveredSlice === index ? darkenColor(slice.color, 0.2) : slice.color}
                        onMouseEnter={(): void => setHoveredSlice(index)}
                        onMouseLeave={(): void => setHoveredSlice(null)}
                      />
                    </Tooltip>
                  ))}
                </svg>
                <div className="finops-pie-center">
                  <div className="text-[10px] text-slate-500">Итого</div>
                  <div className="text-sm font-semibold text-slate-900">
                    {pieMetric === 'rub' ? formatCurrency(pieTotal) : formatHours(pieTotal)}
                  </div>
                </div>
              </div>
              <div className="finops-pie-legend">
                {legendSegments.map((segment, index) => {
                  const prev = legendSegments[index - 1];
                  const showClient = !prev || prev.client !== segment.client;
                  return (
                    <div key={`${segment.client}-${segment.name}`} className="finops-pie-legend-item">
                      <span className="finops-pie-swatch" style={{ background: segment.color }} />
                      <div>
                        {showClient && (
                          <div className="text-[10px] uppercase text-slate-400">{segment.client}</div>
                        )}
                        <div className="text-[12px] font-medium text-slate-900">{segment.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {pieMetric === 'rub' ? formatCurrency(segment.value) : formatHours(segment.value)}
                          {' • '}
                          {Math.round(segment.percent)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="finops-line-card">
              <div className="finops-line-header">
                <div className="text-[13px] font-semibold text-slate-900">Динамика по месяцам</div>
                <div className="finops-line-legend">
                  {lineSeries.map((series) => (
                    <div key={series.key} className="finops-line-legend-item">
                      <span className="finops-line-legend-icon" style={{ color: series.color }}>
                        ∿
                      </span>
                      <span className="text-[11px] text-slate-600">{series.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              {lineSeries.every((series) => series.values.every((value) => value === 0)) ? (
                <Empty description="Нет данных для линии" />
              ) : (
                <svg viewBox="0 0 360 200" className="finops-line-svg">
                  {[0, 1, 2, 3].map((index) => {
                    const y = 32 + (index / 3) * (200 - 64);
                    const value = Math.round((1 - index / 3) * lineMax);
                    return (
                      <g key={`grid-${index}`}>
                        <line
                          x1="32"
                          x2="328"
                          y1={y}
                          y2={y}
                          stroke="#e2e8f0"
                          strokeDasharray="4 6"
                        />
                        <text x="4" y={y + 4} fontSize="9" fill="#94a3b8">
                          {pieMetric === 'rub' ? formatCurrency(value) : formatHours(value)}
                        </text>
                      </g>
                    );
                  })}
                  {lineSeries.map((series) => {
                    const points = buildLinePoints(series.values);
                    return (
                      <g key={series.key}>
                        <path
                          d={buildLinePath(series.values)}
                          fill="none"
                          stroke={series.color}
                          strokeWidth="2.5"
                        />
                        {points.map((point, index) => (
                          <Tooltip
                            key={`${series.key}-${index}`}
                            title={`${formatMonthLabel(lineMonths[index] ?? focusMonth)}: ${
                              pieMetric === 'rub'
                                ? formatCurrency(series.values[index] ?? 0)
                                : formatHours(series.values[index] ?? 0)
                            }`}
                          >
                            <circle cx={point.x} cy={point.y} r="4" fill={series.color} />
                          </Tooltip>
                        ))}
                      </g>
                    );
                  })}
                  {lineMonths.map((month, index) => {
                    const x = lineMonths.length === 1
                      ? 180
                      : 32 + (index / (lineMonths.length - 1)) * (360 - 64);
                    if (lineMonths.length > 8 && index % 2 === 1) {
                      return null;
                    }
                    return (
                      <text
                        key={`${month}-label`}
                        x={x}
                        y={188}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#94a3b8"
                      >
                        {formatMonthLabel(month)}
                      </text>
                    );
                  })}
                </svg>
              )}
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
