import { Alert, Button, Card, Input, Select, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import GuideSourceTag from '../../components/GuideSourceTag';
import { useGuideStore } from '../../store/guideStore';

interface GuidePerson {
  person_id?: string;
  _id?: string;
  name?: string;
  real_name?: string;
  full_name?: string;
  roles?: string[];
  team_ids?: string[];
  is_active?: boolean;
}

interface GuideSalary {
  person_id?: string;
  month?: string;
  salary_rub_month?: number;
  working_hours_month?: number;
  cost_rate_rub_per_hour?: number;
}

interface EmployeeRow {
  key: string;
  name: string;
  roles: string;
  teams: string;
  personId: string;
  salary: string;
  costRate: string;
  isActive: boolean;
}

type StatusFilter = 'all' | 'active' | 'inactive';

const buildActiveTag = (active: boolean): ReactElement => (
  <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>
);

const normalizeText = (value: string): string => value.trim().toLowerCase();

const matchesSearch = (query: string, ...fields: Array<string | undefined | null>): boolean => {
  if (!query) {
    return true;
  }
  return fields.some((field) => field && field.toLowerCase().includes(query));
};

export default function EmployeesSalariesPage(): ReactElement {
  const fetchDirectory = useGuideStore((state) => state.fetchDirectory);
  const peopleDirectory = useGuideStore((state) => state.directories.people);
  const salariesDirectory = useGuideStore((state) => state.directories['employee-month-cost']);
  const teamsDirectory = useGuideStore((state) => state.directories.teams);
  const rolesDirectory = useGuideStore((state) => state.directories.roles);
  const loadingPeople = useGuideStore((state) => state.directoryLoading.people);
  const loadingSalaries = useGuideStore((state) => state.directoryLoading['employee-month-cost']);
  const loadingTeams = useGuideStore((state) => state.directoryLoading.teams);
  const loadingRoles = useGuideStore((state) => state.directoryLoading.roles);
  const errorPeople = useGuideStore((state) => state.directoryError.people);
  const errorSalaries = useGuideStore((state) => state.directoryError['employee-month-cost']);
  const errorTeams = useGuideStore((state) => state.directoryError.teams);
  const errorRoles = useGuideStore((state) => state.directoryError.roles);

  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect((): void => {
    void fetchDirectory('people');
    void fetchDirectory('employee-month-cost');
    void fetchDirectory('teams');
    void fetchDirectory('roles');
  }, [fetchDirectory]);

  const people = (peopleDirectory?.items ?? []) as GuidePerson[];
  const salaries = (salariesDirectory?.items ?? []) as GuideSalary[];
  const teams = (teamsDirectory?.items ?? []) as Array<{ team_id?: string; name?: string }>;
  const roles = (rolesDirectory?.items ?? []) as Array<{ role_id?: string; name?: string }>;

  const teamNameById = useMemo(() => {
    return new Map(teams.map((team) => [team.team_id ?? '', team.name ?? '—']));
  }, [teams]);

  const roleNameById = useMemo(() => {
    return new Map(
      roles.flatMap((role) => {
        const entries: Array<[string, string]> = [];
        if (role.role_id && role.name) {
          entries.push([role.role_id.toLowerCase(), role.name]);
        }
        if (role.name) {
          entries.push([role.name.toLowerCase(), role.name]);
        }
        return entries;
      }),
    );
  }, [roles]);

  const latestSalaryByPerson = useMemo(() => {
    const map = new Map<string, GuideSalary>();
    salaries.forEach((salary) => {
      const personId = salary.person_id;
      if (!personId) {
        return;
      }
      const current = map.get(personId);
      if (!current) {
        map.set(personId, salary);
        return;
      }
      const currentMonth = current.month ?? '';
      const nextMonth = salary.month ?? '';
      if (nextMonth > currentMonth) {
        map.set(personId, salary);
      }
    });
    return map;
  }, [salaries]);

  const query = normalizeText(search);

  const isStatusAllowed = (active: boolean): boolean => {
    if (statusFilter === 'all') {
      return true;
    }
    return statusFilter === 'active' ? active : !active;
  };

  const rows = useMemo((): EmployeeRow[] => {
    return people
      .filter((person) => {
        const active = person.is_active !== false;
        if (!isStatusAllowed(active)) {
          return false;
        }
        const name = person.full_name ?? person.real_name ?? person.name ?? '';
        const rolesLabel = person.roles?.map((role) => roleNameById.get(role.toLowerCase()) ?? role).join(' ') ?? '';
        const teamsLabel = person.team_ids?.map((teamId) => teamNameById.get(teamId) ?? teamId).join(' ') ?? '';
        const personId = person.person_id ?? person._id ?? '';
        return matchesSearch(query, name, rolesLabel, teamsLabel, personId);
      })
      .map((person, index) => {
        const id = person.person_id ?? person._id ?? `person-${index}`;
        const name = person.full_name ?? person.real_name ?? person.name ?? '—';
        const rolesLabel = person.roles?.length
          ? person.roles.map((role) => roleNameById.get(role.toLowerCase()) ?? role).join(', ')
          : '—';
        const teamsLabel = person.team_ids?.length
          ? person.team_ids.map((teamId) => teamNameById.get(teamId) ?? teamId).join(', ')
          : '—';
        const salary = latestSalaryByPerson.get(id);
        return {
          key: id,
          name,
          roles: rolesLabel,
          teams: teamsLabel,
          personId: id,
          salary: salary?.salary_rub_month != null ? `${salary.salary_rub_month}` : '—',
          costRate: salary?.cost_rate_rub_per_hour != null ? `${salary.cost_rate_rub_per_hour}` : '—',
          isActive: person.is_active !== false,
        };
      });
  }, [people, latestSalaryByPerson, query, roleNameById, statusFilter, teamNameById]);

  const loading = Boolean(loadingPeople || loadingSalaries || loadingTeams || loadingRoles);
  const errors = [errorPeople, errorSalaries, errorTeams, errorRoles].filter(Boolean) as string[];

  return (
    <div className="finops-page animate-fade-up">
      <Button type="link" className="!p-0 mb-2">
        <Link to="/guide">← Назад к Guide</Link>
      </Button>
      <PageHeader
        title="Исполнители"
        description="Read‑only справочники людей и себестоимости."
        actions={(
          <Button icon={<ReloadOutlined />} onClick={(): void => {
            void fetchDirectory('people');
            void fetchDirectory('employee-month-cost');
          }}>
            Обновить данные
          </Button>
        )}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск по людям, ролям, командам"
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
      <Card loading={loading}>
        <div className="flex items-center justify-between mb-3">
          <Typography.Text strong>Справочник людей</Typography.Text>
          <div className="flex items-center gap-2">
            <GuideSourceTag source={peopleDirectory?.source ?? 'unknown'} />
            <GuideSourceTag source={salariesDirectory?.source ?? 'unknown'} />
          </div>
        </div>
        <Table
          size="small"
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: 'Нет данных' }}
          sticky
          columns={[
            {
              title: 'Исполнитель',
              dataIndex: 'name',
              key: 'name',
              render: (_: unknown, row: EmployeeRow): ReactElement => (
                <div>
                  <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                  <div className="text-xs text-slate-500">{row.teams} • {row.roles}</div>
                </div>
              ),
            },
            {
              title: 'Person ID',
              dataIndex: 'personId',
              key: 'personId',
              render: (value: string): ReactElement => (
                <span className="text-xs text-slate-400">{value ?? '—'}</span>
              ),
            },
            { title: 'Оклад (₽)', dataIndex: 'salary', key: 'salary' },
            { title: 'Cost rate (₽/ч)', dataIndex: 'costRate', key: 'costRate' },
            {
              title: 'Статус',
              dataIndex: 'isActive',
              key: 'isActive',
              render: (value: boolean): ReactElement => buildActiveTag(value),
            },
          ]}
        />
      </Card>
    </div>
  );
}
