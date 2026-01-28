import { Alert, Button, Card, Input, Select, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';

interface GuideAgent {
  agent_id?: string;
  name?: string;
  scope?: string[];
  description?: string;
  is_active?: boolean;
  status?: string;
}

interface AgentRow {
  key: string;
  name: string;
  scope: string;
  status: string;
  description: string;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'draft';

const buildStatusTag = (status: string): ReactElement => {
  if (status === 'active') {
    return <Tag color="green">active</Tag>;
  }
  if (status === 'inactive') {
    return <Tag color="default">inactive</Tag>;
  }
  return <Tag color="orange">draft</Tag>;
};

export default function AgentsPage(): ReactElement {
  const fetchDirectory = useGuideStore((state) => state.fetchDirectory);
  const agentsDirectory = useGuideStore((state) => state.directories.agents);
  const loadingAgents = useGuideStore((state) => state.directoryLoading.agents);
  const errorAgents = useGuideStore((state) => state.directoryError.agents);

  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect((): void => {
    void fetchDirectory('agents');
  }, [fetchDirectory]);

  const query = search.trim().toLowerCase();

  const rows = useMemo((): AgentRow[] => {
    const items = (agentsDirectory?.items ?? []) as GuideAgent[];
    return items
      .filter((agent) => {
        const status = agent.status ?? (agent.is_active === false ? 'inactive' : 'active');
        if (statusFilter !== 'all' && status !== statusFilter) {
          return false;
        }
        if (!query) {
          return true;
        }
        return [agent.name, agent.description, agent.scope?.join(' ')].some((value) =>
          value ? value.toLowerCase().includes(query) : false,
        );
      })
      .map((agent, index) => {
        const id = agent.agent_id ?? `agent-${index}`;
        const status = agent.status ?? (agent.is_active === false ? 'inactive' : 'active');
        return {
          key: id,
          name: agent.name ?? '—',
          scope: agent.scope?.length ? agent.scope.join(', ') : '—',
          status,
          description: agent.description ?? '—',
        };
      });
  }, [agentsDirectory?.items, query, statusFilter]);

  const loading = Boolean(loadingAgents);

  return (
    <div className="finops-page animate-fade-up">
      <PageHeader
        title="Агенты"
        description="Read‑only каталог автоматизаций и правил."
        actions={(
          <div className="flex items-center gap-2">
            <Button icon={<ReloadOutlined />} onClick={(): void => void fetchDirectory('agents')}>
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
            placeholder="Поиск по названию / описанию"
            value={search}
            onChange={(event): void => setSearch(event.target.value)}
            className="min-w-[220px] flex-1"
          />
          <Select
            value={statusFilter}
            onChange={(value): void => setStatusFilter(value)}
            options={[
              { label: 'Все статусы', value: 'all' },
              { label: 'Active', value: 'active' },
              { label: 'Inactive', value: 'inactive' },
              { label: 'Draft', value: 'draft' },
            ]}
            className="w-[160px]"
          />
        </div>
      </Card>
      {errorAgents ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить агентов"
          description={errorAgents}
        />
      ) : null}
      <Card loading={loading}>
        <div className="flex items-center justify-between mb-3">
          <Typography.Text strong>Список агентов</Typography.Text>
          <GuideSourceTag source={agentsDirectory?.source ?? 'unknown'} />
        </div>
        <Table
          size="small"
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: 'Нет данных' }}
          columns={[
            { title: 'Название', dataIndex: 'name', key: 'name' },
            { title: 'Scope', dataIndex: 'scope', key: 'scope' },
            {
              title: 'Статус',
              dataIndex: 'status',
              key: 'status',
              render: (value: string): ReactElement => buildStatusTag(value),
            },
            { title: 'Описание', dataIndex: 'description', key: 'description' },
          ]}
        />
      </Card>
    </div>
  );
}
