import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Divider,
  Empty,
  Input,
  List,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs, { type Dayjs } from 'dayjs';
import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import KpiCards from '../components/KpiCards';
import PageHeader from '../components/PageHeader';
import { usePlanFactStore } from '../store/planFactStore';
import { useFxStore } from '../store/fxStore';
import { formatCurrency, formatHours, formatMonthLabel } from '../utils/format';
import { getEmployeeMonthlyHours, getEmployeeMonthlySalary } from '../services/employeeDirectory';
import { useNotificationStore } from '../store/notificationStore';
import { apiClient } from '../services/api';
import { useEmployeeStore } from '../store/employeeStore';
import { convertToRub } from '../services/expenseDirectory';
import { useExpensesStore } from '../store/expensesStore';
import { type PlanFactGridResponse } from '../services/types';

interface ProjectHighlight {
  key: string;
  customer: string;
  project: string;
  revenue: number;
  profit: number;
  marginPct: number;
}

const formatSignedCurrency = (value: number): string => {
  if (value === 0) {
    return formatCurrency(0);
  }
  const sign = value > 0 ? '+' : '−';
  return `${sign}${formatCurrency(Math.abs(value))}`;
};

interface EmployeeMargin {
  id: string;
  name: string;
  role: string;
  team: string;
  profit: number;
  marginPct: number;
}

interface OpsSnapshotInfo {
  filename: string;
  date: string | null;
}

interface OpsMetricLine {
  label: string;
  value: string;
  note?: string | null;
}

interface OpsAutomationCandidate {
  label: string;
  count: number;
  pain: string;
}

interface OpsSuggestOp {
  op_id: string;
  type: string;
  payload: Record<string, unknown>;
  reason: string;
  source_ref?: string | null;
}

interface OpsMetricsResponse {
  snapshot?: OpsSnapshotInfo | null;
  metrics: OpsMetricLine[];
  not_ok_signals: string[];
  automation_candidates: OpsAutomationCandidate[];
  suggest_ops: OpsSuggestOp[];
}

interface OpsApprovePackage {
  approve_id: string;
  date: string;
  ops: OpsSuggestOp[];
  status: 'ready' | 'approved' | 'applied';
  approved_by?: string | null;
}

interface OperopsLoadingState {
  metrics: boolean;
  approve: boolean;
  apply: boolean;
}

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

const toOpsErrorMessage = (err: unknown): string => {
  if (axios.isAxiosError(err)) {
    const apiDetail = (err.response?.data as { detail?: string } | undefined)?.detail;
    if (apiDetail) {
      return apiDetail;
    }
  }
  return err instanceof Error ? err.message : 'Unknown error';
};

const formatOpsSnapshot = (snapshot?: OpsSnapshotInfo | null): string | null => {
  if (!snapshot) {
    return null;
  }
  return snapshot.date ? `${snapshot.filename} · ${snapshot.date}` : snapshot.filename;
};

const limitOpsPayload = (payload: Record<string, unknown>, maxLen: number = 180): string => {
  try {
    const text = JSON.stringify(payload);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  } catch {
    return '[unserializable payload]';
  }
};


export default function AnalyticsPage(): ReactElement {
  const { RangePicker } = DatePicker;
  const [moduleTab, setModuleTab] = useState<'operops' | 'finance' | 'desops'>('finance');
  const [operopsMetrics, setOperopsMetrics] = useState<OpsMetricsResponse | null>(null);
  const [operopsLoadingState, setOperopsLoadingState] = useState<OperopsLoadingState>({
    metrics: false,
    approve: false,
    apply: false,
  });
  const [operopsError, setOperopsError] = useState<string | null>(null);
  const [operopsSelectedOpIds, setOperopsSelectedOpIds] = useState<Set<string>>(new Set());
  const [operopsApprovedBy, setOperopsApprovedBy] = useState<string>('admin');
  const [operopsApproveError, setOperopsApproveError] = useState<string | null>(null);
  const [operopsApprovePackage, setOperopsApprovePackage] = useState<OpsApprovePackage | null>(null);
  const [pieMetric, setPieMetric] = useState<'rub' | 'hours'>('rub');
  const [pieValueMode, setPieValueMode] = useState<'forecast' | 'fact'>('forecast');
  const operopsLoading = operopsLoadingState.metrics;
  const operopsApproveLoading = operopsLoadingState.approve;
  const operopsApplyLoading = operopsLoadingState.apply;
  const patchOperopsLoadingState = (patch: Partial<OperopsLoadingState>): void => {
    setOperopsLoadingState((prev) => ({ ...prev, ...patch }));
  };
  const triggerCheck = useNotificationStore((state) => state.triggerCheck);
  const employees = useEmployeeStore((state) => state.employees);
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
  const expenseOperations = useExpensesStore((state) => state.operations);
  const fxRatesByMonth = useExpensesStore((state) => state.fxRatesByMonth);
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

  const loadOperopsMetrics = useCallback(async (): Promise<void> => {
    patchOperopsLoadingState({ metrics: true });
    setOperopsError(null);
    try {
      const response = await apiClient.get<OpsMetricsResponse>('/ops/metrics');
      setOperopsMetrics(response.data);
      setOperopsSelectedOpIds(new Set());
    } catch (err) {
      setOperopsError(toOpsErrorMessage(err));
    } finally {
      patchOperopsLoadingState({ metrics: false });
    }
  }, []);

  useEffect((): void => {
    if (moduleTab !== 'operops') {
      return;
    }
    void loadOperopsMetrics();
  }, [loadOperopsMetrics, moduleTab]);

  useEffect((): void => {
    triggerCheck('analytics');
  }, [triggerCheck]);
  const activeMonths = useMemo(
    (): string[] => (focusMonths.length > 0 ? focusMonths : [focusMonth]),
    [focusMonths, focusMonth],
  );
  const averageCostRate = useMemo((): number => {
    if (!employees.length) {
      return 1500;
    }
    const months = activeMonths.length ? activeMonths : [focusMonth];
    let totalPayroll = 0;
    let totalHours = 0;
    months.forEach((month) => {
      employees.forEach((employee) => {
        totalPayroll += getEmployeeMonthlySalary(employee, month);
        totalHours += getEmployeeMonthlyHours(employee, month);
      });
    });
    if (!totalHours) {
      return 1500;
    }
    return totalPayroll / totalHours;
  }, [activeMonths, focusMonth, employees]);
  const totalExpenseCost = useMemo((): number => {
    if (!employees.length) {
      return 0;
    }
    const months = activeMonths.length ? activeMonths : [focusMonth];
    return months.reduce((sum, month) =>
      sum + employees.reduce((acc, employee) => acc + getEmployeeMonthlySalary(employee, month), 0),
      0);
  }, [activeMonths, focusMonth, employees]);
  const chartData = useMemo((): PlanFactGridResponse | null => data, [data]);

  const projectHighlights = useMemo((): ProjectHighlight[] => {
    if (!chartData?.customers?.length) {
      return [];
    }
    const items: ProjectHighlight[] = [];
    chartData.customers.forEach((customer) => {
      customer.projects.forEach((project) => {
        let revenue = 0;
        let hours = 0;
        activeMonths.forEach((month) => {
          const cell = project.months[month];
          if (!cell) {
            return;
          }
          revenue += cell.fact_rub * getFxFactor(month);
          hours += cell.fact_hours;
        });
        if (revenue === 0 && hours === 0) {
          return;
        }
        const cost = hours * averageCostRate;
        const profit = revenue - cost;
        const marginPct = revenue ? (profit / revenue) * 100 : 0;
        items.push({
          key: `${customer.customer_id}-${project.project_id}`,
          customer: customer.customer_name,
          project: project.project_name,
          revenue,
          profit,
          marginPct,
        });
      });
    });
    const sorted = [...items].sort((a, b) => b.profit - a.profit);
    const highlightMap = new Map<string, ProjectHighlight>();
    const add = (item: ProjectHighlight): void => {
      if (!highlightMap.has(item.key)) {
        highlightMap.set(item.key, item);
      }
    };
    sorted.slice(0, 4).forEach(add);
    sorted.slice(-2).forEach(add);
    const highlights = Array.from(highlightMap.values());
    if (sorted.length > highlights.length) {
      const remainder = sorted.filter((item) => !highlightMap.has(item.key));
      if (remainder.length) {
        const aggregate = remainder.reduce(
          (acc, item) => ({
            revenue: acc.revenue + item.revenue,
            profit: acc.profit + item.profit,
          }),
          { revenue: 0, profit: 0 },
        );
        highlights.push({
          key: 'others',
          customer: '',
          project: 'Остальные',
          revenue: aggregate.revenue,
          profit: aggregate.profit,
          marginPct: aggregate.revenue ? (aggregate.profit / aggregate.revenue) * 100 : 0,
        });
      }
    }
    return highlights;
  }, [chartData?.customers, activeMonths, fxRates, averageCostRate]);
  const employeeMargins = useMemo((): EmployeeMargin[] => {
    if (!employees.length) {
      return [];
    }
    return employees
      .map((employee) => {
        const months = activeMonths.length ? activeMonths : [focusMonth];
        const cost = months.reduce((sum, month) => sum + getEmployeeMonthlySalary(employee, month), 0);
        const marginPct = totalExpenseCost ? (cost / totalExpenseCost) * 100 : 0;
        return {
          id: employee.id,
          name: employee.name,
          role: employee.role,
          team: employee.team,
          profit: cost,
          marginPct,
        };
      })
      .sort((a, b) => b.profit - a.profit);
  }, [activeMonths, focusMonth, totalExpenseCost, employees]);

  const pieData = useMemo((): { customer: string; project: string; value: number }[] => {
    if (!chartData?.customers?.length) {
      return [];
    }
    const items: { customer: string; project: string; value: number }[] = [];
    chartData.customers.forEach((customer) => {
      customer.projects.forEach((project) => {
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
            customer: customer.customer_name,
            project: project.project_name,
            value: sum,
          });
        }
      });
    });
    return items.sort((a, b) => {
      if (a.customer === b.customer) {
        return b.value - a.value;
      }
      return a.customer.localeCompare(b.customer);
    });
  }, [chartData?.customers, activeMonths, pieMetric, pieValueMode, fxRates]);

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
    (): { color: string; percent: number; name: string; value: number; customer: string }[] => {
      if (!pieTotal) {
        return [];
      }
      const byCustomer = new Map<string, { project: string; value: number }[]>();
      const customerOrder: string[] = [];
      pieData.forEach((item) => {
        if (!byCustomer.has(item.customer)) {
          byCustomer.set(item.customer, []);
          customerOrder.push(item.customer);
        }
        byCustomer.get(item.customer)?.push({ project: item.project, value: item.value });
      });
      return customerOrder.flatMap((customer, customerIndex) => {
        const projects = (byCustomer.get(customer) ?? []).sort((a, b) => b.value - a.value);
        const base = pieColors[customerIndex % pieColors.length] ?? '#94a3b8';
        const total = projects.length;
        return projects.map((project, index) => {
          const tone = total <= 1 ? 0.2 : 0.15 + (0.5 - 0.15) * (index / (total - 1));
          return {
            color: tintColor(base, tone),
            percent: (project.value / pieTotal) * 100,
            name: project.project,
            value: project.value,
            customer,
          };
        });
      });
    },
    [pieData, pieTotal],
  );

  const pieSlices = useMemo(
    (): Array<{ start: number; end: number; color: string; customer: string; name: string; value: number; percent: number }> => {
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
          customer: segment.customer,
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
    const base = activeMonths.length ? activeMonths : [focusMonth];
    return base.slice(0, 4);
  }, [activeMonths, focusMonth]);
  const monthlyExpenses = useMemo((): Record<string, number> => {
    const result: Record<string, number> = {};
    lineMonths.forEach((month) => {
      const payroll = employees.reduce((sum, employee) => sum + getEmployeeMonthlySalary(employee, month), 0);
      const other = expenseOperations.reduce((sum, operation) => {
        if (operation.month !== month) {
          return sum;
        }
        const fallbackFx = fxRates[operation.month]?.rate ?? fxRatesByMonth[operation.month] ?? 0;
        return sum + convertToRub(operation, fallbackFx);
      }, 0);
      result[month] = payroll + other;
    });
    return result;
  }, [employees, expenseOperations, fxRates, fxRatesByMonth, lineMonths]);
  const monthlyRevenue = useMemo((): Record<string, number> => {
    const result: Record<string, number> = {};
    lineMonths.forEach((month) => {
      let revenue = 0;
      if (chartData?.customers?.length) {
        chartData.customers.forEach((customer) => {
          const cell = customer.totals_by_month[month];
          if (!cell) {
            return;
          }
          const fxFactor = getFxFactor(month);
          revenue += cell.fact_rub * fxFactor;
        });
      }
      result[month] = revenue;
    });
    return result;
  }, [chartData?.customers, lineMonths, fxRates]);
  const barMax = useMemo((): number => {
    const values = lineMonths.flatMap((month) => [monthlyRevenue[month] ?? 0, monthlyExpenses[month] ?? 0]);
    return values.reduce((acc, value) => Math.max(acc, value), 0);
  }, [lineMonths, monthlyRevenue, monthlyExpenses]);
  // Line chart helpers removed (switched to column chart).

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

  const operopsSnapshotLabel = useMemo(
    (): string | null => formatOpsSnapshot(operopsMetrics?.snapshot),
    [operopsMetrics?.snapshot],
  );
  const operopsSuggestions = useMemo(
    (): OpsSuggestOp[] => operopsMetrics?.suggest_ops ?? [],
    [operopsMetrics?.suggest_ops],
  );

  useEffect((): void => {
    void fetchPlanFact();
  }, [fetchPlanFact, focusMonth, forecastVersionId]);

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Аналитика"
        actions={
          moduleTab === 'finance' ? (
            <RangePicker
              picker="month"
              value={rangeValue}
              onChange={(value): void => handleRangeChange(value)}
              className="min-w-[220px]"
              allowClear={false}
            />
          ) : null
        }
      />
      <Tabs
        activeKey={moduleTab}
        onChange={(key): void => setModuleTab(key as 'operops' | 'finance' | 'desops')}
        items={[
          {
            key: 'operops',
            label: 'OperOps',
            children: (
              <div className="flex flex-col gap-4">
                <Card className="border border-slate-200">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <Typography.Title level={5} className="!mb-0">
                        OperOps · Метрики
                      </Typography.Title>
                      <Typography.Text type="secondary" className="text-xs">
                        Snapshot: {operopsSnapshotLabel ?? '—'} • источник: `/api/ops/metrics`
                      </Typography.Text>
                    </div>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={(): void => void loadOperopsMetrics()}
                      loading={operopsLoading}
                    >
                      Обновить
                    </Button>
                  </div>
                  <Divider />
                  {operopsError ? (
                    <Alert
                      type="error"
                      showIcon
                      message="Не удалось загрузить метрики OperOps"
                      description={operopsError}
                      className="mb-3"
                    />
                  ) : null}
                  {operopsLoading ? (
                    <div className="py-10 flex justify-center">
                      <Spin />
                    </div>
                  ) : null}
                  {!operopsLoading && !operopsMetrics && !operopsError ? (
                    <Empty description="Нет данных по OperOps" />
                  ) : null}
                  {!operopsLoading && operopsMetrics ? (
                    <div className="flex flex-col gap-4">
                      {operopsMetrics.not_ok_signals.length ? (
                        <div>
                          <Typography.Text type="secondary" className="block text-xs mb-2">
                            Сигналы
                          </Typography.Text>
                          <Space wrap>
                            {operopsMetrics.not_ok_signals.map((signal) => (
                              <Tag key={signal} color="gold">
                                {signal}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                      ) : null}

                      <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                          <Card className="border border-slate-200">
                            <Typography.Title level={5}>Metrics</Typography.Title>
                            <List
                              dataSource={operopsMetrics.metrics}
                              locale={{ emptyText: 'Пусто' }}
                              renderItem={(line): ReactElement => (
                                <List.Item>
                                  <Space>
                                    <Badge color="blue" />
                                    <Typography.Text>{line.label}:</Typography.Text>
                                    <Typography.Text className="font-medium">{line.value}</Typography.Text>
                                    {line.note ? (
                                      <Typography.Text type="secondary" className="text-xs">
                                        ({line.note})
                                      </Typography.Text>
                                    ) : null}
                                  </Space>
                                </List.Item>
                              )}
                            />
                          </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                          <Card className="border border-slate-200">
                            <Typography.Title level={5}>Automation candidates</Typography.Title>
                            <List
                              dataSource={operopsMetrics.automation_candidates}
                              locale={{ emptyText: 'Пусто' }}
                              renderItem={(candidate): ReactElement => (
                                <List.Item>
                                  <div className="flex flex-col gap-1">
                                    <Space>
                                      <Tag color="geekblue">{candidate.count}</Tag>
                                      <Typography.Text className="font-medium">{candidate.label}</Typography.Text>
                                    </Space>
                                    <Typography.Text type="secondary" className="text-xs">
                                      {candidate.pain}
                                    </Typography.Text>
                                  </div>
                                </List.Item>
                              )}
                            />
                          </Card>
                        </Col>
                      </Row>
                    </div>
                  ) : null}
                </Card>

                <Card className="border border-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div>
                      <Typography.Title level={5} className="!mb-0">
                        Предложения по метрикам
                      </Typography.Title>
                      <Typography.Text type="secondary" className="text-xs">
                        Контроль человеком: Подтвердить → Применить (применение на сервере сейчас заблокировано — fail-closed).
                      </Typography.Text>
                    </div>
                    <Space wrap>
                      <Input
                        placeholder="approved_by"
                        value={operopsApprovedBy}
                        onChange={(event): void => setOperopsApprovedBy(event.target.value)}
                        className="w-[160px]"
                      />
                      <Button
                        onClick={(): void => setOperopsSelectedOpIds(new Set(operopsSuggestions.map((op) => op.op_id)))}
                        disabled={operopsSuggestions.length === 0}
                      >
                        Выбрать всё
                      </Button>
                      <Button
                        onClick={(): void => setOperopsSelectedOpIds(new Set())}
                        disabled={operopsSuggestions.length === 0}
                      >
                        Очистить
                      </Button>
                      <Button
                        type="primary"
                        loading={operopsApproveLoading}
                        disabled={operopsSuggestions.length === 0 || operopsSelectedOpIds.size === 0}
                        onClick={async (): Promise<void> => {
                          patchOperopsLoadingState({ approve: true });
                          setOperopsApproveError(null);
                          try {
                            const selectedOps = operopsSuggestions.filter((op) => operopsSelectedOpIds.has(op.op_id));
                            const response = await apiClient.post<OpsApprovePackage>('/ops/approve', {
                              ops: selectedOps,
                              approved_by: operopsApprovedBy || undefined,
                              context: 'analytics/operops',
                            });
                            setOperopsApprovePackage(response.data);
                          } catch (err) {
                            setOperopsApproveError(toOpsErrorMessage(err));
                          } finally {
                            patchOperopsLoadingState({ approve: false });
                          }
                        }}
                      >
                        Подтвердить
                      </Button>
                      <Button
                        loading={operopsApplyLoading}
                        disabled={!operopsApprovePackage?.approve_id}
                        onClick={async (): Promise<void> => {
                          if (!operopsApprovePackage?.approve_id) {
                            return;
                          }
                          patchOperopsLoadingState({ apply: true });
                          setOperopsApproveError(null);
                          try {
                            const response = await apiClient.post<OpsApprovePackage>('/ops/apply', {
                              approve_id: operopsApprovePackage.approve_id,
                            });
                            setOperopsApprovePackage(response.data);
                          } catch (err) {
                            setOperopsApproveError(toOpsErrorMessage(err));
                          } finally {
                            patchOperopsLoadingState({ apply: false });
                          }
                        }}
                      >
                        Применить
                      </Button>
                    </Space>
                  </div>
                  {operopsApproveError ? (
                    <Alert
                      type="error"
                      message="Approve/Apply error"
                      description={operopsApproveError}
                      showIcon
                      className="mb-3"
                    />
                  ) : null}
                  {operopsApprovePackage ? (
                    <Alert
                      type="info"
                      showIcon
                      message={`approve_id: ${operopsApprovePackage.approve_id}`}
                      description={`status: ${operopsApprovePackage.status}${operopsApprovePackage.approved_by ? ` • approved_by: ${operopsApprovePackage.approved_by}` : ''
                        }`}
                      className="mb-3"
                    />
                  ) : null}
                  {operopsSuggestions.length === 0 ? (
                    <Empty description="Нет suggestions" />
                  ) : (
                    <List
                      dataSource={operopsSuggestions}
                      renderItem={(op): ReactElement => (
                        <List.Item
                          key={op.op_id}
                          className="items-start"
                          actions={[
                            <Tag key="type" color="blue">
                              {op.type}
                            </Tag>,
                          ]}
                        >
                          <Checkbox
                            checked={operopsSelectedOpIds.has(op.op_id)}
                            onChange={(event): void => {
                              setOperopsSelectedOpIds((prev) => {
                                const next = new Set(prev);
                                if (event.target.checked) {
                                  next.add(op.op_id);
                                  return next;
                                }
                                next.delete(op.op_id);
                                return next;
                              });
                            }}
                          >
                            <div className="flex flex-col gap-1">
                              <Typography.Text className="text-sm">{op.reason}</Typography.Text>
                              <Typography.Text type="secondary" className="text-xs">
                                {limitOpsPayload(op.payload)}
                              </Typography.Text>
                            </div>
                          </Checkbox>
                        </List.Item>
                      )}
                    />
                  )}
                </Card>
              </div>
            ),
          },
          {
            key: 'finance',
            label: 'Finance',
            children: null,
          },
          {
            key: 'desops',
            label: 'DesOps',
            children: (
              <Card>
                <Empty description="Пока пусто" />
              </Card>
            ),
          },
        ]}
      />
      {moduleTab === 'finance' ? (
        <Row gutter={[16, 16]} className="finops-analytics-layout">
          <Col xs={24} xl={24}>
            <div className="finops-analytics-stack">
              <KpiCards data={data} months={activeMonths} />
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
                              key={`${slice.customer}-${slice.name}`}
                              title={`${slice.customer} • ${slice.name}: ${pieMetric === 'rub' ? formatCurrency(slice.value) : formatHours(slice.value)
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
                          const showCustomer = !prev || prev.customer !== segment.customer;
                          return (
                            <div key={`${segment.customer}-${segment.name}`} className="finops-pie-legend-item">
                              <span className="finops-pie-swatch" style={{ background: segment.color }} />
                              <div>
                                {showCustomer && (
                                  <div className="text-[10px] uppercase text-slate-400">{segment.customer}</div>
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
                        <div className="text-[13px] font-semibold text-slate-900">Динамика по месяцам (доходы − расходы)</div>
                        <div className="finops-line-legend">
                          <div className="finops-line-legend-item">
                            <span className="finops-line-legend-icon" style={{ color: '#1677ff' }}>
                              ■
                            </span>
                            <span className="text-[11px] text-slate-600">Прибыль</span>
                          </div>
                          <div className="finops-line-legend-item">
                            <span className="finops-line-legend-icon" style={{ color: '#f97316' }}>
                              ■
                            </span>
                            <span className="text-[11px] text-slate-600">Расходы</span>
                          </div>
                        </div>
                      </div>
                      {lineMonths.every((month) => (monthlyRevenue[month] ?? 0) === 0 && (monthlyExpenses[month] ?? 0) === 0) ? (
                        <Empty description="Нет данных для графика" />
                      ) : (
                        <div className="flex items-end gap-4 pt-4">
                          {lineMonths.map((month) => {
                            const revenue = monthlyRevenue[month] ?? 0;
                            const expenses = monthlyExpenses[month] ?? 0;
                            const diff = revenue - expenses;
                            const maxValue = barMax || 1;
                            const revenueHeight = Math.round((revenue / maxValue) * 140);
                            const expenseHeight = Math.round((expenses / maxValue) * 140);
                            return (
                              <div key={month} className="flex flex-1 flex-col items-center gap-2">
                                <div className={`text-[11px] font-medium ${diff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {formatSignedCurrency(diff)}
                                </div>
                                <div className="flex items-end gap-2 h-[150px]">
                                  <Tooltip title={`Прибыль: ${formatCurrency(revenue)}`}>
                                    <div
                                      className="w-6 rounded-t-md bg-blue-500"
                                      style={{ height: `${revenueHeight}px` }}
                                    />
                                  </Tooltip>
                                  <Tooltip title={`Расходы: ${formatCurrency(expenses)}`}>
                                    <div
                                      className="w-6 rounded-t-md bg-orange-400"
                                      style={{ height: `${expenseHeight}px` }}
                                    />
                                  </Tooltip>
                                </div>
                                <div className="text-[10px] text-slate-500">{formatMonthLabel(month)}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={14}>
                  <Card>
                    <div className="flex items-center justify-between mb-4">
                      <Typography.Title level={5} className="!mb-0">
                        Топ прибыльных и убыточных проектов
                      </Typography.Title>
                      <Typography.Text type="secondary">Период: {rangeLabel}</Typography.Text>
                    </div>
                    {projectHighlights.length === 0 ? (
                      <Empty description="Нет данных по проектам" />
                    ) : (
                      <List
                        dataSource={projectHighlights}
                        renderItem={(item): ReactElement => (
                          <List.Item>
                            <div className="finops-list-row">
                              <div>
                                <div className="text-sm font-medium text-slate-900">{item.project}</div>
                                {item.customer && <div className="text-xs text-slate-500">{item.customer}</div>}
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className={item.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                                    {formatCurrency(item.profit)}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {Math.round(item.marginPct)}%
                                  </div>
                                </div>
                                <div className="w-[120px]">
                                  <Progress
                                    percent={Math.min(Math.abs(item.marginPct), 100)}
                                    showInfo={false}
                                    strokeColor={item.profit >= 0 ? '#16a34a' : '#ef4444'}
                                  />
                                </div>
                              </div>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <Card>
                    <div className="flex items-center justify-between mb-4">
                      <Typography.Title level={5} className="!mb-0">
                        Маржа по исполнителям
                      </Typography.Title>
                      <Typography.Text type="secondary">Период: {rangeLabel}</Typography.Text>
                    </div>
                    {employeeMargins.length === 0 ? (
                      <Empty description="Нет данных по исполнителям" />
                    ) : (
                      <List
                        dataSource={employeeMargins}
                        renderItem={(item): ReactElement => (
                          <List.Item>
                            <div className="finops-list-row">
                              <div>
                                <div className="text-sm font-medium text-slate-900">{item.name}</div>
                                <div className="text-xs text-slate-500">
                                  {item.team} • {item.role}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-slate-900">{formatCurrency(item.profit)}</div>
                                <div className="text-xs text-slate-500">
                                  {Math.round(item.marginPct)}%
                                </div>
                              </div>
                            </div>
                          </List.Item>
                        )}
                      />
                    )}
                  </Card>
                </Col>
              </Row>
            </div>
          </Col>
        </Row>
      ) : null}
    </div>
  );
}
