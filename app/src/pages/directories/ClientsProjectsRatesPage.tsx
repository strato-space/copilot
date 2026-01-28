import { Alert, Button, Drawer, Dropdown, Table, Tabs, Tag, Typography } from 'antd';
import { LinkOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';
import { formatDateLabel } from '../../utils/format';

interface GuideClient {
  client_id?: string;
  _id?: string;
  name?: string;
  track_id?: string;
  projects_ids?: string[];
  aliases?: string[];
  is_active?: boolean;
}

interface GuideTrack {
  track_id?: string;
  name?: string;
}

interface GuideProject {
  project_id?: string;
  _id?: string;
  name?: string;
  client_id?: string;
  track_id?: string;
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
  track: string;
  clientId: string;
  aliases: string;
  projectsCount: number;
  isActive: boolean;
}

interface ProjectRow {
  key: string;
  name: string;
  client: string;
  track: string;
  projectId: string;
  rateMonth: string;
  rate: string;
  commentCount: number;
  commentItems: string[];
  contextStatus: ContextStatus;
  isActive: boolean;
}


type ContextStatus = 'Empty' | 'Partial' | 'Done';

const buildActiveTag = (active: boolean): ReactElement => (
  <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>
);

const contextColorMap: Record<ContextStatus, string> = {
  Done: '#22c55e',
  Partial: '#f59e0b',
  Empty: '#ef4444',
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
  const tracksDirectory = useGuideStore((state) => state.directories.tracks);
  const loadingClients = useGuideStore((state) => state.directoryLoading.clients);
  const loadingProjects = useGuideStore((state) => state.directoryLoading.projects);
  const loadingRates = useGuideStore((state) => state.directoryLoading['project-rates']);
  const loadingTracks = useGuideStore((state) => state.directoryLoading.tracks);
  const errorClients = useGuideStore((state) => state.directoryError.clients);
  const errorProjects = useGuideStore((state) => state.directoryError.projects);
  const errorRates = useGuideStore((state) => state.directoryError['project-rates']);
  const errorTracks = useGuideStore((state) => state.directoryError.tracks);
  const [commentDrawerOpen, setCommentDrawerOpen] = useState(false);
  const [activeCommentProject, setActiveCommentProject] = useState<ProjectRow | null>(null);

  useEffect((): void => {
    void fetchDirectory('clients');
    void fetchDirectory('projects');
    void fetchDirectory('project-rates');
    void fetchDirectory('tracks');
  }, [fetchDirectory]);

  const clients = (clientsDirectory?.items ?? []) as GuideClient[];
  const projects = (projectsDirectory?.items ?? []) as GuideProject[];
  const rates = (ratesDirectory?.items ?? []) as GuideRate[];
  const tracks = (tracksDirectory?.items ?? []) as GuideTrack[];

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

  const clientTrackById = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => {
      const id = client.client_id ?? client._id;
      if (id && client.track_id) {
        map.set(id, client.track_id);
      }
    });
    return map;
  }, [clients]);

  const trackNameById = useMemo(() => {
    const map = new Map<string, string>();
    tracks.forEach((track) => {
      if (track.track_id) {
        map.set(track.track_id, track.name ?? '—');
      }
    });
    return map;
  }, [tracks]);

  const clientByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => {
      const clientName = client.name ?? '—';
      const ids = client.projects_ids ?? [];
      ids.forEach((projectId) => map.set(projectId, clientName));
    });
    return map;
  }, [clients]);


  const rateByProject = useMemo(() => {
    const map = new Map<string, { month: string; rates: number[]; comments: string[] }>();
    rates.forEach((rate) => {
      if (!rate.project_id || typeof rate.rate_rub_per_hour !== 'number') {
        return;
      }
      const month = rate.month ?? '';
      const comment = rate.comment?.trim();
      const current = map.get(rate.project_id);
      if (!current || month > current.month) {
        map.set(rate.project_id, {
          month,
          rates: [rate.rate_rub_per_hour],
          comments: comment ? [comment] : [],
        });
        return;
      }
      if (month === current.month) {
        current.rates.push(rate.rate_rub_per_hour);
        if (comment) {
          current.comments.push(comment);
        }
      }
    });
    return map;
  }, [rates]);

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

  const clientRows = useMemo((): ClientRow[] => {
    return clients
      .map((client, index) => {
        const id = client.client_id ?? client._id ?? `client-${index}`;
        const projectsCount = client.projects_ids?.length ?? clientProjectCounts.get(id) ?? 0;
        const track = client.track_id ? trackNameById.get(client.track_id) ?? client.track_id : '—';
        return {
          key: id,
          name: client.name ?? '—',
          track,
          clientId: id,
          aliases: (client.aliases ?? []).join(', '),
          projectsCount,
          isActive: client.is_active !== false,
        };
      });
  }, [clients, clientProjectCounts, trackNameById]);

  const projectRows = useMemo((): ProjectRow[] => {
    return projects
      .map((project, index) => {
        const projectId = project.project_id ?? project._id ?? `project-${index}`;
        const clientName = project.client_id
          ? clientNameById.get(project.client_id) ?? '—'
          : clientByProjectId.get(projectId) ?? '—';
        const trackId = project.track_id ?? (project.client_id ? clientTrackById.get(project.client_id) : undefined);
        const trackName = trackId ? trackNameById.get(trackId) ?? trackId : '—';
        const entry = projectId ? rateByProject.get(projectId) : undefined;
        const rateLabel = entry?.rates?.length
          ? (() => {
            const min = Math.min(...entry.rates);
            const max = Math.max(...entry.rates);
            return min === max ? `${min}` : `${min}–${max}`;
          })()
          : '—';
        const commentItems = entry?.comments?.length ? Array.from(new Set(entry.comments)) : [];
        return {
          key: projectId,
          name: project.name ?? '—',
          client: clientName,
          track: trackName,
          projectId: projectId,
          rateMonth: formatDateLabel(entry?.month),
          rate: rateLabel,
          commentCount: commentItems.length,
          commentItems,
          contextStatus: getContextStatus(project),
          isActive: project.is_active !== false,
        };
      });
  }, [projects, clientNameById, clientByProjectId, clientTrackById, rateByProject, trackNameById]);

  const loading = Boolean(loadingClients || loadingProjects || loadingRates || loadingTracks);
  const errors = [errorClients, errorProjects, errorRates, errorTracks].filter(Boolean) as string[];

  const openComments = (row: ProjectRow): void => {
    setActiveCommentProject(row);
    setCommentDrawerOpen(true);
  };

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
      {errors.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="Не удалось загрузить часть данных"
          description={errors.join(' / ')}
        />
      ) : null}
      <Tabs
        items={[
          {
            key: 'clients',
            label: 'Клиенты',
            children: (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Typography.Text strong>Клиенты</Typography.Text>
                  <GuideSourceTag source={clientsDirectory?.source ?? 'unknown'} />
                </div>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={clientRows}
                  locale={{ emptyText: 'Нет данных' }}
                  sticky
                  loading={loading}
                  columns={[
                    { title: 'Трек', dataIndex: 'track', key: 'track' },
                    {
                      title: 'Клиент',
                      dataIndex: 'name',
                      key: 'name',
                      render: (value: string, row: ClientRow): ReactElement => (
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{value}</div>
                          <div className="text-xs text-slate-400">{row.clientId}</div>
                        </div>
                      ),
                    },
                    { title: 'Проектов', dataIndex: 'projectsCount', key: 'projectsCount' },
                    { title: 'Псевдонимы', dataIndex: 'aliases', key: 'aliases' },
                    {
                      title: 'Статус',
                      dataIndex: 'isActive',
                      key: 'isActive',
                      render: (value: boolean): ReactElement => buildActiveTag(value),
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
              </div>
            ),
          },
          {
            key: 'projects',
            label: 'Проекты',
            children: (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Typography.Text strong>Проекты</Typography.Text>
                  <GuideSourceTag source={projectsDirectory?.source ?? 'unknown'} />
                </div>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={projectRows}
                  locale={{ emptyText: 'Нет данных' }}
                  sticky
                  loading={loading}
                  columns={[
                    { title: 'Трек', dataIndex: 'track', key: 'track' },
                    {
                      title: 'Проект',
                      dataIndex: 'name',
                      key: 'name',
                      render: (value: string, row: ProjectRow): ReactElement => (
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{value}</div>
                          <div className="text-xs text-slate-400">{row.projectId}</div>
                        </div>
                      ),
                    },
                    { title: 'Клиент', dataIndex: 'client', key: 'client' },
                    { title: 'Ставка (₽/ч)', dataIndex: 'rate', key: 'rate' },
                    {
                      title: 'Комментарий',
                      key: 'commentCount',
                      render: (_: unknown, row: ProjectRow): ReactElement => (
                        <Button
                          type="text"
                          className="!px-2"
                          icon={row.commentCount > 0 ? undefined : <PlusOutlined />}
                          onClick={(): void => openComments(row)}
                        >
                          {row.commentCount > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">
                              {row.commentCount}
                            </span>
                          ) : null}
                        </Button>
                      ),
                    },
                    {
                      title: 'Context',
                      dataIndex: 'contextStatus',
                      key: 'contextStatus',
                      render: (value: ContextStatus): ReactElement => (
                        <LinkOutlined style={{ color: contextColorMap[value] }} />
                      ),
                    },
                    {
                      title: 'Статус',
                      dataIndex: 'isActive',
                      key: 'isActive',
                      render: (value: boolean): ReactElement => buildActiveTag(value),
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
              </div>
            ),
          },
        ]}
      />
      <Drawer
        open={commentDrawerOpen}
        width={360}
        onClose={(): void => setCommentDrawerOpen(false)}
        title={activeCommentProject ? `Комментарии — ${activeCommentProject.name}` : 'Комментарии'}
      >
        {activeCommentProject ? (
          <div className="mb-4 text-xs text-slate-500">
            Ставка: {activeCommentProject.rate} · Месяц: {activeCommentProject.rateMonth}
          </div>
        ) : null}
        {activeCommentProject?.commentItems.length ? (
          <div className="space-y-3">
            {activeCommentProject.commentItems.map((comment, index) => (
              <div key={`${comment}-${index}`} className="rounded-lg border border-slate-100 p-3 text-sm">
                {comment}
              </div>
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">Комментариев пока нет.</Typography.Text>
        )}
      </Drawer>
    </div>
  );
}
