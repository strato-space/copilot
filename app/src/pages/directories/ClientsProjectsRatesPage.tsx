import { Alert, Button, Drawer, Dropdown, Table, Tabs, Tag, Typography } from 'antd';
import { LinkOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';
import { formatDateLabel } from '../../utils/format';

interface GuideCustomer {
  customer_id?: string;
  _id?: string;
  name?: string;
  project_groups_ids?: string[];
  aliases?: string[];
  is_active?: boolean;
}

interface GuideProjectGroup {
  project_group_id?: string;
  _id?: string;
  name?: string;
  customer_id?: string;
  projects_ids?: string[];
  is_active?: boolean;
}

interface GuideProject {
  project_id?: string;
  _id?: string;
  name?: string;
  customer_id?: string;
  project_group_id?: string;
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

interface CustomerRow {
  key: string;
  name: string;
  group: string;
  customerId: string;
  aliases: string;
  projectsCount: number;
  isActive: boolean;
}

interface ProjectRow {
  key: string;
  name: string;
  customer: string;
  group: string;
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
  const customersDirectory = useGuideStore((state) => state.directories.customers);
  const projectGroupsDirectory = useGuideStore((state) => state.directories['project-groups']);
  const projectsDirectory = useGuideStore((state) => state.directories.projects);
  const ratesDirectory = useGuideStore((state) => state.directories['project-rates']);
  const loadingCustomers = useGuideStore((state) => state.directoryLoading.customers);
  const loadingProjectGroups = useGuideStore((state) => state.directoryLoading['project-groups']);
  const loadingProjects = useGuideStore((state) => state.directoryLoading.projects);
  const loadingRates = useGuideStore((state) => state.directoryLoading['project-rates']);
  const errorCustomers = useGuideStore((state) => state.directoryError.customers);
  const errorProjectGroups = useGuideStore((state) => state.directoryError['project-groups']);
  const errorProjects = useGuideStore((state) => state.directoryError.projects);
  const errorRates = useGuideStore((state) => state.directoryError['project-rates']);
  const [commentDrawerOpen, setCommentDrawerOpen] = useState(false);
  const [activeCommentProject, setActiveCommentProject] = useState<ProjectRow | null>(null);

  useEffect((): void => {
    void fetchDirectory('customers');
    void fetchDirectory('project-groups');
    void fetchDirectory('projects');
    void fetchDirectory('project-rates');
  }, [fetchDirectory]);

  const customers = (customersDirectory?.items ?? []) as GuideCustomer[];
  const projectGroups = (projectGroupsDirectory?.items ?? []) as GuideProjectGroup[];
  const projects = (projectsDirectory?.items ?? []) as GuideProject[];
  const rates = (ratesDirectory?.items ?? []) as GuideRate[];
  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((customer) => {
      const id = customer.customer_id ?? customer._id;
      if (id) {
        map.set(id, customer.name ?? '—');
      }
    });
    return map;
  }, [customers]);

  const projectGroupNameById = useMemo(() => {
    const map = new Map<string, string>();
    projectGroups.forEach((group) => {
      const id = group.project_group_id ?? group._id;
      if (id) {
        map.set(id, group.name ?? '—');
      }
    });
    return map;
  }, [projectGroups]);

  const projectGroupCustomerById = useMemo(() => {
    const map = new Map<string, string>();
    projectGroups.forEach((group) => {
      const id = group.project_group_id ?? group._id;
      if (id && group.customer_id) {
        map.set(id, group.customer_id);
      }
    });
    return map;
  }, [projectGroups]);

  const projectGroupByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    projectGroups.forEach((group) => {
      const groupId = group.project_group_id ?? group._id;
      if (!groupId) {
        return;
      }
      const ids = group.projects_ids ?? [];
      ids.forEach((projectId) => map.set(projectId, groupId));
    });
    projects.forEach((project) => {
      const projectId = project.project_id ?? project._id;
      if (!projectId) {
        return;
      }
      if (project.project_group_id) {
        map.set(projectId, project.project_group_id);
      }
    });
    return map;
  }, [projectGroups, projects]);

  const customerByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => {
      const projectId = project.project_id ?? project._id;
      if (!projectId) {
        return;
      }
      let customerId = project.customer_id;
      if (!customerId) {
        const groupId = project.project_group_id ?? projectGroupByProjectId.get(projectId);
        if (groupId) {
          customerId = projectGroupCustomerById.get(groupId);
        }
      }
      if (customerId) {
        map.set(projectId, customerNameById.get(customerId) ?? customerId);
      }
    });
    return map;
  }, [projects, projectGroupByProjectId, projectGroupCustomerById, customerNameById]);

  const projectGroupsByCustomerId = useMemo(() => {
    const map = new Map<string, string[]>();
    projectGroups.forEach((group) => {
      const customerId = group.customer_id;
      const groupId = group.project_group_id ?? group._id;
      if (!customerId || !groupId) {
        return;
      }
      const list = map.get(customerId) ?? [];
      const label = group.name ?? groupId;
      if (!list.includes(label)) {
        list.push(label);
      }
      map.set(customerId, list);
    });
    return map;
  }, [projectGroups]);


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

  const customerProjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((project) => {
      const projectId = project.project_id ?? project._id;
      if (!projectId) {
        return;
      }
      let customerId = project.customer_id;
      if (!customerId) {
        const groupId = project.project_group_id ?? projectGroupByProjectId.get(projectId);
        if (groupId) {
          customerId = projectGroupCustomerById.get(groupId);
        }
      }
      if (!customerId) {
        return;
      }
      counts.set(customerId, (counts.get(customerId) ?? 0) + 1);
    });
    return counts;
  }, [projects, projectGroupByProjectId, projectGroupCustomerById]);

  const customerRows = useMemo((): CustomerRow[] => {
    return customers.map((customer, index) => {
      const id = customer.customer_id ?? customer._id ?? `customer-${index}`;
      const groupNames = projectGroupsByCustomerId.get(id) ?? [];
      return {
        key: id,
        name: customer.name ?? '—',
        group: groupNames.length ? groupNames.join(', ') : '—',
        customerId: id,
        aliases: (customer.aliases ?? []).join(', '),
        projectsCount: customerProjectCounts.get(id) ?? 0,
        isActive: customer.is_active !== false,
      };
    });
  }, [customers, projectGroupsByCustomerId, customerProjectCounts]);

  const projectRows = useMemo((): ProjectRow[] => {
    return projects
      .map((project, index) => {
        const projectId = project.project_id ?? project._id ?? `project-${index}`;
        const customerName = project.customer_id
          ? customerNameById.get(project.customer_id) ?? '—'
          : customerByProjectId.get(projectId) ?? '—';
        const groupId = project.project_group_id ?? projectGroupByProjectId.get(projectId);
        const groupName = groupId ? projectGroupNameById.get(groupId) ?? groupId : '—';
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
          customer: customerName,
          group: groupName,
          projectId: projectId,
          rateMonth: formatDateLabel(entry?.month),
          rate: rateLabel,
          commentCount: commentItems.length,
          commentItems,
          contextStatus: getContextStatus(project),
          isActive: project.is_active !== false,
        };
      });
  }, [projects, customerNameById, customerByProjectId, projectGroupByProjectId, projectGroupNameById, rateByProject]);

  const loading = Boolean(loadingCustomers || loadingProjectGroups || loadingProjects || loadingRates);
  const errors = [errorCustomers, errorProjectGroups, errorProjects, errorRates].filter(Boolean) as string[];

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
        title="Заказчики, группы, проекты и ставки"
        description="Read‑only справочники из automation (master)."
        actions={(
          <Button icon={<ReloadOutlined />} onClick={(): void => {
            void fetchDirectory('customers');
            void fetchDirectory('project-groups');
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
            key: 'customers',
            label: 'Заказчики',
            children: (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Typography.Text strong>Заказчики</Typography.Text>
                  <GuideSourceTag source={customersDirectory?.source ?? 'unknown'} />
                </div>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={customerRows}
                  locale={{ emptyText: 'Нет данных' }}
                  sticky
                  loading={loading}
                  columns={[
                    { title: 'Группы', dataIndex: 'group', key: 'group' },
                    {
                      title: 'Заказчик',
                      dataIndex: 'name',
                      key: 'name',
                      render: (value: string, row: CustomerRow): ReactElement => (
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{value}</div>
                          <div className="text-xs text-slate-400">{row.customerId}</div>
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
                    { title: 'Группа', dataIndex: 'group', key: 'group' },
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
                    { title: 'Заказчик', dataIndex: 'customer', key: 'customer' },
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
