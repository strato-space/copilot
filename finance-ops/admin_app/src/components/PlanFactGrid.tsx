import { Button, Table, Tag, Tooltip, Typography } from 'antd';
import { EditOutlined, EllipsisOutlined, FilterOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FilterValue } from 'antd/es/table/interface';
import { type ReactElement, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type PlanFactCellContext,
  type PlanFactClientRow,
  type PlanFactMonthCell,
  type PlanFactProjectRow,
} from '../services/types';
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

const emptyCell = (): PlanFactMonthCell => ({
  fact_rub: 0,
  fact_hours: 0,
  forecast_rub: 0,
  forecast_hours: 0,
});

const normalizeMonths = (
  months: Record<string, PlanFactMonthCell>,
  range: string[],
): Record<string, PlanFactMonthCell> => {
  const normalized: Record<string, PlanFactMonthCell> = {};
  range.forEach((month: string): void => {
    normalized[month] = months[month] ?? emptyCell();
  });
  return normalized;
};

const toRows = (clients: PlanFactClientRow[], months: string[]): RowItem[] => {
  const rows: RowItem[] = [];

  clients.forEach((client: PlanFactClientRow): void => {
    client.projects.forEach((project: PlanFactProjectRow): void => {
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
        months: normalizeMonths(project.months, months),
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
      const cell = row.months[month] ?? emptyCell();
      const current = totals[month] ?? emptyCell();
      totals[month] = {
        fact_rub: current.fact_rub + cell.fact_rub,
        fact_hours: current.fact_hours + cell.fact_hours,
        forecast_rub: current.forecast_rub + cell.forecast_rub,
        forecast_hours: current.forecast_hours + cell.forecast_hours,
      };
    });
  });
  return totals;
};

const abbreviateClient = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join('');
  const base = initials.length >= 2 ? initials : name.replace(/[^A-Za-zА-Яа-я0-9]/g, '');
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
      <div className={hasValue ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-slate-400'}>
        {hasValue ? formatCurrency(valueRub) : '—'}
      </div>
      <div className={hasValue ? 'text-xs text-slate-500' : 'text-xs text-slate-400'}>
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
): ColumnsType<RowItem> => {
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
      render: (value: string, row: RowItem): ReactElement => (
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
          <div className="text-sm font-semibold uppercase text-slate-900">
            {value}
          </div>
          {row.subproject_name ? (
            <div className="text-xs uppercase text-slate-500">{row.subproject_name}</div>
          ) : null}
          <Tag className="mt-2" color={row.contract_type === 'Fix' ? 'volcano' : 'cyan'}>
            {row.contract_type ?? '—'}
          </Tag>
        </div>
      ),
      width: 220,
      fixed: 'left',
    },
    {
      title: '',
      key: 'actions',
      width: 48,
      fixed: 'left',
      className: 'finops-actions-col',
      onHeaderCell: (): { className: string } => ({ className: 'finops-actions-col' }),
      render: (_: unknown, row: RowItem): ReactElement => (
        <div className="flex items-start justify-end">
          <Tooltip title="Редактировать проект">
            <Link
              to={`/projects/${row.project_id ?? ''}`}
              className="finops-row-action"
              aria-label="Редактировать проект"
            >
              <Button
                type="text"
                size="small"
                icon={<EllipsisOutlined />}
                className="text-slate-400 hover:text-slate-900"
              />
            </Link>
          </Tooltip>
        </div>
      ),
    },
  ];

  const monthColumns = months.map((month: string): ColumnsType<RowItem>[number] => {
    const isFocus = month === focusMonth;
    const focusLeftClass = isFocus ? 'finops-focus-left' : '';
    const focusRightClass = isFocus ? 'finops-focus-right' : '';
    return ({
      title: (
        <button
          type="button"
          onClick={(): void => onFocusMonthChange(month)}
          className="finops-month-button flex flex-col items-start text-left text-slate-700 bg-transparent border-0 p-0 m-0 shadow-none rounded-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
        >
          <span className="font-semibold flex items-center gap-1">
            {formatMonthLabel(month)}
          </span>
        </button>
      ),
      className: isFocus ? 'finops-focus-group' : '',
      onHeaderCell: (): { className: string } => ({ className: isFocus ? 'finops-focus-group' : '' }),
      key: month,
      children: [
        {
          title: <span className="finops-subhead">Прогноз</span>,
          key: `${month}-forecast`,
          width: 140,
          align: 'left',
          className: `finops-value-col ${focusLeftClass}`.trim(),
          onHeaderCell: (): { className: string } => ({ className: `finops-value-col ${focusLeftClass}`.trim() }),
          render: (_: unknown, row: RowItem): ReactElement => {
            const cell = row.months[month] ?? emptyCell();
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
                values: cell,
              });
            };
            return (
              <ValueCell
                valueRub={cell.forecast_rub}
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
          width: 140,
          align: 'left',
          className: `finops-value-col ${focusRightClass}`.trim(),
          onHeaderCell: (): { className: string } => ({ className: `finops-value-col ${focusRightClass}`.trim() }),
          render: (_: unknown, row: RowItem): ReactElement => {
            const cell = row.months[month] ?? emptyCell();
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
                values: cell,
              });
            };
            return (
              <ValueCell
                valueRub={cell.fact_rub}
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

  const rows = useMemo((): RowItem[] => toRows(clients, months), [clients, months]);
  const clientFilters = useMemo(
    () =>
      Array.from(
        new Set(clients.map((client) => client.client_name)),
      ).map((name) => ({ text: name, value: name })),
    [clients],
  );

  const filteredRows = useMemo((): RowItem[] => {
    const normalize = (value: FilterValue | null | undefined): string[] =>
      Array.isArray(value) ? value.map((item) => String(item)) : [];
    const selectedClients = normalize(tableFilters.client_name);
    const selectedTypes = normalize(tableFilters.project_name);
    const hasAll = selectedTypes.includes('all');

    return rows.filter((row) => {
      const matchClient = selectedClients.length === 0 || selectedClients.includes(row.client_name);
      const matchType =
        selectedTypes.length === 0 || hasAll || selectedTypes.includes(row.contract_type);
      return matchClient && matchType;
    });
  }, [rows, tableFilters]);

  const totalsByMonth = useMemo(
    (): Record<string, PlanFactMonthCell> => buildTotalsFromRows(filteredRows, months),
    [filteredRows, months],
  );

  if (rows.length === 0) {
    return <Typography.Text type="secondary">Нет данных для отображения.</Typography.Text>;
  }
  const scrollX = 320 + months.length * 280;
  const summaryLabelColSpan = 3;

  return (
    <Table
      size="small"
      pagination={false}
      dataSource={rows}
      columns={buildColumns(months, focusMonth, onFocusMonthChange, onOpenDrawer, clientFilters)}
      rowClassName={(): string => 'finops-row-project'}
      scroll={{ x: scrollX }}
      sticky
      onChange={(_, filters): void => setTableFilters(filters)}
      className="finops-table"
      summary={(): ReactElement => {
        const firstCellIndex = 0;
        let cellIndex = summaryLabelColSpan;
        return (
          <Table.Summary fixed="bottom">
            <Table.Summary.Row className="finops-summary-row">
              <Table.Summary.Cell index={firstCellIndex} colSpan={summaryLabelColSpan}>
                <Typography.Text strong>ИТОГО</Typography.Text>
              </Table.Summary.Cell>
            {months.flatMap((month: string): ReactElement[] => {
              const cell = totalsByMonth[month] ?? emptyCell();
              const isFocus = month === focusMonth;
              const focusLeftClass = isFocus ? 'finops-focus-left' : '';
              const focusRightClass = isFocus ? 'finops-focus-right' : '';
              const factCell = (
                <Table.Summary.Cell
                  key={`${month}-fact`}
                  index={cellIndex++}
                  className={`finops-value-col ${focusRightClass}`.trim()}
                >
                  <div className="finops-cell-text">
                    <div className={cell.fact_rub ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-slate-400'}>
                      {cell.fact_rub ? formatCurrency(cell.fact_rub) : '—'}
                    </div>
                    <div className={cell.fact_hours ? 'text-xs text-slate-500' : 'text-xs text-slate-400'}>
                      {cell.fact_hours ? formatHours(cell.fact_hours) : '—'}
                    </div>
                  </div>
                </Table.Summary.Cell>
              );
              const forecastCell = (
                <Table.Summary.Cell
                  key={`${month}-forecast`}
                  index={cellIndex++}
                  className={`finops-value-col ${focusLeftClass}`.trim()}
                >
                  <div className="finops-cell-text">
                    <div className={cell.forecast_rub ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-slate-400'}>
                      {cell.forecast_rub ? formatCurrency(cell.forecast_rub) : '—'}
                    </div>
                    <div className={cell.forecast_hours ? 'text-xs text-slate-500' : 'text-xs text-slate-400'}>
                      {cell.forecast_hours ? formatHours(cell.forecast_hours) : '—'}
                    </div>
                  </div>
                </Table.Summary.Cell>
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
