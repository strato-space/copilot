import { Button, Dropdown, Switch } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { type GuideDirectoryState } from '../store/guideStore';
import { formatDateLabel } from '../utils/format';

export interface DirectoryGroup {
  key: string;
  title: string;
  module: string;
  description: string;
  directories: Array<{ name: string; label: string }>;
}

export const DIRECTORY_GROUPS: DirectoryGroup[] = [
  {
    key: 'clients-projects-rates',
    title: 'Заказчики / Группы / Проекты / Ставки',
    module: 'Guides',
    description: 'Заказчики, группы проектов, проекты и ставки.',
    directories: [
      { name: 'customers', label: 'Заказчики' },
      { name: 'project-groups', label: 'Группы проектов' },
      { name: 'projects', label: 'Проекты' },
      { name: 'project-rates', label: 'Ставки' },
    ],
  },
  {
    key: 'people-salaries',
    title: 'Исполнители / Зарплаты',
    module: 'Guides',
    description: 'Люди, команды, роли и себестоимость по месяцам.',
    directories: [
      { name: 'people', label: 'Люди' },
      { name: 'employee-month-cost', label: 'Себестоимость' },
    ],
  },
  {
    key: 'fx',
    title: 'FX / Expense / Income',
    module: 'FinOps',
    description: 'FX, категории расходов и типы доходов.',
    directories: [
      { name: 'fx', label: 'FX' },
      { name: 'expense-categories', label: 'Категории расходов' },
      { name: 'income-types', label: 'Типы доходов' },
    ],
  },
  {
    key: 'agents',
    title: 'Agents',
    module: 'Agents',
    description: 'Каталог агентов и сценариев.',
    directories: [{ name: 'agents', label: 'Агенты' }],
  },
  {
    key: 'task-types-epics',
    title: 'Типы задач / Эпики',
    module: 'Guides',
    description: 'Дерево типов задач и эпики проектов.',
    directories: [
      { name: 'task-types', label: 'Типы задач' },
      { name: 'epics', label: 'Эпики' },
    ],
  },
  {
    key: 'aliases-alerts',
    title: 'Алиасы / Алерты',
    module: 'Guides',
    description: 'Псевдонимы, алерты и пороги.',
    directories: [
      { name: 'aliases', label: 'Алиасы' },
      { name: 'alerts', label: 'Алерты' },
    ],
  },
  {
    key: 'leads',
    title: 'Leads',
    module: 'SaleOps',
    description: 'Лиды продаж.',
    directories: [{ name: 'leads', label: 'Лиды' }],
  },
  {
    key: 'offers',
    title: 'Offers',
    module: 'SaleOps',
    description: 'Коммерческие предложения.',
    directories: [{ name: 'offers', label: 'Предложения' }],
  },
  {
    key: 'leave-schedule',
    title: 'Leave Schedule',
    module: 'HHOps',
    description: 'Отпуска и больничные.',
    directories: [{ name: 'leave-schedule', label: 'Отпуска' }],
  },
];

const buildContextStatus = (context?: {
  description?: string;
  goals?: string[];
  decision_rules?: { priorities?: string[]; definition_of_done?: string[] };
}): string => {
  if (!context) {
    return 'Empty';
  }
  const filled = [
    Boolean(context.description?.trim()),
    Boolean(context.goals?.length),
    Boolean(context.decision_rules?.priorities?.length),
    Boolean(context.decision_rules?.definition_of_done?.length),
  ].filter(Boolean).length;
  if (filled === 0) {
    return 'Empty';
  }
  if (filled === 4) {
    return 'Done';
  }
  return 'Partial';
};

export const buildDirectoryTable = (
  name: string,
  directories: Record<string, GuideDirectoryState>,
): { columns: Array<Record<string, unknown>>; data: Array<Record<string, unknown>>; emptyText?: string } => {
  const items = (directories[name]?.items ?? []) as Array<Record<string, unknown>>;

  switch (name) {
    case 'teams':
      return {
        columns: [
          { title: 'Команда', dataIndex: 'name', key: 'name' },
          { title: 'ID', dataIndex: 'team_id', key: 'team_id', render: (value: string) => <span className="text-xs text-slate-400">{value ?? '—'}</span> },
          { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет команд',
      };
    case 'projects':
      {
        const customers = (directories.customers?.items ?? []) as Array<{ customer_id?: string; _id?: string; name?: string }>;
        const customerMap = new Map<string, string>();
        customers.forEach((customer) => {
          const customerId = customer.customer_id ?? customer._id;
          if (customerId && customer.name) {
            customerMap.set(customerId, customer.name);
          }
        });
        const projectGroups = (directories['project-groups']?.items ?? []) as Array<{
          project_group_id?: string;
          _id?: string;
          name?: string;
          customer_id?: string;
          projects_ids?: string[];
        }>;
        const projectGroupMap = new Map<string, string>();
        const projectGroupCustomerMap = new Map<string, string>();
        const projectGroupByProject = new Map<string, string>();
        projectGroups.forEach((group) => {
          const groupId = group.project_group_id ?? group._id;
          if (groupId && group.name) {
            projectGroupMap.set(groupId, group.name);
          }
          if (groupId && group.customer_id) {
            projectGroupCustomerMap.set(groupId, group.customer_id);
          }
          const projectIds = group.projects_ids ?? [];
          projectIds.forEach((projectId) => {
            if (groupId) {
              projectGroupByProject.set(projectId, groupId);
            }
          });
        });
        const rates = (directories['project-rates']?.items ?? []) as Array<{
          project_id?: string;
          month?: string;
          rate_rub_per_hour?: number;
        }>;
        const rateByProject = new Map<string, { month: string; rates: number[] }>();
        rates.forEach((rate) => {
          if (!rate.project_id || typeof rate.rate_rub_per_hour !== 'number') {
            return;
          }
          const month = rate.month ?? '';
          const current = rateByProject.get(rate.project_id);
          if (!current || month > current.month) {
            rateByProject.set(rate.project_id, { month, rates: [rate.rate_rub_per_hour] });
            return;
          }
          if (month === current.month) {
            current.rates.push(rate.rate_rub_per_hour);
          }
        });
        return {
          columns: [
            {
              title: 'Проект',
              dataIndex: 'name',
              key: 'name',
              render: (value: string, row: { project_id?: string }) => (
                <div>
                  <div>{value ?? '—'}</div>
                  {row.project_id ? <div className="text-xs text-slate-400">{row.project_id}</div> : null}
                </div>
              ),
            },
            {
              title: 'Заказчик',
              dataIndex: 'customer_id',
              key: 'customer_id',
              render: (_: unknown, row: { customer_id?: string; project_group_id?: string; project_id?: string }) => {
                const groupId = row.project_group_id ?? (row.project_id ? projectGroupByProject.get(row.project_id) : undefined);
                const customerId = row.customer_id ?? (groupId ? projectGroupCustomerMap.get(groupId) : undefined);
                if (!customerId) {
                  return '—';
                }
                return customerMap.get(customerId) ?? customerId;
              },
            },
            {
              title: 'Группа',
              dataIndex: 'project_group_id',
              key: 'project_group_id',
              render: (value: string, row: { project_id?: string }) => {
                const groupId = value ?? (row.project_id ? projectGroupByProject.get(row.project_id) : undefined);
                if (!groupId) {
                  return '—';
                }
                return projectGroupMap.get(groupId) ?? groupId;
              },
            },
            {
              title: 'Ставка (₽/ч)',
              key: 'rate',
              render: (_: unknown, row: { project_id?: string }) => {
                const projectId = row.project_id ?? '';
                const entry = projectId ? rateByProject.get(projectId) : undefined;
                if (!entry || entry.rates.length === 0) {
                  return '—';
                }
                const min = Math.min(...entry.rates);
                const max = Math.max(...entry.rates);
                return min === max ? `${min}` : `${min}–${max}`;
              },
            },
            {
              title: 'Context',
              dataIndex: 'context',
              key: 'context',
              render: (value: Record<string, unknown>) => buildContextStatus(value as any),
            },
            { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          ],
          data: items,
          emptyText: 'Нет проектов',
        };
      }
    case 'people':
      {
        const teams = (directories.teams?.items ?? []) as Array<{ team_id?: string; name?: string }>;
        const roles = (directories.roles?.items ?? []) as Array<{ role_id?: string; name?: string }>;
        const teamMap = new Map<string, string>();
        const roleMap = new Map<string, string>();

        teams.forEach((team) => {
          if (team.team_id && team.name) {
            teamMap.set(team.team_id, team.name);
          }
        });

        roles.forEach((role) => {
          if (role.role_id && role.name) {
            roleMap.set(role.role_id.toLowerCase(), role.name);
          }
          if (role.name) {
            roleMap.set(role.name.toLowerCase(), role.name);
          }
        });

        return {
          columns: [
            {
              title: 'Имя',
              dataIndex: 'full_name',
              key: 'full_name',
              render: (value: string, row: { person_id?: string }) => (
                <div>
                  <div>{value ?? '—'}</div>
                  {row.person_id ? <div className="text-xs text-slate-400">{row.person_id}</div> : null}
                </div>
              ),
            },
            {
              title: 'Команды',
              dataIndex: 'team_ids',
              key: 'team_ids',
              render: (value: string[]) => {
                const list = (value ?? []).map((entry) => teamMap.get(entry) ?? entry);
                return list.length > 0 ? list.join(', ') : '—';
              },
            },
            {
              title: 'Роли',
              dataIndex: 'roles',
              key: 'roles',
              render: (value: string[]) => {
                const list = (value ?? []).map((entry) => roleMap.get(entry.toLowerCase()) ?? entry);
                return list.length > 0 ? list.join(', ') : '—';
              },
            },
            { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          ],
          data: items,
          emptyText: 'Нет людей',
        };
      }
    case 'roles':
      return {
        columns: [
          { title: 'Role ID', dataIndex: 'role_id', key: 'role_id', render: (value: string) => <span className="text-xs text-slate-400">{value ?? '—'}</span> },
          { title: 'Название', dataIndex: 'name', key: 'name' },
          { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет ролей',
      };
    case 'task-types':
      {
        const roles = (directories.roles?.items ?? []) as Array<{ role_id?: string; name?: string }>;
        const roleMap = new Map<string, string>();
        roles.forEach((role) => {
          if (role.role_id && role.name) {
            roleMap.set(role.role_id.toLowerCase(), role.name);
          }
          if (role.name) {
            roleMap.set(role.name.toLowerCase(), role.name);
          }
        });
        return {
          columns: [
            {
              title: 'Тип',
              dataIndex: 'title',
              key: 'title',
              render: (value: string, row: { task_type_id?: string }) => (
                <div>
                  <div>{value ?? '—'}</div>
                  {row.task_type_id ? <div className="text-xs text-slate-400">{row.task_type_id}</div> : null}
                </div>
              ),
            },
            { title: 'Class', dataIndex: 'type_class', key: 'type_class' },
            {
              title: 'Роли',
              dataIndex: 'roles',
              key: 'roles',
              render: (value: string[]) => {
                const list = (value ?? []).map((entry) => roleMap.get(entry.toLowerCase()) ?? entry);
                return list.length > 0 ? list.join(', ') : '—';
              },
            },
            { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          ],
          data: items,
          emptyText: 'Нет типов задач',
        };
      }
    case 'aliases':
      return {
        columns: [
          { title: 'Type', dataIndex: 'entity_type', key: 'entity_type' },
          { title: 'Canonical', dataIndex: 'canonical_name', key: 'canonical_name' },
          { title: 'Псевдонимы', dataIndex: 'aliases', key: 'aliases', render: (value: string[]) => value?.join(', ') ?? '—' },
        ],
        data: items,
        emptyText: 'Нет алиасов',
      };
    case 'agents':
      {
        const agentItems = items as Array<{ module?: string | string[]; scope?: string[] }>;
        const moduleSet = new Set<string>();
        agentItems.forEach((item) => {
          const modules = Array.isArray(item.module)
            ? item.module
            : item.module
              ? [item.module]
              : item.scope ?? [];
          modules.forEach((value) => {
            if (value) {
              moduleSet.add(value);
            }
          });
        });
        const moduleFilters = Array.from(moduleSet).map((value: string) => ({ text: value, value }));
        return {
          columns: [
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'Тип', dataIndex: 'type', key: 'type', render: (value: string) => value ?? '—' },
            {
              title: 'Модуль',
              dataIndex: 'module',
              key: 'module',
              filters: moduleFilters,
              filterMultiple: true,
              render: (_: string, row: { module?: string | string[]; scope?: string[] }) => {
                const modules = Array.isArray(row.module)
                  ? row.module
                  : row.module
                    ? [row.module]
                    : row.scope ?? [];
                return modules.length ? modules.join(', ') : '—';
              },
              onFilter: (value: string | number | boolean, record: { module?: string | string[]; scope?: string[] }) => {
                const modules = Array.isArray(record.module)
                  ? record.module
                  : record.module
                    ? [record.module]
                    : record.scope ?? [];
                return modules.includes(value as string);
              },
            },
            { title: 'Prompt', dataIndex: 'prompt', key: 'prompt', ellipsis: true, render: (value: string) => value ?? '—' },
            { title: 'Trigger', dataIndex: 'trigger', key: 'trigger', render: (value: string) => value ?? '—' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string, row: { is_active?: boolean }) => {
                const isActive = value ? value === 'active' : row.is_active !== false;
                return <Switch checked={isActive} checkedChildren="Вкл" unCheckedChildren="Выкл" disabled />;
              },
            },
            {
              title: '',
              key: 'actions',
              width: 48,
              render: () => (
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
          ],
          data: items,
          emptyText: 'Нет агентов',
        };
      }
    case 'epics':
      return {
        columns: [
          { title: 'Epic', dataIndex: 'title', key: 'title' },
          { title: 'Project', dataIndex: 'project', key: 'project' },
          { title: 'Status', dataIndex: 'status', key: 'status' },
        ],
        data: items,
        emptyText: 'Нет эпиков',
      };
    case 'project-rates':
      {
        const projects = (directories.projects?.items ?? []) as Array<{ project_id?: string; name?: string }>;
        const projectMap = new Map<string, string>();
        projects.forEach((project) => {
          if (project.project_id && project.name) {
            projectMap.set(project.project_id, project.name);
          }
        });
        return {
          columns: [
            {
              title: 'Проект',
              dataIndex: 'project_id',
              key: 'project_id',
              render: (value: string, row: { project_id?: string }) => (
                <div>
                  <div>{projectMap.get(value) ?? value ?? '—'}</div>
                  {row.project_id ? <div className="text-xs text-slate-400">{row.project_id}</div> : null}
                </div>
              ),
            },
            { title: 'Month', dataIndex: 'month', key: 'month', render: (value: string) => formatDateLabel(value) },
            { title: 'Rate (₽/ч)', dataIndex: 'rate_rub_per_hour', key: 'rate_rub_per_hour' },
            { title: 'Comment', dataIndex: 'comment', key: 'comment' },
          ],
          data: items,
          emptyText: 'Нет ставок',
        };
      }
    case 'employee-month-cost':
      {
        const people = (directories.people?.items ?? []) as Array<{ person_id?: string; full_name?: string }>;
        const peopleMap = new Map<string, string>();
        people.forEach((person) => {
          if (person.person_id && person.full_name) {
            peopleMap.set(person.person_id, person.full_name);
          }
        });
        return {
          columns: [
            {
              title: 'Исполнитель',
              dataIndex: 'person_id',
              key: 'person_id',
              render: (value: string, row: { person_id?: string }) => (
                <div>
                  <div>{peopleMap.get(value) ?? value ?? '—'}</div>
                  {row.person_id ? <div className="text-xs text-slate-400">{row.person_id}</div> : null}
                </div>
              ),
            },
            { title: 'Month', dataIndex: 'month', key: 'month', render: (value: string) => formatDateLabel(value) },
            { title: 'Salary (₽)', dataIndex: 'salary_rub_month', key: 'salary_rub_month' },
            { title: 'Hours', dataIndex: 'working_hours_month', key: 'working_hours_month' },
            { title: 'Cost rate', dataIndex: 'cost_rate_rub_per_hour', key: 'cost_rate_rub_per_hour' },
            { title: 'Source', dataIndex: 'source', key: 'source' },
          ],
          data: items,
          emptyText: 'Нет зарплат',
        };
      }
    case 'fx':
      return {
        columns: [
          { title: 'Month', dataIndex: 'month', key: 'month', render: (value: string) => formatDateLabel(value) },
          { title: 'Currency', dataIndex: 'currency', key: 'currency' },
          { title: 'FX avg', dataIndex: 'fx_avg', key: 'fx_avg' },
          { title: 'FX forecast', dataIndex: 'fx_forecast', key: 'fx_forecast' },
          { title: 'FX manual', dataIndex: 'fx_manual', key: 'fx_manual' },
          { title: 'Override', dataIndex: 'manual_override', key: 'manual_override', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет курсов',
      };
    case 'expense-categories':
      return {
        columns: [
          { title: 'Категория', dataIndex: 'name', key: 'name' },
          { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет категорий',
      };
    case 'income-types':
      return {
        columns: [
          { title: 'Тип дохода', dataIndex: 'name', key: 'name' },
          { title: 'Income ID', dataIndex: 'income_type_id', key: 'income_type_id', render: (value: string) => <span className="text-xs text-slate-400">{value ?? '—'}</span> },
          { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет типов дохода',
      };
    case 'alerts':
      return {
        columns: [
          { title: 'Название', dataIndex: 'name', key: 'name' },
          { title: 'Scope', dataIndex: 'scope', key: 'scope' },
          { title: 'Metric', dataIndex: 'metric', key: 'metric' },
          { title: 'Threshold', dataIndex: 'threshold', key: 'threshold' },
          { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет алертов',
      };
    case 'customers':
      return {
        columns: [
          {
            title: 'Customer',
            dataIndex: 'name',
            key: 'name',
            render: (value: string, row: { customer_id?: string; _id?: string }) => (
              <div>
                <div>{value ?? '—'}</div>
                {row.customer_id || row._id ? (
                  <div className="text-xs text-slate-400">{row.customer_id ?? row._id}</div>
                ) : null}
              </div>
            ),
          },
          { title: 'Groups', dataIndex: 'project_groups_count', key: 'project_groups_count' },
          { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ],
        data: items,
        emptyText: 'Нет заказчиков',
      };
    case 'project-groups':
      {
        const customers = (directories.customers?.items ?? []) as Array<{ customer_id?: string; _id?: string; name?: string }>;
        const customerMap = new Map<string, string>();
        customers.forEach((customer) => {
          const customerId = customer.customer_id ?? customer._id;
          if (customerId && customer.name) {
            customerMap.set(customerId, customer.name);
          }
        });
        return {
          columns: [
            {
              title: 'Group',
              dataIndex: 'name',
              key: 'name',
              render: (value: string, row: { project_group_id?: string; _id?: string }) => (
                <div>
                  <div>{value ?? '—'}</div>
                  {row.project_group_id || row._id ? (
                    <div className="text-xs text-slate-400">{row.project_group_id ?? row._id}</div>
                  ) : null}
                </div>
              ),
            },
            {
              title: 'Customer',
              dataIndex: 'customer_id',
              key: 'customer_id',
              render: (value: string, row: { customer?: string }) => customerMap.get(value) ?? row.customer ?? value ?? '—',
            },
            { title: 'Projects', dataIndex: 'projects_count', key: 'projects_count' },
            { title: 'Active', dataIndex: 'is_active', key: 'is_active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          ],
          data: items,
          emptyText: 'Нет групп',
        };
      }
    case 'leads':
      return {
        columns: [
          { title: 'Lead', dataIndex: 'lead_name', key: 'lead_name' },
          { title: 'Status', dataIndex: 'status', key: 'status' },
          { title: 'Owner', dataIndex: 'owner', key: 'owner' },
          { title: 'Source', dataIndex: 'source', key: 'source' },
          { title: 'Created', dataIndex: 'created_at', key: 'created_at' },
        ],
        data: items,
        emptyText: 'Нет лидов',
      };
    case 'offers':
      return {
        columns: [
          { title: 'Offer', dataIndex: 'offer_name', key: 'offer_name' },
          { title: 'Lead', dataIndex: 'lead', key: 'lead' },
          { title: 'Amount', dataIndex: 'amount', key: 'amount' },
          { title: 'Status', dataIndex: 'status', key: 'status' },
          { title: 'Created', dataIndex: 'created_at', key: 'created_at' },
        ],
        data: items,
        emptyText: 'Нет офферов',
      };
    case 'leave-schedule':
      return {
        columns: [
          { title: 'Person', dataIndex: 'person', key: 'person' },
          { title: 'Type', dataIndex: 'type', key: 'type' },
          { title: 'Date from', dataIndex: 'date_from', key: 'date_from', render: (value: string) => formatDateLabel(value) },
          { title: 'Date to', dataIndex: 'date_to', key: 'date_to', render: (value: string) => formatDateLabel(value) },
          { title: 'Status', dataIndex: 'status', key: 'status' },
        ],
        data: items,
        emptyText: 'Нет отпусков',
      };
    default:
      return { columns: [{ title: 'Данные', dataIndex: 'name', key: 'name' }], data: [] };
  }
};
