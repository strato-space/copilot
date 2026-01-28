import { Alert, Button, Card, Col, Input, Row, Select, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';

interface GuideClient {
  client_id?: string;
  _id?: string;
  name?: string;
  projects_ids?: string[];
  aliases?: string[];
  is_active?: boolean;
}

interface GuideProject {
  project_id?: string;
  _id?: string;
  name?: string;
  client_id?: string;
  is_active?: boolean;
  context?: {
    description?: string;
    goals?: string[];
    decision_rules?: {
      priorities?: string[];
      definition_of_done?: string[];
    };
  };
}

interface GuideRate {
  project_id?: string;
  month?: string;
  rate_rub_per_hour?: number;
  comment?: string;
}

interface ClientRow {
  key: string;
  name: string;
  aliases: string;
  projectsCount: number;
  isActive: boolean;
}

interface ProjectRow {
  key: string;
  name: string;
  client: string;
  projectId: string;
  contextStatus: string;
  isActive: boolean;
}

interface RateRow {
  key: string;
  project: string;
  month: string;
  rate: string;
  comment: string;
}

type StatusFilter = 'all' | 'active' | 'inactive';

type ContextStatus = 'Empty' | 'Partial' | 'Done';

const buildActiveTag = (active: boolean): ReactElement => (
  <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>
);

const buildContextTag = (status: ContextStatus): ReactElement => {
  if (status === 'Done') {
    return <Tag color="green">Done</Tag>;
  }
  if (status === 'Partial') {
    return <Tag color="orange">Partial</Tag>;
  }
  return <Tag color="red">Empty</Tag>;
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const matchesSearch = (query: string, ...fields: Array<string | undefined | null>): boolean => {
  if (!query) {
    return true;
  }
  return fields.some((field) => field && field.toLowerCase().includes(query));
};

const getContextStatus = (project: GuideProject): ContextStatus => {
  const context = project.context;
  if (!context) {
    return 'Empty';
  }
  const hasDescription = Boolean(context.description?.trim());
  const hasGoals = Boolean(context.goals?.length);
  const hasPriorities = Boolean(context.decision_rules?.priorities?.length);
  const hasDone = Boolean(context.decision_rules?.definition_of_done?.length);
  const filled = [hasDescription, hasGoals, hasPriorities, hasDone].filter(Boolean).length;
  if (filled === 0) {
    return 'Empty';
  }
  if (filled === 4) {
    return 'Done';
  }
  return 'Partial';
};

export default function ClientsProjectsRatesPage(): ReactElement {
  const fetchDirectory = useGuideStore((state) => state.fetchDirectory);
  const clientsDirectory = useGuideStore((state) => state.directories.clients);
  const projectsDirectory = useGuideStore((state) => state.directories.projects);
  const ratesDirectory = useGuideStore((state) => state.directories['project-rates']);
  const loadingClients = useGuideStore((state) => state.directoryLoading.clients);
  const loadingProjects = useGuideStore((state) => state.directoryLoading.projects);
  const loadingRates = useGuideStore((state) => state.directoryLoading['project-rates']);
  const errorClients = useGuideStore((state) => state.directoryError.clients);
  const errorProjects = useGuideStore((state) => state.directoryError.projects);
  const errorRates = useGuideStore((state) => state.directoryError['project-rates']);

  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect((): void => {
    void fetchDirectory('clients');
    void fetchDirectory('projects');
    void fetchDirectory('project-rates');
  }, [fetchDirectory]);

  const clients = (clientsDirectory?.items ?? []) as GuideClient[];
  const projects = (projectsDirectory?.items ?? []) as GuideProject[];
  const rates = (ratesDirectory?.items ?? []) as GuideRate[];

  const query = normalizeText(search);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => {
      const id = client.client_id ?? client._id;
      if (id) {
        map.set(id, client.name ?? '—');
      }
    });
    return map;
  }, [clients]);

  const clientByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => {
      const clientName = client.name ?? '—';
      const ids = client.projects_ids ?? [];
      ids.forEach((projectId) => map.set(projectId, clientName));
    });
    return map;
  }, [clients]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => {
      const id = project.project_id ?? project._id;
      if (id) {
        map.set(id, project.name ?? '—');
      }
    });
    return map;
  }, [projects]);

  const clientProjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((project) => {
      const clientId = project.client_id;
      if (!clientId) {
        return;
      }
      counts.set(clientId, (counts.get(clientId) ?? 0) + 1);
    });
    return counts;
  }, [projects]);

  const isStatusAllowed = (active: boolean): boolean => {
    if (statusFilter === 'all') {
      return true;
    }
    return statusFilter === 'active' ? active : !active;
  };

  const clientRows = useMemo((): ClientRow[] => {
    return clients
      .filter((client) => {
        const active = client.is_active !== false;
        if (!isStatusAllowed(active)) {
          return false;
        }
        const aliases = (client.aliases ?? []).join(' ');
        return matchesSearch(query, client.name, aliases);
      })
      .map((client, index) => {
        const id = client.client_id ?? client._id ?? `client-${index}`;
        const projectsCount = client.projects_ids?.length ?? clientProjectCounts.get(id) ?? 0;
        return {
          key: id,
          name: client.name ?? '—',
          aliases: (client.aliases ?? []).join(', '),
          projectsCount,
          isActive: client.is_active !== false,
        };
      });
  }, [clients, clientProjectCounts, query, statusFilter]);

  const projectRows = useMemo((): ProjectRow[] => {
    return projects
      .filter((project) => {
        const active = project.is_active !== false;
        if (!isStatusAllowed(active)) {
          return false;
        }
        const projectId = project.project_id ?? project._id ?? '';
        const clientName = project.client_id
          ? clientNameById.get(project.client_id) ?? '—'
          : clientByProjectId.get(projectId) ?? '—';
        return matchesSearch(query, project.name, clientName, projectId);
      })
      .map((project, index) => {
        const projectId = project.project_id ?? project._id ?? `project-${index}`;
        const clientName = project.client_id
          ? clientNameById.get(project.client_id) ?? '—'
          : clientByProjectId.get(projectId) ?? '—';
        return {
          key: projectId,
          name: project.name ?? '—',
          client: clientName,
          projectId: projectId,
          contextStatus: getContextStatus(project),
          isActive: project.is_active !== false,
        };
      });
  }, [projects, clientNameById, clientByProjectId, query, statusFilter]);

  const rateRows = useMemo((): RateRow[] => {
    return rates
      .filter((rate) => {
        const projectName = rate.project_id ? projectNameById.get(rate.project_id) ?? '—' : '—';
        return matchesSearch(query, projectName, rate.month, rate.comment);
      })
      .map((rate, index) => {
        const projectName = rate.project_id ? projectNameById.get(rate.project_id) ?? '—' : '—';
        return {
          key: `${rate.project_id ?? 'project'}-${rate.month ?? index}`,
          project: projectName,
          month: rate.month ?? '—',
          rate: typeof rate.rate_rub_per_hour === 'number' ? `${rate.rate_rub_per_hour}` : '—',
          comment: rate.comment ?? '—',
        };
      });
  }, [rates, projectNameById, query]);

  const loading = Boolean(loadingClients || loadingProjects || loadingRates);
  const errors = [errorClients, errorProjects, errorRates].filter(Boolean) as string[];

  return (
    <div className="finops-page animate-fade-up">
      <Button type="link" className="!p-0 mb-2">
        <Link to="/guide">← Назад к Guide</Link>
      </Button>
      <PageHeader
        title="Клиенты, проекты и ставки"
        description="Read‑only справочники из automation (master)."
        actions={(
          <Button icon={<ReloadOutlined />} onClick={(): void => {
            void fetchDirectory('clients');
            void fetchDirectory('projects');
            void fetchDirectory('project-rates');
          }}>
            Обновить данные
          </Button>
        )}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск по клиентам / проектам / ID"
            value={search}
            onChange={(event): void => setSearch(event.target.value)}
            className="min-w-[220px] flex-1"
          />
          <Select
            value={statusFilter}
            onChange={(value): void => setStatusFilter(value)}
            options={[
              { label: 'Все статусы', value: 'all' },
              { label: 'Только active', value: 'active' },
              { label: 'Только inactive', value: 'inactive' },
            ]}
            className="w-[180px]"
          />
        </div>
      </Card>
      {errors.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить часть данных"
          description={errors.join(' / ')}
        />
      ) : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card loading={loading}>
            <div className="flex items-center justify-between mb-3">
              <Typography.Text strong>Клиенты</Typography.Text>
              <GuideSourceTag source={clientsDirectory?.source ?? 'unknown'} />
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={clientRows}
              locale={{ emptyText: 'Нет данных' }}
              columns={[
                { title: 'Клиент', dataIndex: 'name', key: 'name' },
                { title: 'Проектов', dataIndex: 'projectsCount', key: 'projectsCount' },
                { title: 'Aliases', dataIndex: 'aliases', key: 'aliases' },
                {
                  title: 'Статус',
                  dataIndex: 'isActive',
                  key: 'isActive',
                  render: (value: boolean): ReactElement => buildActiveTag(value),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card loading={loading}>
            <div className="flex items-center justify-between mb-3">
              <Typography.Text strong>Проекты</Typography.Text>
              <GuideSourceTag source={projectsDirectory?.source ?? 'unknown'} />
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={projectRows}
              locale={{ emptyText: 'Нет данных' }}
              columns={[
                { title: 'Проект', dataIndex: 'name', key: 'name' },
                { title: 'Клиент', dataIndex: 'client', key: 'client' },
                { title: 'Project ID', dataIndex: 'projectId', key: 'projectId' },
                {
                  title: 'Context',
                  dataIndex: 'contextStatus',
                  key: 'contextStatus',
                  render: (value: ContextStatus): ReactElement => buildContextTag(value),
                },
                {
                  title: 'Статус',
                  dataIndex: 'isActive',
                  key: 'isActive',
                  render: (value: boolean): ReactElement => buildActiveTag(value),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card loading={loading}>
            <div className="flex items-center justify-between mb-3">
              <Typography.Text strong>Ставки</Typography.Text>
              <GuideSourceTag source={ratesDirectory?.source ?? 'unknown'} />
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={rateRows}
              locale={{ emptyText: 'Нет данных' }}
              columns={[
                { title: 'Проект', dataIndex: 'project', key: 'project' },
                { title: 'Месяц', dataIndex: 'month', key: 'month' },
                { title: 'Ставка (₽/ч)', dataIndex: 'rate', key: 'rate' },
                { title: 'Комментарий', dataIndex: 'comment', key: 'comment' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
