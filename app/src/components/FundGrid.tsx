import { Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useEffect, useMemo } from 'react';
import { useFundStore } from '../store/fundStore';
import { formatCurrency, formatMonthLabel } from '../utils/format';

interface FundRow {
  key: string;
  month: string;
  amount?: number;
  delta?: number;
}

interface Props {
  months: string[];
  fundDeltaByMonth: Record<string, number | undefined>;
}

const START_FUND = 1827127;
const DECEMBER_DELTA = 53023;
const FUND_START_MONTH = '2025-11';
const FUND_DEC_MONTH = '2025-12';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const FundGrid = ({ months, fundDeltaByMonth }: Props): ReactElement => {
  const { commentsByMonth, fetchComments, updateComment } = useFundStore();
  const fundMonths = useMemo(() => {
    const set = new Set<string>([FUND_START_MONTH, FUND_DEC_MONTH, ...months]);
    // YYYY-MM sorts lexicographically in chronological order.
    return Array.from(set).sort();
  }, [months]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  const data = useMemo((): FundRow[] => {
    let runningBalance: number | undefined;

    return fundMonths.map((month): FundRow => {
      // "delta" is how much fund changed in that month.
      // We always show a stable "amount" as the running balance.
      let delta: number | undefined = fundDeltaByMonth[month];

      // Pre-2026 months are seeded, not derived from income/expenses.
      if (month === FUND_START_MONTH) {
        runningBalance = START_FUND;
        delta = undefined;
      } else if (month === FUND_DEC_MONTH) {
        runningBalance = START_FUND + DECEMBER_DELTA;
        delta = DECEMBER_DELTA;
      } else {
        if (!isFiniteNumber(runningBalance)) {
          // Safety: if seed rows were removed somehow, fall back to start.
          runningBalance = START_FUND + DECEMBER_DELTA;
        }

        if (isFiniteNumber(delta)) {
          runningBalance = runningBalance + delta;
        }
      }

      const shouldShowAmount =
        month === FUND_START_MONTH || month === FUND_DEC_MONTH || isFiniteNumber(delta);

      const row: FundRow = {
        key: month,
        month,
      };
      if (shouldShowAmount && isFiniteNumber(runningBalance)) {
        row.amount = runningBalance;
      }
      if (isFiniteNumber(delta)) {
        row.delta = delta;
      }
      return row;
    });
  }, [fundMonths, fundDeltaByMonth]);

  const columns: ColumnsType<FundRow> = [
    {
      title: 'Месяц',
      dataIndex: 'month',
      key: 'month',
      render: (value: string): ReactElement => (
        <span className="text-sm font-semibold text-slate-900">{formatMonthLabel(value)}</span>
      ),
      width: 200,
    },
    {
      title: 'Фонд, ₽',
      dataIndex: 'amount',
      key: 'amount',
      render: (value?: number): ReactElement => {
        const text = isFiniteNumber(value) ? formatCurrency(value) : '—';
        return <span className="text-sm text-slate-900">{text}</span>;
      },
    },
    {
      title: '+ За месяц',
      dataIndex: 'delta',
      key: 'delta',
      render: (value?: number): ReactElement => {
        const text = isFiniteNumber(value) ? formatCurrency(value) : '—';
        return <span className="text-sm text-slate-500">{text}</span>;
      },
      width: 220,
    },
    {
      title: 'Комментарий',
      key: 'comment',
      render: (_: unknown, record: FundRow): ReactElement => {
        const commentValue = commentsByMonth[record.month] ?? '';
        const display = commentValue.trim() ? commentValue : '—';

        return (
          <Typography.Text
            className="text-sm text-slate-500"
            editable={{
              text: commentValue,
              onChange: (next) => updateComment(record.month, next),
              tooltip: 'Добавить комментарий',
            }}
          >
            {display}
          </Typography.Text>
        );
      },
      width: 260,
    },
  ];

  return (
    <Table
      rowKey="key"
      columns={columns}
      dataSource={data}
      pagination={false}
      size="middle"
    />
  );
};

export default FundGrid;
