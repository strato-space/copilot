import { Button, Table, Tag, Tooltip, Typography } from 'antd';
import {
  ArrowRightOutlined,
  EditOutlined,
  FilterOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FilterValue } from 'antd/es/table/interface';
import { type CSSProperties, type ReactElement, type TdHTMLAttributes, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type PlanFactCellContext,
  type PlanFactClientRow,
  type PlanFactMonthCell,
  type PlanFactProjectRow,
} from '../services/types';
import { useFxStore } from '../store/fxStore';
import { formatCurrency, formatHours, formatMonthLabel } from '../utils/format';

interface RowItem {
  key: string;
  row_type: 'project';
  client_id: string;
  client_name: string;
  client_full: string;
  project_id: string;
  project_name: string;
  subproject_name: string;
  contract_type: string;
  rate_rub_per_hour?: number | null;
  months: Record<string, PlanFactMonthCell>;
}

interface Props {
  clients: PlanFactClientRow[];
  months: string[];
  focusMonth: string;
  onFocusMonthChange: (month: string) => void;
  onOpenDrawer: (context: PlanFactCellContext) => void;
}

type SummaryCellProps = TdHTMLAttributes<HTMLTableCellElement> & {
  index: number;
  colSpan?: number;
  rowSpan?: number;
};

const SummaryCell = Table.Summary.Cell as unknown as (props: SummaryCellProps) => ReactElement;

const emptyCell = (): PlanFactMonthCell => ({
  fact_rub: 0,
  fact_hours: 0,
  forecast_rub: 0,
  forecast_hours: 0,
});

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const normalizeCell = (cell?: Partial<PlanFactMonthCell> | null): PlanFactMonthCell => ({
  fact_rub: toNumber(cell?.fact_rub),
  fact_hours: toNumber(cell?.fact_hours),
  forecast_rub: toNumber(cell?.forecast_rub),
  forecast_hours: toNumber(cell?.forecast_hours),
  // With exactOptionalPropertyTypes=true we must not set optional fields to `undefined`.
  ...(typeof cell?.fact_comment === 'string' ? { fact_comment: cell.fact_comment } : {}),
  ...(typeof cell?.forecast_comment === 'string' ? { forecast_comment: cell.forecast_comment } : {}),
});

const PIN_STORAGE_KEY = 'finopsPinnedMonths';
const BASE_FIXED_WIDTH = 352;
const MONTH_COL_WIDTH = 120;

const normalizeMonths = (
  months: Record<string, PlanFactMonthCell>,
  range: string[],
): Record<string, PlanFactMonthCell> => {
  const normalized: Record<string, PlanFactMonthCell> = {};
  range.forEach((month: string): void => {
    normalized[month] = normalizeCell(months[month]);
  });
  return normalized;
};

const toRows = (clients: PlanFactClientRow[], months: string[]): RowItem[] => {
  const rows: RowItem[] = [];

  clients.forEach((client: PlanFactClientRow): void => {
    if (!Array.isArray(client.projects)) {
      return;
    }
    client.projects.forEach((project: PlanFactProjectRow): void => {
      const normalized = normalizeMonths(project.months, months);
      const hasAnyValue = months.some((month) => {
        const cell = normalized[month] ?? emptyCell();
        return Boolean(
          cell.fact_rub ||
          cell.fact_hours ||
          cell.forecast_rub ||
          cell.forecast_hours ||
          cell.fact_comment ||
          cell.forecast_comment,
        );
      });
      if (!hasAnyValue) {
        return;
      }
      rows.push({
        key: `project-${client.client_id}-${project.project_id}`,
        row_type: 'project',
        client_id: client.client_id,
        client_name: client.client_name,
        client_full: client.client_name,
        project_id: project.project_id,
        project_name: project.project_name,
        subproject_name: project.subproject_name,
        contract_type: project.contract_type,
        rate_rub_per_hour: project.rate_rub_per_hour ?? null,
        months: normalized,
      });
    });
  });

  return rows;
};

const buildTotalsFromRows = (
  rows: RowItem[],
  months: string[],
): Record<string, PlanFactMonthCell> => {
  const totals: Record<string, PlanFactMonthCell> = {};
  months.forEach((month: string): void => {
    totals[month] = emptyCell();
  });
  rows.forEach((row: RowItem): void => {
    months.forEach((month: string): void => {
      const cell = normalizeCell(row.months[month]);
      const current = totals[month] ?? emptyCell();
      const isFix = row.contract_type === 'Fix';
      const factRub = isFix ? cell.forecast_rub : cell.fact_rub;
      totals[month] = {
        fact_rub: current.fact_rub + factRub,
        fact_hours: current.fact_hours + cell.fact_hours,
        forecast_rub: current.forecast_rub + cell.forecast_rub,
        forecast_hours: current.forecast_hours + cell.forecast_hours,
      };
    });
  });
  return totals;
};


const abbreviateClient = (name?: string): string => {
  if (!name) {
    return '—';
  }
  const normalized = name.trim();
  if (!normalized) {
    return '—';
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join('');
  const base = initials.length >= 2 ? initials : normalized.replace(/[^A-Za-zА-Яа-я0-9]/g, '');
  return base.toUpperCase().slice(0, 8);
};

const ValueCell = ({
  valueRub,
  valueHours,
  onOpen,
  ariaLabel,
}: {
  valueRub: number;
  valueHours: number;
  onOpen?: () => void;
  ariaLabel?: string;
}): ReactElement => {
  const hasValue = valueRub !== 0 || valueHours !== 0;
  const content = (
    <div className="finops-cell-text">
      <div className={hasValue ? 'text-[11px] font-semibold text-slate-900' : 'text-[11px] font-semibold text-slate-400'}>
        {hasValue ? formatCurrency(valueRub) : '—'}
      </div>
      <div className={hasValue ? 'text-[9px] text-slate-500' : 'text-[9px] text-slate-400'}>
        {hasValue ? formatHours(valueHours) : '—'}
      </div>
    </div>
  );

  if (!onOpen) {
    return <div className="px-2">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className="finops-cell-button group w-full rounded-lg px-2 py-2 border border-transparent hover:border-slate-200 hover:bg-slate-50 transition"
    >
      <div className="finops-cell-content">
        {content}
        <EditOutlined className="finops-cell-icon text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </button>
  );
};

const buildColumns = (
  months: string[],
  focusMonth: string,
  onFocusMonthChange: (month: string) => void,
  onOpenDrawer: (context: PlanFactCellContext) => void,
  clientFilters: { text: string; value: string }[],
  pinnedMonths: string[],
  onTogglePin: (month: string) => void,
  getFxFactor: (month: string) => number,
): ColumnsType<RowItem> => {
  const pinnedSet = new Set(pinnedMonths);
  const orderedMonths = [
    ...months.filter((month) => pinnedSet.has(month)),
    ...months.filter((month) => !pinnedSet.has(month)),
  ];
  const base: ColumnsType<RowItem> = [
    {
      title: 'Клиент',
      dataIndex: 'client_name',
      key: 'client_name',
      filters: clientFilters,
      filterIcon: (filtered: boolean): ReactElement => (
        <FilterOutlined className={filtered ? 'text-blue-600' : 'text-slate-400'} />
      ),
      onFilter: (value, row): boolean => row.client_name === value,
      render: (value: string | undefined, row: RowItem): ReactElement => (
        <div>
          <Tooltip title={row.client_full}>
            <Tag
              color="blue"
              className="!m-0 text-xs font-semibold uppercase"
              style={{ maxWidth: 90 }}
            >
              <span className="inline-block max-w-[80px] truncate">{abbreviateClient(value)}</span>
            </Tag>
          </Tooltip>
        </div>
      ),
      width: 96,
      fixed: 'left',
    },
    {
      title: 'Проект',
      dataIndex: 'project_name',
      key: 'project_name',
      className: 'finops-project-col',
      onHeaderCell: (): { className: string } => ({ className: 'finops-project-col' }),
      filters: [
        { text: 'Все', value: 'all' },
        { text: 'T&M', value: 'T&M' },
        { text: 'Fix', value: 'Fix' },
      ],
      filterIcon: (filtered: boolean): ReactElement => (
        <FilterOutlined className={filtered ? 'text-blue-600' : 'text-slate-400'} />
      ),
      onFilter: (value, row): boolean => {
        if (value === 'all') {
          return true;
        }
        return row.contract_type === value;
      },
      render: (value: string | undefined, row: RowItem): ReactElement => (
        <div className={row.row_type === 'project' ? 'pl-2' : ''}>
          <div className="text-sm font-semibold uppercase text-slate-900 flex items-center gap-2">
            <Tag className="!m-0" color={row.contract_type === 'Fix' ? 'volcano' : 'cyan'}>
              {row.contract_type ?? '—'}
            </Tag>
            <span>{value}</span>
          </div>
          {row.subproject_name ? (
            <div className="text-xs uppercase text-slate-500">{row.subproject_name}</div>
          ) : null}
        </div>
      ),
      width: 224,
      fixed: 'left',
    },
    {
      title: '',
      key: 'actions',
      width: 32,
      fixed: 'left',
      className: 'finops-actions-col',
      onHeaderCell: (): { className: string } => ({ className: 'finops-actions-col' }),
      render: (_: unknown, row: RowItem): ReactElement => (
        <div className="flex items-start justify-end">
          <Tooltip title="Редактировать проект">
            <Link
              to={`/guide/projects/${row.project_id ?? ''}`}
              className="finops-row-action"
              aria-label="Редактировать проект"
            >
              <Button
                type="text"
                size="small"
                icon={<ArrowRightOutlined />}
                className="text-slate-400 hover:text-slate-900"
              />
            </Link>
          </Tooltip>
        </div>
      ),
    },
  ];

  const monthColumns = orderedMonths.map((month: string): ColumnsType<RowItem>[number] => {
    const isFocus = month === focusMonth;
    const isPinned = pinnedSet.has(month);
    const isHighlighted = isFocus || isPinned;
    const focusLeftClass = isHighlighted ? 'finops-focus-left' : '';
    const focusRightClass = isHighlighted ? 'finops-focus-right' : '';
    const fixedProps = isPinned ? { fixed: 'left' as const } : {};
    return ({
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
            onClick={(): void => onTogglePin(month)}
            aria-label={isPinned ? 'Снять закрепление' : 'Закрепить месяц'}
            className="finops-pin-button"
          >
            {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
          </button>
        </div>
      ),
      className: isHighlighted ? 'finops-focus-group' : '',
      onHeaderCell: (): { className: string } => ({ className: isHighlighted ? 'finops-focus-group' : '' }),
      ...fixedProps,
      key: month,
      children: [
        {
          title: <span className="finops-subhead">Прогноз</span>,
          key: `${month}-forecast`,
          width: MONTH_COL_WIDTH,
          align: 'center',
          className: `finops-value-col ${focusLeftClass}`.trim(),
          onHeaderCell: (): { className: string } => ({ className: `finops-value-col ${focusLeftClass}`.trim() }),
          ...fixedProps,
          render: (_: unknown, row: RowItem): ReactElement => {
            const cell = row.months[month] ?? emptyCell();
            const fxFactor = getFxFactor(month);
            const handleOpen = (): void => {
              onOpenDrawer({
                client_id: row.client_id,
                client_name: row.client_name,
                project_id: row.project_id ?? '',
                project_name: row.project_name ?? '',
                subproject_name: row.subproject_name ?? '',
                contract_type: row.contract_type ?? 'T&M',
                rate_rub_per_hour: row.rate_rub_per_hour ?? null,
                month,
                edit_mode: 'forecast',
                values: cell,
              });
            };
            return (
              <ValueCell
                valueRub={cell.forecast_rub * fxFactor}
                valueHours={cell.forecast_hours}
                onOpen={handleOpen}
                ariaLabel={`Открыть ${row.project_name ?? 'проект'} за ${formatMonthLabel(month)} (прогноз)`}
              />
            );
          },
        },
        {
          title: <span className="finops-subhead">Факт</span>,
          key: `${month}-fact`,
          width: MONTH_COL_WIDTH,
          align: 'center',
          className: `finops-value-col ${focusRightClass}`.trim(),
          onHeaderCell: (): { className: string } => ({ className: `finops-value-col ${focusRightClass}`.trim() }),
          ...fixedProps,
          render: (_: unknown, row: RowItem): ReactElement => {
            const cell = row.months[month] ?? emptyCell();
            const fxFactor = getFxFactor(month);
            const handleOpen = (): void => {
              onOpenDrawer({
                client_id: row.client_id,
                client_name: row.client_name,
                project_id: row.project_id ?? '',
                project_name: row.project_name ?? '',
                subproject_name: row.subproject_name ?? '',
                contract_type: row.contract_type ?? 'T&M',
                rate_rub_per_hour: row.rate_rub_per_hour ?? null,
                month,
                edit_mode: 'fact',
                values: cell,
              });
            };
            return (
              <ValueCell
                valueRub={(row.contract_type === 'Fix' ? cell.forecast_rub : cell.fact_rub) * fxFactor}
                valueHours={cell.fact_hours}
                onOpen={handleOpen}
                ariaLabel={`Открыть ${row.project_name ?? 'проект'} за ${formatMonthLabel(month)} (факт)`}
              />
            );
          },
        },
      ],
    });
  });

  return [...base, ...monthColumns];
};

export default function PlanFactGrid({
  clients,
  months,
  focusMonth,
  onFocusMonthChange,
  onOpenDrawer,
}: Props): ReactElement {
  const [tableFilters, setTableFilters] = useState<Record<string, FilterValue | null>>({});
  const fxRates = useFxStore((state) => state.rates);
  const getFxFactor = (month: string): number => {
    const item = fxRates[month];
    if (!item || !item.base) {
      return 1;
    }
    return item.rate / item.base;
  };
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

  const rows = useMemo((): RowItem[] => toRows(clients, months), [clients, months]);
  const clientFilters = useMemo(
    () =>
      Array.from(
        new Set(clients.map((client) => client.client_name)),
      ).map((name) => ({ text: name, value: name })),
    [clients],
  );

  const normalizedFilters = useMemo((): {
    selectedClients: string[];
    selectedTypes: string[];
    hasAllTypes: boolean;
  } => {
    const normalize = (value: FilterValue | null | undefined): string[] =>
      Array.isArray(value) ? value.map((item) => String(item)) : [];
    const selectedClients = normalize(tableFilters.client_name);
    const selectedTypes = normalize(tableFilters.project_name);
    const hasAllTypes = selectedTypes.includes('all');
    return { selectedClients, selectedTypes, hasAllTypes };
  }, [tableFilters]);

  const filteredRows = useMemo((): RowItem[] => {
    const { selectedClients, selectedTypes, hasAllTypes } = normalizedFilters;
    return rows.filter((row) => {
      const matchClient = selectedClients.length === 0 || selectedClients.includes(row.client_name);
      const matchType =
        selectedTypes.length === 0 || hasAllTypes || selectedTypes.includes(row.contract_type);
      return matchClient && matchType;
    });
  }, [rows, normalizedFilters]);

  const hasActiveFilters =
    normalizedFilters.selectedClients.length > 0 ||
    (normalizedFilters.selectedTypes.length > 0 && !normalizedFilters.hasAllTypes);

  const totalsByMonth = useMemo(
    (): Record<string, PlanFactMonthCell> =>
      buildTotalsFromRows(hasActiveFilters ? filteredRows : rows, months),
    [filteredRows, rows, months, hasActiveFilters],
  );

  useEffect((): void => {
    setPinnedMonths((prev) => {
      let next = prev.filter((month) => months.includes(month));
      if (next.length === 0) {
        next = [focusMonth];
      }
      while (next.length > 3) {
        next.shift();
      }
      return next;
    });
  }, [focusMonth, months]);

  useEffect((): void => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedMonths));
  }, [pinnedMonths]);

  const handleTogglePin = (month: string): void => {
    setPinnedMonths((prev) => {
      const isPinned = prev.includes(month);
      if (isPinned) {
        return prev.filter((item) => item !== month);
      }
      const next = [...prev, month];
      if (!next.includes(focusMonth)) {
        next.push(focusMonth);
      }
      while (next.length > 3) {
        next.shift();
      }
      return next;
    });
  };

  if (rows.length === 0) {
    return <Typography.Text type="secondary">Нет данных для отображения.</Typography.Text>;
  }
  const monthWidth = MONTH_COL_WIDTH * 2;
  const scrollX = BASE_FIXED_WIDTH + months.length * monthWidth;
  const summaryLabelColSpan = 3;

  return (
    <Table
      size="small"
      pagination={false}
      dataSource={filteredRows}
      columns={buildColumns(
        months,
        focusMonth,
        onFocusMonthChange,
        onOpenDrawer,
        clientFilters,
        pinnedMonths,
        handleTogglePin,
        getFxFactor,
      )}
      rowClassName={(): string => 'finops-row-project'}
      scroll={{ x: scrollX }}
      sticky
      tableLayout="fixed"
      onChange={(_, filters): void => setTableFilters(filters)}
      className="finops-table"
      summary={(): ReactElement => {
        const firstCellIndex = 0;
        let cellIndex = summaryLabelColSpan;
        const pinnedSet = new Set(pinnedMonths);
        const summaryMonths = [
          ...months.filter((month) => pinnedSet.has(month)),
          ...months.filter((month) => !pinnedSet.has(month)),
        ];
        const pinnedOrdered = summaryMonths.filter((month) => pinnedSet.has(month));
        const pinnedIndexMap = new Map(pinnedOrdered.map((month, index) => [month, index]));
        const baseLeft = BASE_FIXED_WIDTH;
        return (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row className="finops-summary-row">
              <SummaryCell
                index={firstCellIndex}
                colSpan={summaryLabelColSpan}
                className="finops-summary-fixed"
                style={{ left: 0, zIndex: 6, background: '#ffffff' }}
              >
                <Typography.Text strong>ИТОГО</Typography.Text>
              </SummaryCell>
              {summaryMonths.flatMap((month: string): ReactElement[] => {
                const cell = totalsByMonth[month] ?? emptyCell();
                const fxFactor = getFxFactor(month);
                const isPinned = pinnedSet.has(month);
                const isHighlighted = month === focusMonth || isPinned;
                const focusLeftClass = isHighlighted ? 'finops-focus-left' : '';
                const focusRightClass = isHighlighted ? 'finops-focus-right' : '';
                const pinnedIndex = pinnedIndexMap.get(month);
                const monthLeft =
                  typeof pinnedIndex === 'number' ? baseLeft + pinnedIndex * monthWidth : null;
                const forecastStyle =
                  isPinned && monthLeft !== null
                    ? ({ left: `${monthLeft}px`, zIndex: 5, background: '#ffffff' } as CSSProperties)
                    : undefined;
                const factStyle =
                  isPinned && monthLeft !== null
                    ? ({ left: `${monthLeft + MONTH_COL_WIDTH}px`, zIndex: 5, background: '#ffffff' } as CSSProperties)
                    : undefined;
                const forecastContent = (
                  <div className="finops-cell-text">
                    <div className={cell.forecast_rub ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-400'}>
                      {cell.forecast_rub ? formatCurrency(cell.forecast_rub * fxFactor) : '—'}
                    </div>
                    <div className={cell.forecast_hours ? 'text-[10px] text-slate-500' : 'text-[10px] text-slate-400'}>
                      {cell.forecast_hours ? formatHours(cell.forecast_hours) : '—'}
                    </div>
                  </div>
                );
                const factContent = (
                  <div className="finops-cell-text">
                    <div className={cell.fact_rub ? 'text-xs font-semibold text-slate-900' : 'text-xs font-semibold text-slate-400'}>
                      {cell.fact_rub ? formatCurrency(cell.fact_rub * fxFactor) : '—'}
                    </div>
                    <div className={cell.fact_hours ? 'text-[10px] text-slate-500' : 'text-[10px] text-slate-400'}>
                      {cell.fact_hours ? formatHours(cell.fact_hours) : '—'}
                    </div>
                  </div>
                );
                const factCell = (
                  <SummaryCell
                    key={`${month}-fact`}
                    index={cellIndex++}
                    className={`${isPinned ? 'finops-summary-fixed' : ''} finops-value-col ${focusRightClass}`.trim()}
                    style={factStyle}
                  >
                    {factContent}
                  </SummaryCell>
                );
                const forecastCell = (
                  <SummaryCell
                    key={`${month}-forecast`}
                    index={cellIndex++}
                    className={`${isPinned ? 'finops-summary-fixed' : ''} finops-value-col ${focusLeftClass}`.trim()}
                    style={forecastStyle}
                  >
                    {forecastContent}
                  </SummaryCell>
                );
                return [forecastCell, factCell];
              })}
            </Table.Summary.Row>
          </Table.Summary>
        );
      }}
    />
  );
}
