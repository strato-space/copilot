export const GUIDE_MOCK_INDEX = [
  { name: 'teams', title: 'Teams', module: 'core', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'tracks', title: 'Tracks', module: 'core', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'clients', title: 'Clients', module: 'core', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'projects', title: 'Projects', module: 'core', count: 4, source: 'mock', updated_at: '2026-01-28' },
  { name: 'people', title: 'People', module: 'core', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'roles', title: 'Roles', module: 'core', count: 4, source: 'mock', updated_at: '2026-01-28' },
  { name: 'task-types', title: 'Task Types', module: 'core', count: 4, source: 'mock', updated_at: '2026-01-28' },
  { name: 'aliases', title: 'Aliases', module: 'core', count: 4, source: 'mock', updated_at: '2026-01-28' },
  { name: 'agents', title: 'Agents', module: 'core', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'epics', title: 'Epics', module: 'operops', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'project-rates', title: 'Project Rates', module: 'finops', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'employee-month-cost', title: 'Employee Month Cost', module: 'finops', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'fx', title: 'FX', module: 'finops', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'expense-categories', title: 'Expense Categories', module: 'finops', count: 3, source: 'mock', updated_at: '2026-01-28' },
  { name: 'income-types', title: 'Income Types', module: 'finops', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'alerts', title: 'Alert Rules', module: 'finops', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'customers', title: 'Customers', module: 'crm-compat', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'project-groups', title: 'Project Groups', module: 'crm-compat', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'leads', title: 'Leads', module: 'saleops', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'offers', title: 'Offers', module: 'saleops', count: 2, source: 'mock', updated_at: '2026-01-28' },
  { name: 'leave-schedule', title: 'Leave Schedule', module: 'hhops', count: 2, source: 'mock', updated_at: '2026-01-28' },
];

export const GUIDE_MOCK_DIRECTORIES = {
  teams: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { team_id: 'team-delivery', name: 'Delivery Team', is_active: true },
      { team_id: 'team-design', name: 'Design Team', is_active: true },
      { team_id: 'team-qa', name: 'QA Team', is_active: false },
    ],
  },
  tracks: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { track_id: 'track-design', name: 'Design', client_ids: ['client-acme', 'client-northwind'], is_active: true },
      { track_id: 'track-product', name: 'Product', client_ids: ['client-orion'], is_active: true },
    ],
  },
  clients: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { client_id: 'client-acme', name: 'Acme Corp', track_id: 'track-design', aliases: ['Acme'], is_active: true },
      { client_id: 'client-northwind', name: 'Northwind Labs', track_id: 'track-design', aliases: ['NW'], is_active: true },
      { client_id: 'client-orion', name: 'Orion Studio', track_id: 'track-product', aliases: [], is_active: false },
    ],
  },
  projects: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      {
        project_id: 'proj-acme-app',
        name: 'Acme Mobile App',
        client_id: 'client-acme',
        track_id: 'track-design',
        is_active: true,
        context: {
          description: 'Мобильное приложение для клиентов',
          goals: ['рост активаций'],
          decision_rules: { priorities: ['скорость'], definition_of_done: ['релиз в store'] },
        },
      },
      {
        project_id: 'proj-nw-ml',
        name: 'Northwind ML',
        client_id: 'client-northwind',
        track_id: 'track-design',
        is_active: true,
        context: {
          description: '',
          goals: [],
          decision_rules: { priorities: [], definition_of_done: [] },
        },
      },
      {
        project_id: 'proj-orion-brand',
        name: 'Orion Rebrand',
        client_id: 'client-orion',
        track_id: 'track-product',
        is_active: false,
      },
      {
        project_id: 'proj-acme-web',
        name: 'Acme Web Portal',
        client_id: 'client-acme',
        track_id: 'track-design',
        is_active: true,
      },
    ],
  },
  roles: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { role_id: 'pm', name: 'Project Manager', is_active: true },
      { role_id: 'design', name: 'Designer', is_active: true },
      { role_id: 'qa', name: 'QA', is_active: true },
      { role_id: 'dev', name: 'Developer', is_active: false },
    ],
  },
  'task-types': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { task_type_id: 'tt-ui', title: 'UI Audit', type_class: 'FUNCTIONALITY', roles: ['Designer'], is_active: true },
      { task_type_id: 'tt-ui-1', title: 'UI Audit: Report', type_class: 'TASK', roles: ['Designer'], is_active: true },
      { task_type_id: 'tt-qa', title: 'QA Regression', type_class: 'FUNCTIONALITY', roles: ['QA'], is_active: true },
      { task_type_id: 'tt-qa-1', title: 'QA Regression: Checklist', type_class: 'TASK', roles: ['QA'], is_active: false },
    ],
  },
  aliases: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { entity_type: 'PROJECT', canonical_name: 'Acme Mobile App', aliases: ['Acme App', 'Mobile'] },
      { entity_type: 'CLIENT', canonical_name: 'Acme Corp', aliases: ['Acme'] },
      { entity_type: 'PERFORMER', canonical_name: 'Иван Петров', aliases: ['Иван П.'] },
      { entity_type: 'CUSTOMER', canonical_name: 'Northwind Holding', aliases: ['NW Holding'] },
    ],
  },
  'project-rates': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { project_id: 'proj-acme-app', month: '2026-01', rate_rub_per_hour: 3500, comment: 'T&M' },
      { project_id: 'proj-nw-ml', month: '2026-01', rate_rub_per_hour: 4200, comment: 'T&M' },
      { project_id: 'proj-acme-web', month: '2026-01', rate_rub_per_hour: 3200, comment: 'Fix' },
    ],
  },
  people: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      {
        person_id: 'person-ivan',
        full_name: 'Иван Петров',
        roles: ['Project Manager'],
        team_ids: ['team-delivery'],
        is_active: true,
      },
      {
        person_id: 'person-olga',
        full_name: 'Ольга Иванова',
        roles: ['Designer'],
        team_ids: ['team-design'],
        is_active: true,
      },
      {
        person_id: 'person-max',
        full_name: 'Максим Орлов',
        roles: ['QA'],
        team_ids: ['team-qa'],
        is_active: false,
      },
    ],
  },
  'employee-month-cost': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      {
        person_id: 'person-ivan',
        month: '2026-01',
        salary_rub_month: 250000,
        working_hours_month: 156,
        cost_rate_rub_per_hour: 1600,
        source: 'manual',
      },
      {
        person_id: 'person-olga',
        month: '2026-01',
        salary_rub_month: 220000,
        working_hours_month: 160,
        cost_rate_rub_per_hour: 1400,
        source: 'manual',
      },
      {
        person_id: 'person-max',
        month: '2026-01',
        salary_rub_month: 180000,
        working_hours_month: 150,
        cost_rate_rub_per_hour: 1200,
        source: 'manual',
      },
    ],
  },
  fx: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { month: '2026-01', currency: 'USD', fx_avg: 92.4, fx_forecast: 93.1, fx_manual: 91.8, manual_override: true },
      { month: '2026-02', currency: 'USD', fx_avg: 93.2, fx_forecast: 93.0, fx_manual: 93.2, manual_override: false },
      { month: '2026-03', currency: 'USD', fx_avg: 94.1, fx_forecast: 94.0, fx_manual: 0, manual_override: false },
    ],
  },
  'expense-categories': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { category_id: 'exp-marketing', name: 'Маркетинг', is_active: true },
      { category_id: 'exp-tools', name: 'Инструменты', is_active: true },
      { category_id: 'exp-travel', name: 'Командировки', is_active: false },
    ],
  },
  'income-types': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { income_type_id: 'inc-tm', name: 'T&M Design', is_active: true },
      { income_type_id: 'inc-fix', name: 'Fix Price', is_active: true },
    ],
  },
  alerts: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { alert_id: 'alert-margin', name: 'Margin below 20%', scope: 'project', metric: 'margin', threshold: 20, is_active: true },
      { alert_id: 'alert-hours', name: 'Hours over plan', scope: 'project', metric: 'hours', threshold: 120, is_active: false },
    ],
  },
  agents: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      {
        agent_id: 'agent-finops',
        name: 'K2 Финансы',
        scope: ['finops'],
        type: 'scenario',
        prompt: 'Сводка по план‑факту и прогнозу.',
        trigger: 'manual',
        status: 'active',
        description: 'План‑факт и прогноз',
      },
      {
        agent_id: 'agent-audit',
        name: 'K2 Аудит',
        scope: ['finops'],
        type: 'audit',
        prompt: 'Проверить изменения и подсветить риски.',
        trigger: 'schedule',
        status: 'draft',
        description: 'Проверка изменений',
      },
    ],
  },
  epics: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { epic_id: 'epic-rebrand', title: 'Rebranding Q2', project: 'Acme Mobile App', status: 'active' },
      { epic_id: 'epic-ml', title: 'Northwind ML Phase 2', project: 'Northwind ML', status: 'archived' },
    ],
  },
  customers: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { customer_id: 'cust-nw', name: 'Northwind Holding', project_groups_count: 2, is_active: true },
      { customer_id: 'cust-orion', name: 'Orion Group', project_groups_count: 1, is_active: false },
    ],
  },
  'project-groups': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { project_group_id: 'pg-enterprise', name: 'Enterprise', customer_id: 'cust-nw', projects_count: 4, is_active: true },
      { project_group_id: 'pg-smb', name: 'SMB', customer_id: 'cust-orion', projects_count: 2, is_active: true },
    ],
  },
  leads: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { lead_name: 'Acme Holding', status: 'qualified', owner: 'Иван Петров', source: 'referral', created_at: '2026-01-12' },
      { lead_name: 'Delta Labs', status: 'new', owner: 'Ольга Иванова', source: 'inbound', created_at: '2026-01-25' },
    ],
  },
  offers: {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { offer_name: 'Acme Q2 Proposal', lead: 'Acme Holding', amount: '1 200 000', status: 'sent', created_at: '2026-01-20' },
      { offer_name: 'Delta MVP', lead: 'Delta Labs', amount: '650 000', status: 'draft', created_at: '2026-01-27' },
    ],
  },
  'leave-schedule': {
    source: 'mock',
    updated_at: '2026-01-28',
    items: [
      { person: 'Иван Петров', type: 'vacation', date_from: '2026-03-01', date_to: '2026-03-10', status: 'planned' },
      { person: 'Ольга Иванова', type: 'sick', date_from: '2026-02-03', date_to: '2026-02-07', status: 'done' },
    ],
  },
};
