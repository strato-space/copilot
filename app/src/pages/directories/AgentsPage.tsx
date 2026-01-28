import { Alert, Button, Card, Dropdown, Input, Select, Switch, Table, Typography } from 'antd';
import { MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';

interface GuideAgent {
  agent_id?: string;
  name?: string;
  scope?: string[];
  module?: string | string[];
  type?: string;
  prompt?: string;
  trigger?: string;
  description?: string;
  is_active?: boolean;
  status?: string;
}

interface AgentRow {
  key: string;
  name: string;
  module: string;
  modules: string[];
  type: string;
  prompt: string;
  trigger: string;
  isActive: boolean;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'draft';

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
        return [agent.name, agent.description, agent.prompt, agent.trigger, agent.scope?.join(' '), agent.module?.toString()].some((value) =>
          value ? value.toLowerCase().includes(query) : false,
        );
      })
      .map((agent, index) => {
        const id = agent.agent_id ?? `agent-${index}`;
        const status = agent.status ?? (agent.is_active === false ? 'inactive' : 'active');
        const modules = Array.isArray(agent.module)
          ? agent.module
          : agent.module
          ? [agent.module]
          : agent.scope ?? [];
        const moduleLabel = modules.length ? modules.join(', ') : '—';
        return {
          key: id,
          name: agent.name ?? '—',
          module: moduleLabel,
          modules,
          type: agent.type ?? '—',
          prompt: agent.prompt ?? '—',
          trigger: agent.trigger ?? '—',
          isActive: status === 'active',
        };
      });
  }, [agentsDirectory?.items, query, statusFilter]);

  const moduleFilters = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => row.modules.forEach((module) => set.add(module)));
    return Array.from(set).map((value) => ({ text: value, value }));
  }, [rows]);

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
          sticky
          columns={[
            {
              title: 'Модуль',
              dataIndex: 'module',
              key: 'module',
              filters: moduleFilters,
              filterMultiple: true,
              onFilter: (value, record) => record.modules.includes(value as string),
            },
            {
              title: 'Agent',
              dataIndex: 'name',
              key: 'name',
            },
            {
              title: 'Тип',
              dataIndex: 'type',
              key: 'type',
            },
            {
              title: 'Prompt',
              dataIndex: 'prompt',
              key: 'prompt',
              ellipsis: true,
            },
            {
              title: 'Trigger',
              dataIndex: 'trigger',
              key: 'trigger',
            },
            {
              title: 'Status',
              dataIndex: 'isActive',
              key: 'isActive',
              render: (value: boolean): ReactElement => (
                <Switch checked={value} checkedChildren="Вкл" unCheckedChildren="Выкл" disabled />
              ),
            },
            {
              title: '',
              key: 'actions',
              width: 48,
              render: (): ReactElement => (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'edit', label: 'edit' },
                      { key: 'delete', label: 'delete' },
                    ],
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} />
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
