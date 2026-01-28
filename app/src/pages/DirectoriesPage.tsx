import { Alert, Button, Drawer, Table, Tag, Typography } from 'antd';
import { ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import GuideSourceTag from '../components/GuideSourceTag';
import { DIRECTORY_GROUPS } from '../services/guideDirectoryConfig';
import { type GuideSource, useGuideStore } from '../store/guideStore';

const uniqueSources = (sources: Array<GuideSource | undefined>): GuideSource[] => {
  const set = new Set<GuideSource>();
  sources.forEach((source) => {
    if (source) {
      set.add(source);
    }
  });
  return Array.from(set);
};

const LOG_ITEMS = [
  {
    id: 'log-1',
    date: '28.01.26',
    module: 'Guides',
    text: 'Проекты: ставка Acme Mobile App → 3500 ₽/ч',
  },
  {
    id: 'log-2',
    date: '27.01.26',
    module: 'Guides',
    text: 'Клиенты: добавлен Orion Studio',
  },
  {
    id: 'log-3',
    date: '27.01.26',
    module: 'FinOps',
    text: 'FX / Expense / Income: обновлены категории расходов',
  },
];

export default function DirectoriesPage(): ReactElement {
  const navigate = useNavigate();
  const index = useGuideStore((state) => state.index);
  const indexLoading = useGuideStore((state) => state.indexLoading);
  const indexError = useGuideStore((state) => state.indexError);
  const directories = useGuideStore((state) => state.directories);
  const fetchIndex = useGuideStore((state) => state.fetchIndex);
  const fetchDirectory = useGuideStore((state) => state.fetchDirectory);
  const [showIndexError, setShowIndexError] = useState<boolean>(false);
  const [logOpen, setLogOpen] = useState<boolean>(false);

  useEffect((): void => {
    void fetchIndex();
  }, [fetchIndex]);

  useEffect((): void => {
    DIRECTORY_GROUPS.forEach((group) => {
      group.directories.forEach((dir) => void fetchDirectory(dir.name));
    });
  }, [fetchDirectory]);

  const indexMap = useMemo(() => new Map(index.map((item) => [item.name, item])), [index]);

  const rows = useMemo(() => {
    return DIRECTORY_GROUPS.map((group) => {
      const counts = group.directories.map((dir) => {
        const indexItem = indexMap.get(dir.name);
        const total = indexItem?.count ?? directories[dir.name]?.items?.length ?? 0;
        return { name: dir.name, label: dir.label, count: total };
      });
      const totalCount = counts.reduce((sum, item) => sum + item.count, 0);
      const sources = uniqueSources(group.directories.map((dir) => indexMap.get(dir.name)?.source ?? directories[dir.name]?.source));
      return {
        key: group.key,
        title: group.title,
        module: group.module,
        description: group.description,
        counts,
        totalCount,
        sources,
      };
    });
  }, [directories, indexMap]);

  const moduleOptions = useMemo(() => {
    const values = new Set<string>();
    DIRECTORY_GROUPS.forEach((group) => values.add(group.module));
    return Array.from(values);
  }, []);

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Guide"
        description="Общие справочники и настройки, используемые всеми разделами OPS."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button
              icon={<ReloadOutlined />}
              onClick={(): void => {
                setShowIndexError(false);
                void fetchIndex();
                DIRECTORY_GROUPS.forEach((group) => {
                  group.directories.forEach((dir) => void fetchDirectory(dir.name));
                });
              }}
            >
              Import
            </Button>
            <Button
              onClick={(): void => {
                setShowIndexError(true);
                void fetchIndex();
              }}
            >
              Обновить
            </Button>
            <Button disabled>Export</Button>
            <Button onClick={(): void => setLogOpen(true)}>Log</Button>
          </div>
        )}
      />

      {showIndexError && indexError ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить список справочников"
          description={indexError}
        />
      ) : null}

      <Table
        size="small"
        pagination={false}
        dataSource={rows}
        rowKey="key"
        loading={indexLoading}
        sticky
        onRow={(record) => ({
          onClick: (): void => {
            void navigate(`/guide/${record.key}`);
          },
          style: { cursor: 'pointer' },
        })}
        columns={[
          {
            title: <div style={{ paddingLeft: 12 }}>Модуль</div>,
            dataIndex: 'module',
            key: 'module',
            filters: moduleOptions.map((value) => ({ text: value, value })),
            filterMultiple: true,
            onFilter: (value, record) => record.module === value,
            render: (value: string) => (
              <div style={{ paddingLeft: 12 }}>{value}</div>
            ),
          },
          {
            title: 'Справочник',
            dataIndex: 'title',
            key: 'title',
            render: (_: string, row) => (
              <div>
                <Typography.Text strong>{row.title}</Typography.Text>
                <div className="text-xs text-slate-500">{row.description}</div>
              </div>
            ),
          },
          {
            title: 'Источник',
            dataIndex: 'sources',
            key: 'sources',
            render: (sources: GuideSource[]) => (
              <div className="flex flex-wrap gap-1">
                {sources.length > 0
                  ? sources.map((source) => <GuideSourceTag key={source} source={source} />)
                  : <GuideSourceTag source="unknown" />}
              </div>
            ),
          },
          {
            title: 'Записей',
            dataIndex: 'totalCount',
            key: 'totalCount',
            render: (_: number, row) => (
              <div>
                <Tag>{row.totalCount}</Tag>
                <div className="text-xs text-slate-500">
                  {row.counts.map((item) => `${item.label}: ${item.count}`).join(' • ')}
                </div>
              </div>
            ),
          },
          {
            title: 'Статус',
            key: 'status',
            render: () => <Tag color="blue">read-only</Tag>,
          },
          {
            title: '',
            key: 'arrow',
            width: 48,
            render: (_: unknown, row) => (
              <Link to={`/guide/${row.key}`} aria-label="Открыть справочник">
                <RightOutlined />
              </Link>
            ),
          },
        ]}
      />
      <Drawer
        open={logOpen}
        width={420}
        onClose={(): void => setLogOpen(false)}
        title="Log"
      >
        <Typography.Text type="secondary">Журнал изменений по всем справочникам.</Typography.Text>
        <div className="mt-4 space-y-3">
          {LOG_ITEMS.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-100 p-3 text-sm">
              <div className="text-xs text-slate-500 mb-1">
                {item.date} · {item.module}
              </div>
              <div>{item.text}</div>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
