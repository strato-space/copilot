import { Alert, Button, Card, Input, Select, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';

interface GuideFxRow {
  month?: string;
  currency?: string;
  fx_avg?: number;
  fx_manual?: number;
  fx_forecast?: number;
  manual_override?: boolean;
}

interface FxRow {
  key: string;
  month: string;
  currency: string;
  fxAvg: string;
  fxManual: string;
  manualOverride: boolean;
}

type OverrideFilter = 'all' | 'manual' | 'auto';

const buildOverrideTag = (value: boolean): ReactElement => (
  <Tag color={value ? 'orange' : 'default'}>{value ? 'Yes' : 'No'}</Tag>
);

export default function FxPage(): ReactElement {
  const fetchDirectory = useGuideStore((state) => state.fetchDirectory);
  const fxDirectory = useGuideStore((state) => state.directories.fx);
  const loadingFx = useGuideStore((state) => state.directoryLoading.fx);
  const errorFx = useGuideStore((state) => state.directoryError.fx);

  const [search, setSearch] = useState<string>('');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [overrideFilter, setOverrideFilter] = useState<OverrideFilter>('all');

  useEffect((): void => {
    void fetchDirectory('fx');
  }, [fetchDirectory]);

  const items = (fxDirectory?.items ?? []) as GuideFxRow[];
  const currencies = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.currency) {
        set.add(item.currency);
      }
    });
    return Array.from(set);
  }, [items]);

  const query = search.trim().toLowerCase();

  const fxRows = useMemo((): FxRow[] => {
    return items
      .filter((item) => {
        if (currencyFilter !== 'all' && item.currency !== currencyFilter) {
          return false;
        }
        if (overrideFilter === 'manual' && !item.manual_override) {
          return false;
        }
        if (overrideFilter === 'auto' && item.manual_override) {
          return false;
        }
        if (query && !(item.month ?? '').toLowerCase().includes(query)) {
          return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => (a.month ?? '').localeCompare(b.month ?? ''))
      .map((item, index) => ({
        key: `${item.month ?? 'month'}-${index}`,
        month: item.month ?? '—',
        currency: item.currency ?? 'USD',
        fxAvg: item.fx_avg != null ? item.fx_avg.toFixed(2) : '—',
        fxManual: item.fx_manual != null ? item.fx_manual.toFixed(2) : '—',
        manualOverride: Boolean(item.manual_override),
      }));
  }, [items, currencyFilter, overrideFilter, query]);

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="FX"
        description="Read‑only курсы валют и ручные корректировки."
        actions={(
          <div className="flex items-center gap-2">
            <Button icon={<ReloadOutlined />} onClick={(): void => void fetchDirectory('fx')}>
              Обновить данные
            </Button>
            <Button type="link">
              <Link to="/guide">← Назад к Guide</Link>
            </Button>
          </div>
        )}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск по месяцу"
            value={search}
            onChange={(event): void => setSearch(event.target.value)}
            className="min-w-[160px]"
          />
          <Select
            value={currencyFilter}
            onChange={(value): void => setCurrencyFilter(value)}
            options={[
              { label: 'Все валюты', value: 'all' },
              ...currencies.map((currency) => ({ label: currency, value: currency })),
            ]}
            className="w-[160px]"
          />
          <Select
            value={overrideFilter}
            onChange={(value): void => setOverrideFilter(value)}
            options={[
              { label: 'Все', value: 'all' },
              { label: 'Manual override', value: 'manual' },
              { label: 'Без override', value: 'auto' },
            ]}
            className="w-[180px]"
          />
        </div>
      </Card>
      {errorFx ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить FX"
          description={errorFx}
        />
      ) : null}
      <Card loading={Boolean(loadingFx)}>
        <div className="flex items-center justify-between mb-3">
          <Typography.Text strong>Курсы валют</Typography.Text>
          <GuideSourceTag source={fxDirectory?.source ?? 'unknown'} />
        </div>
        <Table
          size="small"
          pagination={false}
          dataSource={fxRows}
          locale={{ emptyText: 'Нет данных' }}
          columns={[
            { title: 'Месяц', dataIndex: 'month', key: 'month' },
            { title: 'Валюта', dataIndex: 'currency', key: 'currency' },
            { title: 'FX avg', dataIndex: 'fxAvg', key: 'fxAvg' },
            { title: 'FX manual', dataIndex: 'fxManual', key: 'fxManual' },
            {
              title: 'Manual override',
              dataIndex: 'manualOverride',
              key: 'manualOverride',
              render: (value: boolean): ReactElement => buildOverrideTag(value),
            },
          ]}
        />
      </Card>
    </div>
  );
}
