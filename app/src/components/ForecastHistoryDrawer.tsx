import { Drawer, Empty, Skeleton, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../services/api';
import {
  type ForecastHistoryEntry,
  type ForecastHistoryResponse,
  type PlanFactCellContext,
} from '../services/types';
import { formatCurrency, formatHours, formatMonthLabel } from '../utils/format';

interface Props {
  open: boolean;
  context: PlanFactCellContext | null;
  forecastVersionId: string;
  onClose: () => void;
}

const formatDelta = (value: number): string => {
  if (value === 0) {
    return '0';
  }
  return `${value > 0 ? '+' : ''}${value}`;
};

export default function ForecastHistoryDrawer({
  open,
  context,
  forecastVersionId,
  onClose,
}: Props): ReactElement {
  const [entries, setEntries] = useState<ForecastHistoryEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect((): (() => void) | void => {
    if (!open || !context) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const loadHistory = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.get<{
          data: ForecastHistoryResponse;
          error: { message: string } | null;
        }>('/plan-fact/forecast-history', {
          params: {
            project_id: context.project_id,
            month: context.month,
            forecast_version_id: forecastVersionId,
          },
        });
        if (cancelled) {
          return;
        }
        setEntries(response.data.data?.entries ?? []);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setEntries([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [open, context, forecastVersionId]);

  const timelineEntries = useMemo(
    () =>
      entries.map((entry, index) => {
        const previous = entries[index + 1] ?? null;
        const hoursDelta = previous ? entry.forecast_hours - previous.forecast_hours : null;
        const amountDelta = previous ? entry.forecast_amount_rub - previous.forecast_amount_rub : null;

        return {
          ...entry,
          hoursDelta,
          amountDelta,
        };
      }),
    [entries],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      destroyOnClose={false}
      title={
        <div className="space-y-1">
          <Typography.Text strong>История прогноза</Typography.Text>
          <div className="text-xs text-slate-500">
            {context?.project_name ?? 'Проект'} • {context ? formatMonthLabel(context.month) : ''}
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton active paragraph={{ rows: 3 }} />
          <Skeleton active paragraph={{ rows: 3 }} />
        </div>
      ) : null}

      {!loading && error ? (
        <Typography.Text type="danger">
          Не удалось загрузить лог прогноза: {error}
        </Typography.Text>
      ) : null}

      {!loading && !error && timelineEntries.length === 0 ? (
        <Empty description="История изменений пока пуста" />
      ) : null}

      {!loading && !error && timelineEntries.length > 0 ? (
        <div className="space-y-3">
          {timelineEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Tag color="blue" className="!m-0">
                  rev {entry.row_version}
                </Tag>
                <Tag color={entry.contract_type === 'Fix' ? 'volcano' : 'cyan'} className="!m-0">
                  {entry.contract_type}
                </Tag>
                <Typography.Text type="secondary" className="text-xs">
                  {dayjs(entry.changed_at).isValid()
                    ? dayjs(entry.changed_at).format('DD.MM.YYYY HH:mm:ss')
                    : 'Дата неизвестна'}
                </Typography.Text>
              </div>

              <div className="mt-3 flex flex-wrap gap-4">
                <div>
                  <Typography.Text type="secondary" className="block text-xs">
                    Сумма
                  </Typography.Text>
                  <Typography.Text strong>{formatCurrency(entry.forecast_amount_rub)}</Typography.Text>
                  {typeof entry.amountDelta === 'number' ? (
                    <Typography.Text className="ml-2 text-xs text-slate-500">
                      {formatDelta(entry.amountDelta)}
                    </Typography.Text>
                  ) : null}
                </div>
                <div>
                  <Typography.Text type="secondary" className="block text-xs">
                    Часы
                  </Typography.Text>
                  <Typography.Text strong>{formatHours(entry.forecast_hours)}</Typography.Text>
                  {typeof entry.hoursDelta === 'number' ? (
                    <Typography.Text className="ml-2 text-xs text-slate-500">
                      {formatDelta(entry.hoursDelta)}
                    </Typography.Text>
                  ) : null}
                </div>
              </div>

              <div className="mt-3">
                <Typography.Text type="secondary" className="block text-xs">
                  Комментарий
                </Typography.Text>
                <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-sm text-slate-700">
                  {entry.comment?.trim() ? entry.comment : 'Без комментария'}
                </Typography.Paragraph>
              </div>

              <div className="mt-3">
                <Space size={12} wrap>
                  <Typography.Text type="secondary" className="text-xs">
                    Кто: {entry.changed_by ?? 'ui'}
                  </Typography.Text>
                  <Typography.Text type="secondary" className="text-xs">
                    Источник: {entry.changed_source ?? 'user'}
                  </Typography.Text>
                </Space>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Drawer>
  );
}
