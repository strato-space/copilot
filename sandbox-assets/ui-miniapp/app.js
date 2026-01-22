const state = {
  lang: "ru",
  view: "backlog",
  data: null,
  timeline: [],
  patch: { approved: false, applied: false },
  patchItems: [],
  lastAgentInput: "",
  profileName: null,
  profileTab: "tasks",
  profileDraftStatus: {},
  profileHistory: {},
  backlogTab: "new",
  weekMode: "people",
  automationEpics: {},
  filters: {
    date: null,
    project: "all",
    performer: "all",
    week: null,
    month: null,
    timelineType: "all",
    memoryType: "project_note",
  },
};

const i18n = {
  ru: {
    subtitle: "Операционный мини-апп",
    hero_title: "Бэклог -> Неделя -> Сегодня",
    hero_text: "Короткий и понятный обзор задач на день.",
    source_label: "Источник:",
    tabs: {
      backlog: "Бэклог",
      week: "Неделя",
      today: "Сегодня",
      metrics: "Метрики",
      timeline: "Timeline",
      memory: "Memory",
      month_plan: "Месяц",
      profiles: "Профили",
    },
    filters: {
      date: "Дата",
      project: "Проект",
      performer: "Исполнитель",
      week: "Неделя",
      month: "Месяц",
      event_type: "Тип события",
      all_dates: "Все даты",
      all_projects: "Все проекты",
      all_performers: "Все исполнители",
      all_events: "Все события",
    },
    stats: {
      total: "Всего задач",
      backlog: "В бэклоге",
      requests: "Новые запросы",
    },
    backlog: {
      new: "Новые запросы",
      verify: "Нужна проверка",
      unsorted: "Без категории",
      project_candidates: "Кандидаты проекта",
      forwardable_answers: "Передаваемые ответы",
      suggest: "Suggest",
      empty: "Пока пусто",
      summary: "Сводка",
      entities: "Сущности",
      task_candidates: "Кандидаты задач",
      needs: "Нужно",
      action: "Действие",
      source: "Источник",
      need_labels: {
        missing_links: "Нет ссылок",
        missing_assignee: "Нет исполнителя",
        missing_estimate: "Нет оценки",
        missing_project: "Нет проекта",
        no_project_id: "Нет project_id",
        no_description: "Нет описания",
      },
      actions: {
        new: "В Today",
        verify: "Проверить",
        unsorted: "Категоризировать",
        project_candidates: "Назначить проект",
        forwardable_answers: "Передать",
        suggest: "Применить",
      },
      tabs: {
        new: "Новые",
        needs_verify: "Проверка",
        unsorted: "Без категории",
        project_candidates: "Кандидаты",
        forwardable_answers: "Ответы",
        suggest: "Suggest",
      },
    },
    today: {
      by_project: "Сегодня по проектам",
      by_people: "Сегодня по людям",
      focus: "Фокус",
      risk: "Риск",
      tomorrow: "Завтра",
      done: "Сделано, когда",
      status_ok: "OK",
      status_not_ok: "NOT OK",
      reasons: "Причины",
      indicators: "Индикаторы",
      actions: {
        fix_now: "Исправить сейчас",
        open_project: "Открыть проект",
        open_performer: "Открыть исполнителя",
      },
      indicator_labels: {
        missing_links: "Без ссылок",
        missing_assignee: "Без исполнителя",
        needs_estimate: "Без оценки",
        no_project_id: "Без project_id",
        unsorted_count: "Без категории",
      },
    },
    week: {
      by_people: "Неделя по людям",
      by_project: "Неделя по проектам",
      load: "Нагрузка",
      hours: "ч",
      fix_load: "Fix load",
      risk: "Риск",
      violations: "Нарушения",
      actions: {
        assign: "Назначить",
        move_status: "Сменить статус",
        add_link: "Добавить ссылку",
      },
      flag_labels: {
        missing_estimate: "Без оценки",
        missing_links: "Без ссылок",
        missing_assignee: "Без исполнителя",
      },
    },
    metrics: {
      title: "Метрики",
      summary: "Сводка",
      by_status: "По статусам",
      missing_project: "Без проекта",
      missing_estimate: "Без оценки",
      missing_links: "Без ссылок",
      missing_assignee: "Без исполнителя",
      wip_stuck: "Зависли",
      not_ok_signals: "NOT OK сигналы",
      automation_candidates: "Automation candidates",
      get_recommendation: "Get recommendation",
      create_epic: "Create epic",
      epic_created: "Epic создан",
      score: "Скор",
      signal_labels: {
        missing_links: "Без ссылок",
        missing_assignee: "Без исполнителя",
        missing_estimate: "Без оценки",
        missing_project: "Без проекта",
        wip_stuck: "Зависли",
      },
    },
    timeline: {
      title: "Лента событий",
      empty: "Событий пока нет",
    },
    memory: {
      title: "Memory",
      access: "Доступ: Я / Никита",
      projects: "Проекты",
      people: "Люди",
      add: "Add",
      edit: "Edit",
      save: "Save",
      history: "History",
      types: {
        project_note: "Проекты",
        person_note: "Люди",
        strategy_note: "Стратегии",
      },
    },
    month_plan: {
      title: "План месяца",
      week: "Неделя",
      focus: "Фокус",
      choose_project: "Выберите проект",
      no_data: "Нет данных по проекту",
    },
    profiles: {
      title: "Профили исполнителей",
      pick: "Выбор исполнителя",
      base_info: "Базовая информация",
      stats: "Статистика",
      reliability: "Надёжность",
      tasks_total: "Всего задач",
      overdue: "Просрочено",
      tabs: {
        tasks: "Задачи",
        notes: "Заметки",
        agent: "Agent draft",
        history: "History",
      },
      draft_status: {
        needs_approve: "Черновик",
        accepted: "Принято",
        rejected: "Отклонено",
      },
      actions: {
        approve: "Принять",
        reject: "Отклонить",
      },
      history_actions: {
        draft_created: "Черновик создан",
        draft_accepted: "Черновик принят",
        draft_rejected: "Черновик отклонен",
      },
      notes_label: "Комментарий о человеке",
      agent_label: "Комментарий агента",
      empty: "Нет данных",
    },
    agent_input: {
      title: "Ввод для агента",
      placeholder: "Например: собери план на сегодня и вынеси риски",
      send: "Сформировать предложение",
      clear: "Очистить",
      sent: "Черновик предложения создан",
      helper: "После отправки можно подтвердить в UI или в чате",
      preview: "Предпросмотр",
      intent: "Intent",
    },
    patch: {
      title: "Suggest -> Approve -> Apply",
      hint: "Можно подтвердить и в чате",
      approve: "Подтвердить",
      apply: "Применить",
      approved: "Подтверждено",
      applied: "Применено",
      pending: "Ожидает подтверждения",
      action_label: "Действие",
      action_default: "Добавить в Today и назначить владельца",
    },
    meta: {
      project: "Проект",
      performer: "Исполнитель",
      status: "Статус",
      priority: "Приоритет",
      updated_by: "Обновил",
      updated_at: "Когда",
      owner: "Владелец",
    },
    status: {
      loading: "Загружаю данные…",
      ready: "Данные готовы",
      error: "Не удалось загрузить данные",
    },
  },
  en: {
    subtitle: "Ops mini app",
    hero_title: "Backlog -> Week -> Today",
    hero_text: "Short, clear daily ops view.",
    source_label: "Source:",
    tabs: {
      backlog: "Backlog",
      week: "Week",
      today: "Today",
      metrics: "Metrics",
      timeline: "Timeline",
      memory: "Memory",
      month_plan: "Month",
      profiles: "Profiles",
    },
    filters: {
      date: "Date",
      project: "Project",
      performer: "Performer",
      week: "Week",
      month: "Month",
      event_type: "Event type",
      all_dates: "All dates",
      all_projects: "All projects",
      all_performers: "All performers",
      all_events: "All events",
    },
    stats: {
      total: "Total tasks",
      backlog: "In backlog",
      requests: "New requests",
    },
    backlog: {
      new: "New requests",
      verify: "Needs verify",
      unsorted: "Unsorted",
      project_candidates: "Project candidates",
      forwardable_answers: "Forwardable answers",
      suggest: "Suggest",
      empty: "Nothing here yet",
      summary: "Summary",
      entities: "Entities",
      task_candidates: "Task candidates",
      needs: "Needs",
      action: "Action",
      source: "Source",
      need_labels: {
        missing_links: "Missing links",
        missing_assignee: "Missing owner",
        missing_estimate: "Missing estimate",
        missing_project: "Missing project",
        no_project_id: "Missing project_id",
        no_description: "Missing description",
      },
      actions: {
        new: "To Today",
        verify: "Verify",
        unsorted: "Categorize",
        project_candidates: "Assign project",
        forwardable_answers: "Forward",
        suggest: "Apply",
      },
      tabs: {
        new: "New",
        needs_verify: "Verify",
        unsorted: "Unsorted",
        project_candidates: "Candidates",
        forwardable_answers: "Forward",
        suggest: "Suggest",
      },
    },
    today: {
      by_project: "Today by project",
      by_people: "Today by people",
      focus: "Focus",
      risk: "Risk",
      tomorrow: "Tomorrow",
      done: "Done definition",
      status_ok: "OK",
      status_not_ok: "NOT OK",
      reasons: "Reasons",
      indicators: "Indicators",
      actions: {
        fix_now: "Fix now",
        open_project: "Open project",
        open_performer: "Open performer",
      },
      indicator_labels: {
        missing_links: "Missing links",
        missing_assignee: "Missing owner",
        needs_estimate: "Missing estimate",
        no_project_id: "Missing project_id",
        unsorted_count: "Unsorted",
      },
    },
    week: {
      by_people: "Week by people",
      by_project: "Week by project",
      load: "Load",
      hours: "h",
      fix_load: "Fix load",
      risk: "Risk",
      violations: "Violations",
      actions: {
        assign: "Assign",
        move_status: "Move status",
        add_link: "Add link",
      },
      flag_labels: {
        missing_estimate: "Missing estimate",
        missing_links: "Missing links",
        missing_assignee: "Missing owner",
      },
    },
    metrics: {
      title: "Metrics",
      summary: "Summary",
      by_status: "By status",
      missing_project: "Missing project",
      missing_estimate: "Missing estimate",
      missing_links: "Missing links",
      missing_assignee: "Missing owner",
      wip_stuck: "Stuck",
      not_ok_signals: "NOT OK signals",
      automation_candidates: "Automation candidates",
      get_recommendation: "Get recommendation",
      create_epic: "Create epic",
      epic_created: "Epic created",
      score: "Score",
      signal_labels: {
        missing_links: "Missing links",
        missing_assignee: "Missing owner",
        missing_estimate: "Missing estimate",
        missing_project: "Missing project",
        wip_stuck: "Stuck",
      },
    },
    timeline: {
      title: "Timeline",
      empty: "No events yet",
    },
    memory: {
      title: "Memory",
      access: "Access: Me / Nikita",
      projects: "Projects",
      people: "People",
      add: "Add",
      edit: "Edit",
      save: "Save",
      history: "History",
      types: {
        project_note: "Projects",
        person_note: "People",
        strategy_note: "Strategies",
      },
    },
    month_plan: {
      title: "Month plan",
      week: "Week",
      focus: "Focus",
      choose_project: "Select project",
      no_data: "No data for project",
    },
    profiles: {
      title: "Performer profiles",
      pick: "Select performer",
      base_info: "Base info",
      stats: "Stats",
      reliability: "Reliability",
      tasks_total: "Total tasks",
      overdue: "Overdue",
      tabs: {
        tasks: "Tasks",
        notes: "Notes",
        agent: "Agent draft",
        history: "History",
      },
      draft_status: {
        needs_approve: "Draft",
        accepted: "Accepted",
        rejected: "Rejected",
      },
      actions: {
        approve: "Accept",
        reject: "Reject",
      },
      history_actions: {
        draft_created: "Draft created",
        draft_accepted: "Draft accepted",
        draft_rejected: "Draft rejected",
      },
      notes_label: "Notes about performer",
      agent_label: "Agent draft",
      empty: "No data",
    },
    agent_input: {
      title: "Agent input",
      placeholder: "Example: build today plan and highlight risks",
      send: "Create suggestion",
      clear: "Clear",
      sent: "Draft suggestion created",
      helper: "You can approve in UI or in chat",
      preview: "Preview",
      intent: "Intent",
    },
    patch: {
      title: "Suggest -> Approve -> Apply",
      hint: "Approval is also possible in chat",
      approve: "Approve",
      apply: "Apply",
      approved: "Approved",
      applied: "Applied",
      pending: "Waiting approval",
      action_label: "Action",
      action_default: "Add to Today and assign owner",
    },
    meta: {
      project: "Project",
      performer: "Performer",
      status: "Status",
      priority: "Priority",
      updated_by: "Updated by",
      updated_at: "When",
      owner: "Owner",
    },
    status: {
      loading: "Loading data…",
      ready: "Data ready",
      error: "Failed to load data",
    },
  },
};

const viewEl = document.getElementById("view");
const statsEl = document.getElementById("stats");
const sourceEl = document.getElementById("sourcePath");
const snapshotEl = document.getElementById("snapshot");
const statusEl = document.getElementById("status");

const tabButtons = Array.from(document.querySelectorAll(".tab"));

function t(key) {
  const parts = key.split(".");
  let current = i18n[state.lang];
  for (const part of parts) {
    if (!current) return key;
    current = current[part];
  }
  return current ?? key;
}

function setStaticText() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    node.textContent = t(key);
  });
  tabButtons.forEach((btn) => {
    const view = btn.dataset.view;
    btn.textContent = t(`tabs.${view}`);
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat(state.lang === "ru" ? "ru-RU" : "en-GB", {
    dateStyle: "medium",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat(state.lang === "ru" ? "ru-RU" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(key) {
  statusEl.textContent = t(`status.${key}`);
}

function renderStats(data) {
  if (!data?.metrics) {
    statsEl.innerHTML = "";
    return;
  }
  const { total_tasks, by_status } = data.metrics;
  const items = [
    { label: t("stats.total"), value: total_tasks ?? "-" },
    { label: t("stats.backlog"), value: by_status?.Backlog ?? "-" },
    { label: t("stats.requests"), value: by_status?.["New / Request"] ?? "-" },
  ];
  statsEl.innerHTML = "";
  items.forEach((item, index) => {
    const stat = el("div", "stat fade-in");
    stat.style.setProperty("--delay", `${index * 80}ms`);
    stat.append(el("div", "stat-label", item.label));
    stat.append(el("div", "stat-value", item.value));
    statsEl.append(stat);
  });
}

function buildSelect({ label, value, options, onChange }) {
  const wrapper = el("label", "filter-group");
  wrapper.append(el("span", "filter-label", label));
  const select = el("select", "select");
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    select.append(opt);
  });
  select.value = value ?? options[0]?.value ?? "";
  select.addEventListener("change", (event) => onChange(event.target.value));
  wrapper.append(select);
  return wrapper;
}

function renderFilterBar(data) {
  const section = el("section", "section filters");
  const row = el("div", "filter-row");

  if (Array.isArray(data?.filters?.dates) && data.filters.dates.length) {
    const dateOptions = [
      { value: "all", label: t("filters.all_dates") },
      ...data.filters.dates.map((value) => ({ value, label: value })),
    ];
    row.append(
      buildSelect({
        label: t("filters.date"),
        value: state.filters.date || "all",
        options: dateOptions,
        onChange: (value) => {
          state.filters.date = value === "all" ? null : value;
          renderView();
        },
      })
    );
  }

  if (Array.isArray(data?.filters?.projects) && data.filters.projects.length) {
    const projectOptions = [
      { value: "all", label: t("filters.all_projects") },
      ...data.filters.projects.map((value) => ({ value, label: value })),
    ];
    row.append(
      buildSelect({
        label: t("filters.project"),
        value: state.filters.project || "all",
        options: projectOptions,
        onChange: (value) => {
          state.filters.project = value;
          renderView();
        },
      })
    );
  }

  if (Array.isArray(data?.filters?.performers) && data.filters.performers.length) {
    const performerOptions = [
      { value: "all", label: t("filters.all_performers") },
      ...data.filters.performers.map((value) => ({ value, label: value })),
    ];
    row.append(
      buildSelect({
        label: t("filters.performer"),
        value: state.filters.performer || "all",
        options: performerOptions,
        onChange: (value) => {
          state.filters.performer = value;
          renderView();
        },
      })
    );
  }

  if (state.view === "week" && Array.isArray(data?.filters?.weeks)) {
    const weekOptions = data.filters.weeks.map((value) => ({ value, label: value }));
    row.append(
      buildSelect({
        label: t("filters.week"),
        value: state.filters.week,
        options: weekOptions,
        onChange: (value) => {
          state.filters.week = value;
          renderView();
        },
      })
    );
  }

  if (state.view === "month_plan" && Array.isArray(data?.filters?.months)) {
    const monthOptions = data.filters.months.map((value) => ({ value, label: value }));
    row.append(
      buildSelect({
        label: t("filters.month"),
        value: state.filters.month,
        options: monthOptions,
        onChange: (value) => {
          state.filters.month = value;
          renderView();
        },
      })
    );
  }

  if (state.view === "timeline") {
    const eventTypes = [
      { value: "all", label: t("filters.all_events") },
      ...(data?.filters?.event_types || []).map((value) => ({ value, label: value })),
    ];
    row.append(
      buildSelect({
        label: t("filters.event_type"),
        value: state.filters.timelineType || "all",
        options: eventTypes,
        onChange: (value) => {
          state.filters.timelineType = value;
          renderView();
        },
      })
    );
  }

  section.append(row);
  return section;
}

function renderCard(item, index, extraMeta = []) {
  const card = el("div", "card fade-in");
  card.style.setProperty("--delay", `${index * 70}ms`);
  card.append(el("div", "card-title", item.title));

  const meta = el("div", "card-meta");
  if (item.project) meta.append(el("span", "badge", item.project));
  if (item.performer) meta.append(el("span", "badge", item.performer));
  if (item.status) meta.append(el("span", "badge", item.status));
  if (item.priority) meta.append(el("span", "badge warm", item.priority));

  extraMeta.forEach((label) => meta.append(el("span", "card-meta-item", label)));

  card.append(meta);
  return card;
}

function buildPatchItems(data) {
  if (Array.isArray(data?.patch_suggest?.items) && data.patch_suggest.items.length) {
    return data.patch_suggest.items.map((item) => ({
      title: item.title || item.name || "-",
      project: item.project || item.project_name || "-",
      action: item.action || null,
    }));
  }
  const items = data?.backlog?.new || [];
  return items.slice(0, 3).map((item) => ({
    title: item.title,
    project: item.project,
    action: null,
  }));
}

function pushTimelineEvent(event) {
  const item = { time: new Date().toISOString(), ...event };
  state.timeline = [item, ...state.timeline];
}

function seedProfileHistory(data) {
  const history = {};
  const seedTime = data?.meta?.generated_at || new Date().toISOString();
  (data?.performer_profiles || []).forEach((profile) => {
    history[profile.name] = [{ time: seedTime, actionKey: "draft_created" }];
  });
  return history;
}

function addProfileHistory(name, actionKey) {
  if (!state.profileHistory[name]) state.profileHistory[name] = [];
  state.profileHistory[name].unshift({ time: new Date().toISOString(), actionKey });
}

function getPerformerTasks(data, name) {
  const weekEntry = data?.week?.by_people?.find((item) => item.performer === name);
  if (weekEntry?.tasks?.length) {
    return weekEntry.tasks.map((task) => ({
      title: task.title,
      project: task.project,
      estimated_h: task.estimated_h,
    }));
  }
  const todayEntry = data?.today?.by_people?.find((item) => item.performer === name);
  if (todayEntry?.focus?.length) {
    return todayEntry.focus.map((task) => ({
      title: task.title,
      project: task.project,
      status: task.status,
    }));
  }
  return [];
}

function applyBacklogFilters(items) {
  return (items || []).filter((item) => {
    if (state.filters.project !== "all" && item.project !== state.filters.project) {
      return false;
    }
    if (state.filters.performer !== "all" && item.performer !== state.filters.performer) {
      return false;
    }
    return true;
  });
}

function filterTasksByProject(tasks) {
  if (state.filters.project === "all") return tasks;
  return tasks.filter((task) => task.project === state.filters.project);
}

function filterPeopleByProject(people) {
  if (state.filters.project === "all") return people;
  return people
    .map((person) => {
      const filteredTasks = filterTasksByProject(person.tasks || []);
      if (!filteredTasks.length) return null;
      return { ...person, tasks: filteredTasks };
    })
    .filter(Boolean);
}

function filterPeopleByPerformer(people) {
  if (state.filters.performer === "all") return people;
  return people.filter((person) => person.performer === state.filters.performer);
}

function renderAgentInput() {
  const section = el("section", "section");
  const header = el("div", "section-header");
  header.append(el("div", "section-title", t("agent_input.title")));
  section.append(header);

  const textarea = el("textarea", "textarea");
  textarea.placeholder = t("agent_input.placeholder");
  section.append(textarea);

  if (state.lastAgentInput) {
    section.append(el("div", "helper", t("agent_input.sent")));
  }

  const actions = el("div", "action-row");
  const sendBtn = el("button", "button primary", t("agent_input.send"));
  sendBtn.type = "button";
  const clearBtn = el("button", "button ghost", t("agent_input.clear"));
  clearBtn.type = "button";
  actions.append(sendBtn, clearBtn);
  section.append(actions);
  section.append(el("div", "helper", t("agent_input.helper")));

  if (state.data?.agent_preview) {
    const preview = el("div", "card");
    preview.append(el("div", "card-title", t("agent_input.preview")));
    const meta = el("div", "card-meta");
    meta.append(
      el(
        "span",
        "badge",
        `${t("agent_input.intent")}: ${state.data.agent_preview.intent}`
      )
    );
    preview.append(meta);
    const list = el("div", "list");
    state.data.agent_preview.result_preview.forEach((line) => {
      list.append(el("div", "helper", `• ${line}`));
    });
    preview.append(list);
    section.append(preview);
  }

  sendBtn.addEventListener("click", () => {
    const value = textarea.value.trim();
    if (!value) return;
    state.lastAgentInput = value;
    pushTimelineEvent({
      type: "agent_input",
      title: t("agent_input.sent"),
      ref: "agent_input",
    });
    renderView();
  });

  clearBtn.addEventListener("click", () => {
    textarea.value = "";
    state.lastAgentInput = "";
  });

  return section;
}

function renderPatchSuggestion() {
  if (!state.patchItems.length) return null;

  const section = el("section", "section");
  const header = el("div", "section-header");
  header.append(el("div", "section-title", t("patch.title")));
  const statusLabel = state.patch.applied
    ? t("patch.applied")
    : state.patch.approved
    ? t("patch.approved")
    : t("patch.pending");
  const statusBadge = el(
    "span",
    `badge${state.patch.approved ? "" : " warm"}`,
    statusLabel
  );
  header.append(statusBadge);
  section.append(header);
  section.append(el("div", "helper", t("patch.hint")));

  const list = el("div", "list");
  state.patchItems.forEach((item, index) => {
    const actionText = item.action || t("patch.action_default");
    const meta = `${t("patch.action_label")}: ${actionText}`;
    list.append(
      renderCard(
        {
          title: item.title,
          project: item.project,
        },
        index,
        [meta]
      )
    );
  });
  section.append(list);

  const actions = el("div", "action-row");
  const approveBtn = el("button", "button ghost", t("patch.approve"));
  approveBtn.type = "button";
  const applyBtn = el("button", "button primary", t("patch.apply"));
  applyBtn.type = "button";

  approveBtn.disabled = state.patch.approved;
  applyBtn.disabled = !state.patch.approved || state.patch.applied;

  approveBtn.addEventListener("click", () => {
    state.patch.approved = true;
    pushTimelineEvent({
      type: "patch_approved",
      title: t("patch.approved"),
      ref: "patch_suggest.json",
    });
    renderView();
  });

  applyBtn.addEventListener("click", () => {
    if (!state.patch.approved) return;
    state.patch.applied = true;
    pushTimelineEvent({
      type: "patch_applied",
      title: t("patch.applied"),
      ref: "patch_suggest.json",
    });
    renderView();
  });

  actions.append(approveBtn, applyBtn);
  section.append(actions);

  return section;
}

function renderEntities(entities) {
  const wrap = el("div", "card-meta");
  if (!entities) return wrap;
  Object.values(entities).flat().forEach((value) => {
    wrap.append(el("span", "badge", value));
  });
  return wrap;
}

function renderBacklogCard(item, index, actionLabel) {
  const card = el("div", "card fade-in");
  card.style.setProperty("--delay", `${index * 70}ms`);
  card.append(el("div", "card-title", item.title));

  const meta = el("div", "card-meta");
  meta.append(el("span", "badge", item.project || "-"));
  if (item.performer) meta.append(el("span", "badge", item.performer));
  if (item.status) meta.append(el("span", "badge", item.status));
  if (item.priority) meta.append(el("span", "badge warm", item.priority));
  if (item.source) {
    meta.append(el("span", "badge", `${t("backlog.source")}: ${item.source}`));
  }
  card.append(meta);

  if (item.summary) {
    card.append(el("div", "helper", `${t("backlog.summary")}: ${item.summary}`));
  }

  if (item.entities && Object.values(item.entities).some((list) => list.length)) {
    card.append(el("div", "helper", t("backlog.entities")));
    card.append(renderEntities(item.entities));
  }

  if (item.task_candidates?.length) {
    card.append(el("div", "helper", t("backlog.task_candidates")));
    const list = el("div", "list");
    item.task_candidates.forEach((task) => {
      list.append(el("div", "helper", `• ${task}`));
    });
    card.append(list);
  }

  if (item.needs?.length) {
    const needsMeta = el("div", "card-meta");
    item.needs.forEach((need) => needsMeta.append(el("span", "badge warm", need)));
    card.append(el("div", "helper", t("backlog.needs")));
    card.append(needsMeta);
  }

  if (actionLabel) {
    const actions = el("div", "action-row");
    const btn = el("button", "button primary", actionLabel);
    btn.type = "button";
    btn.addEventListener("click", () => {
      pushTimelineEvent({
        type: "backlog_action",
        title: `${actionLabel}: ${item.title}`,
        ref: item.id,
      });
    });
    actions.append(btn);
    card.append(actions);
  }

  return card;
}

function renderBacklog(data) {
  const sections = [];
  sections.push(renderAgentInput());

  const patchSection = renderPatchSuggestion();
  if (patchSection) sections.push(patchSection);

  const tabs = [
    { key: "new", label: t("backlog.tabs.new") },
    { key: "needs_verify", label: t("backlog.tabs.needs_verify") },
    { key: "unsorted", label: t("backlog.tabs.unsorted") },
    { key: "project_candidates", label: t("backlog.tabs.project_candidates") },
    { key: "forwardable_answers", label: t("backlog.tabs.forwardable_answers") },
    { key: "suggest", label: t("backlog.tabs.suggest") },
  ];

  const tabRow = el("div", "pill-row");
  tabs.forEach((tab) => {
    const btn = el(
      "button",
      `pill${state.backlogTab === tab.key ? " is-active" : ""}`,
      tab.label
    );
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.backlogTab = tab.key;
      renderView();
    });
    tabRow.append(btn);
  });

  const section = el("section", "section");
  section.append(tabRow);

  const list = el("div", "list");
  const items = applyBacklogFilters(data?.backlog?.[state.backlogTab] || []);
  if (!items.length) {
    list.append(el("div", "empty", t("backlog.empty")));
  } else {
    const actionMap = {
      new: t("backlog.actions.new"),
      needs_verify: t("backlog.actions.verify"),
      unsorted: t("backlog.actions.unsorted"),
      project_candidates: t("backlog.actions.project_candidates"),
      forwardable_answers: t("backlog.actions.forwardable_answers"),
      suggest: t("backlog.actions.suggest"),
    };
    items.slice(0, 10).forEach((item, index) => {
      list.append(renderBacklogCard(item, index, actionMap[state.backlogTab]));
    });
  }

  section.append(list);
  sections.push(section);

  return sections;
}

function renderWeek(data) {
  const section = el("section", "section");
  const header = el("div", "section-header");
  header.append(
    el(
      "div",
      "section-title",
      state.weekMode === "people" ? t("week.by_people") : t("week.by_project")
    )
  );
  section.append(header);

  const toggle = el("div", "pill-row");
  [
    { key: "people", label: t("week.by_people") },
    { key: "projects", label: t("week.by_project") },
  ].forEach((item) => {
    const btn = el(
      "button",
      `pill${state.weekMode === item.key ? " is-active" : ""}`,
      item.label
    );
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.weekMode = item.key;
      renderView();
    });
    toggle.append(btn);
  });
  section.append(toggle);

  const list = el("div", "list");

  if (state.weekMode === "people") {
    let people = data?.week?.by_people || [];
    people = filterPeopleByProject(people);
    people = filterPeopleByPerformer(people);

    if (!people.length) {
      list.append(el("div", "empty", t("backlog.empty")));
    } else {
      people.forEach((person, index) => {
        const card = el("div", "card fade-in");
        card.style.setProperty("--delay", `${index * 70}ms`);
        card.append(el("div", "card-title", person.performer));

        const meta = el("div", "card-meta");
        meta.append(
          el(
            "span",
            "badge",
            `${t("week.load")}: ${person.load_h ?? "-"} ${t("week.hours")}`
          )
        );
        if (person.load_status) {
          meta.append(
            el(
              "span",
              `badge${person.load_status === "ok" ? "" : " warm"}`,
              person.load_status
            )
          );
        }
        (person.flags || []).forEach((flag) => meta.append(el("span", "badge warm", flag)));
        card.append(meta);

        const tasks = el("div", "list");
        (person.tasks || []).slice(0, 4).forEach((task) => {
          const taskItem = el("div", "card");
          taskItem.append(el("div", "card-title", task.title));
          const taskMeta = el("div", "card-meta");
          if (task.project) taskMeta.append(el("span", "badge", task.project));
          if (task.estimated_h !== undefined && task.estimated_h !== null) {
            taskMeta.append(
              el("span", "badge warm", `${task.estimated_h} ${t("week.hours")}`)
            );
          }
          taskItem.append(taskMeta);
          tasks.append(taskItem);
        });
        card.append(tasks);

        if (person.load_status && person.load_status !== "ok") {
          const actions = el("div", "action-row");
          const fixBtn = el("button", "button primary", t("week.fix_load"));
          fixBtn.type = "button";
          fixBtn.addEventListener("click", () => {
            pushTimelineEvent({
              type: "fix_load",
              title: `${t("week.fix_load")}: ${person.performer}`,
              ref: "week",
            });
          });
          actions.append(fixBtn);
          card.append(actions);
        }

        list.append(card);
      });
    }
  } else {
    let projects = data?.week?.by_project || [];
    if (state.filters.project !== "all") {
      projects = projects.filter((project) => project.project === state.filters.project);
    }

    if (!projects.length) {
      list.append(el("div", "empty", t("backlog.empty")));
    } else {
      projects.forEach((project, index) => {
        const card = el("div", "card fade-in");
        card.style.setProperty("--delay", `${index * 70}ms`);
        card.append(el("div", "card-title", project.project));

        const meta = el("div", "card-meta");
        (project.owners || []).forEach((owner) => meta.append(el("span", "badge", owner)));
        if (project.risk) meta.append(el("span", "badge warm", `${t("week.risk")}: ${project.risk}`));
        card.append(meta);

        const tasks = el("div", "list");
        (project.tasks || []).slice(0, 4).forEach((task) => {
          const taskItem = el("div", "card");
          taskItem.append(el("div", "card-title", task.title));
          const taskMeta = el("div", "card-meta");
          if (task.performer) taskMeta.append(el("span", "badge", task.performer));
          if (task.priority) taskMeta.append(el("span", "badge warm", task.priority));
          taskItem.append(taskMeta);
          tasks.append(taskItem);
        });
        card.append(tasks);
        list.append(card);
      });
    }
  }

  section.append(list);

  if (data?.week?.violations?.length) {
    const violationSection = el("section", "section");
    violationSection.append(el("div", "section-title", t("week.violations")));
    const violationList = el("div", "list");
    data.week.violations.forEach((violation, index) => {
      violationList.append(
        renderCard({ title: violation }, index, [`${t("week.fix_load")}`])
      );
    });
    violationSection.append(violationList);
    return [section, violationSection];
  }

  return [section];
}

function renderToday(data) {
  const sections = [];
  const statusSection = el("section", "section");
  const header = el("div", "section-header");
  header.append(el("div", "section-title", t("today.indicators")));
  const statusBadge = el(
    "span",
    `status-chip${data?.today?.status === "ok" ? " ok" : " bad"}`,
    data?.today?.status === "ok" ? t("today.status_ok") : t("today.status_not_ok")
  );
  header.append(statusBadge);
  statusSection.append(header);

  if (data?.today?.reasons?.length) {
    statusSection.append(el("div", "helper", t("today.reasons")));
    const reasons = el("div", "card-meta");
    data.today.reasons.forEach((reason) => reasons.append(el("span", "badge warm", reason)));
    statusSection.append(reasons);
  }

  const indicators = el("div", "indicator-row");
  if (data?.today?.indicators) {
    Object.entries(data.today.indicators).forEach(([key, value]) => {
      const label = t(`today.indicator_labels.${key}`);
      indicators.append(el("span", "indicator", `${label}: ${value}`));
    });
  }
  statusSection.append(indicators);
  sections.push(statusSection);

  const projectSection = el("section", "section");
  projectSection.append(el("div", "section-title", t("today.by_project")));

  const projectList = el("div", "list");
  let projects = data?.today?.by_project || [];
  if (state.filters.project !== "all") {
    projects = projects.filter((project) => project.project === state.filters.project);
  }
  if (!projects.length) {
    projectList.append(el("div", "empty", t("backlog.empty")));
  } else {
    projects.forEach((project, index) => {
      const card = el("div", "card fade-in");
      card.style.setProperty("--delay", `${index * 70}ms`);
      card.append(el("div", "card-title", project.project));

      const actions = el("div", "list");
      (project.actions || []).slice(0, 3).forEach((action) => {
        const extra = [];
        if (action.done_definition) {
          extra.push(`${t("today.done")}: ${action.done_definition}`);
        }
        actions.append(
          renderCard(
            {
              title: action.title,
              performer: action.owner,
              status: action.status,
              priority: action.priority,
            },
            0,
            extra
          )
        );
      });
      card.append(actions);
      projectList.append(card);
    });
  }

  projectSection.append(projectList);
  sections.push(projectSection);

  const peopleSection = el("section", "section");
  peopleSection.append(el("div", "section-title", t("today.by_people")));

  const peopleList = el("div", "list");
  let people = data?.today?.by_people || [];
  people = filterPeopleByPerformer(people);
  if (!people.length) {
    peopleList.append(el("div", "empty", t("backlog.empty")));
  } else {
    people.forEach((person, index) => {
      const card = el("div", "card fade-in");
      card.style.setProperty("--delay", `${index * 70}ms`);
      card.append(el("div", "card-title", person.performer));
      const focus = el("div", "list");
      (person.focus || []).forEach((item) => {
        if (state.filters.project !== "all" && item.project !== state.filters.project) {
          return;
        }
        const itemCard = el("div", "card");
        itemCard.append(el("div", "card-title", item.title));
        const itemMeta = el("div", "card-meta");
        itemMeta.append(el("span", "badge", item.project));
        itemMeta.append(el("span", "badge", item.status));
        itemCard.append(itemMeta);
        focus.append(itemCard);
      });
      card.append(focus);

      const notes = el("div", "card-meta");
      if (person.risk) notes.append(el("span", "badge warm", `${t("today.risk")}: ${person.risk}`));
      if (person.tomorrow) {
        notes.append(el("span", "badge", `${t("today.tomorrow")}: ${person.tomorrow}`));
      }
      card.append(notes);

      peopleList.append(card);
    });
  }

  peopleSection.append(peopleList);
  sections.push(peopleSection);

  return sections;
}

function renderMetrics(data) {
  const sections = [];
  const summary = el("section", "section");
  summary.append(el("div", "section-title", t("metrics.summary")));
  if (data?.metrics?.summary_text) {
    summary.append(el("div", "helper", data.metrics.summary_text));
  }

  const list = el("div", "list metric-grid");
  const metrics = data?.metrics || {};
  const items = [
    { label: t("stats.total"), value: metrics.total_tasks ?? "-" },
    { label: t("stats.backlog"), value: metrics.by_status?.Backlog ?? "-" },
    { label: t("stats.requests"), value: metrics.by_status?.["New / Request"] ?? "-" },
    { label: t("metrics.missing_project"), value: metrics.missing_project ?? "-" },
    { label: t("metrics.missing_estimate"), value: metrics.missing_estimate ?? "-" },
    { label: t("metrics.missing_links"), value: metrics.missing_links ?? "-" },
    { label: t("metrics.missing_assignee"), value: metrics.missing_assignee ?? "-" },
    { label: t("metrics.wip_stuck"), value: metrics.wip_stuck ?? "-" },
  ];
  items.forEach((item, index) => {
    const card = el("div", "card fade-in");
    card.style.setProperty("--delay", `${index * 60}ms`);
    card.append(el("div", "card-title", item.label));
    card.append(el("div", "stat-value", item.value));
    list.append(card);
  });
  summary.append(list);
  sections.push(summary);

  const signals = el("section", "section");
  const signalHeader = el("div", "section-header");
  signalHeader.append(el("div", "section-title", t("metrics.not_ok_signals")));
  const recommendBtn = el("button", "button ghost", t("metrics.get_recommendation"));
  recommendBtn.type = "button";
  recommendBtn.addEventListener("click", () => {
    pushTimelineEvent({
      type: "metrics_recommendation",
      title: t("metrics.get_recommendation"),
      ref: "metrics",
    });
  });
  signalHeader.append(recommendBtn);
  signals.append(signalHeader);

  const signalList = el("div", "list");
  const signalItems = metrics.not_ok_signals || [];
  if (!signalItems.length) {
    signalList.append(el("div", "empty", t("backlog.empty")));
  } else {
    signalItems.forEach((signal, index) => {
      const label = t(`metrics.signal_labels.${signal.code}`);
      const card = el("div", "card fade-in");
      card.style.setProperty("--delay", `${index * 60}ms`);
      card.append(el("div", "card-title", label));
      const meta = el("div", "card-meta");
      meta.append(el("span", "badge warm", String(signal.count)));
      card.append(meta);
      signalList.append(card);
    });
  }
  signals.append(signalList);
  sections.push(signals);

  const automation = el("section", "section");
  automation.append(el("div", "section-title", t("metrics.automation_candidates")));
  const autoList = el("div", "list");
  const candidates = metrics.automation_candidates || [];
  if (!candidates.length) {
    autoList.append(el("div", "empty", t("backlog.empty")));
  } else {
    candidates.slice(0, 3).forEach((candidate, index) => {
      const card = el("div", "card fade-in");
      card.style.setProperty("--delay", `${index * 60}ms`);
      card.append(el("div", "card-title", candidate.label));
      if (candidate.pain) card.append(el("div", "helper", candidate.pain));
      const meta = el("div", "card-meta");
      meta.append(el("span", "badge", `${t("metrics.score")}: ${candidate.score}`));
      meta.append(el("span", "badge warm", String(candidate.count)));
      card.append(meta);
      if (candidate.examples?.length) {
        const examples = el("div", "list");
        candidate.examples.forEach((example) => {
          examples.append(el("div", "helper", `• ${example}`));
        });
        card.append(examples);
      }

      const actions = el("div", "action-row");
      const epicBtn = el(
        "button",
        `button ${state.automationEpics[candidate.id] ? "ghost" : "primary"}`,
        state.automationEpics[candidate.id]
          ? t("metrics.epic_created")
          : t("metrics.create_epic")
      );
      epicBtn.type = "button";
      epicBtn.disabled = !!state.automationEpics[candidate.id];
      epicBtn.addEventListener("click", () => {
        state.automationEpics[candidate.id] = true;
        pushTimelineEvent({
          type: "automation_epic_created",
          title: `${t("metrics.create_epic")}: ${candidate.label}`,
          ref: candidate.id,
        });
        renderView();
      });
      actions.append(epicBtn);
      card.append(actions);

      autoList.append(card);
    });
  }
  automation.append(autoList);
  sections.push(automation);

  return sections;
}

function renderTimeline(data) {
  const section = el("section", "section");
  section.append(el("div", "section-title", t("timeline.title")));

  const list = el("div", "timeline");
  let events = (state.timeline?.length ? state.timeline : data?.timeline || []).slice();
  events.sort((a, b) => new Date(b.time) - new Date(a.time));
  if (state.filters.timelineType && state.filters.timelineType !== "all") {
    events = events.filter((event) => event.type === state.filters.timelineType);
  }

  if (!events.length) {
    list.append(el("div", "empty", t("timeline.empty")));
  } else {
    events.forEach((event, index) => {
      const item = el("div", "timeline-item fade-in");
      item.style.setProperty("--delay", `${index * 60}ms`);
      item.append(el("div", "timeline-time", formatDateTime(event.time)));
      item.append(el("div", "timeline-title", event.title || event.type));
      const meta = el("div", "card-meta");
      if (event.type) meta.append(el("span", "badge", event.type));
      if (event.ref) meta.append(el("span", "badge", event.ref));
      item.append(meta);
      list.append(item);
    });
  }
  section.append(list);

  return [section];
}

function renderMemory(data) {
  const section = el("section", "section");
  const header = el("div", "section-header");
  header.append(el("div", "section-title", t("memory.title")));
  section.append(header);
  section.append(el("div", "helper", t("memory.access")));

  const tabs = el("div", "pill-row");
  ["project_note", "person_note", "strategy_note"].forEach((type) => {
    const btn = el(
      "button",
      `pill${state.filters.memoryType === type ? " is-active" : ""}`,
      t(`memory.types.${type}`)
    );
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.filters.memoryType = type;
      renderView();
    });
    tabs.append(btn);
  });
  section.append(tabs);

  const list = el("div", "list");
  const entries = (data?.memory?.entries || []).filter(
    (entry) => entry.type === state.filters.memoryType
  );
  if (!entries.length) {
    list.append(el("div", "empty", t("backlog.empty")));
  } else {
    entries.forEach((entry, index) => {
      const card = el("div", "card fade-in");
      card.style.setProperty("--delay", `${index * 60}ms`);
      const title = entry.project || entry.person || t("memory.title");
      card.append(el("div", "card-title", title));
      card.append(el("div", "helper", entry.note || "-"));

      const meta = el("div", "card-meta");
      meta.append(el("span", "badge", `${t("meta.updated_by")}: ${entry.updated_by || "-"}`));
      meta.append(el("span", "badge", `${t("meta.updated_at")}: ${entry.updated_at || "-"}`));
      card.append(meta);

      if (entry.history?.length) {
        card.append(el("div", "helper", t("memory.history")));
        const historyList = el("div", "list");
        entry.history.forEach((item) => {
          historyList.append(
            el("div", "helper", `• ${item.time} — ${item.updated_by}: ${item.change}`)
          );
        });
        card.append(historyList);
      }

      list.append(card);
    });
  }
  section.append(list);

  return [section];
}

function renderMonthPlan(data) {
  const section = el("section", "section");
  section.append(el("div", "section-title", t("month_plan.title")));

  const selectedProject =
    state.filters.project === "all" ? data?.month_plan?.project_default : state.filters.project;

  if (!selectedProject) {
    section.append(el("div", "empty", t("month_plan.choose_project")));
    return [section];
  }

  if (data?.month_plan?.project_default && selectedProject !== data.month_plan.project_default) {
    section.append(el("div", "empty", t("month_plan.no_data")));
    return [section];
  }

  const list = el("div", "list");
  const weeks = data?.month_plan?.weeks || [];
  if (!weeks.length) {
    list.append(el("div", "empty", t("backlog.empty")));
  } else {
    weeks.forEach((week, index) => {
      const card = el("div", "card fade-in");
      card.style.setProperty("--delay", `${index * 60}ms`);
      card.append(el("div", "card-title", `${t("month_plan.week")} ${week.week}`));
      if (week.focus) card.append(el("div", "helper", `${t("month_plan.focus")}: ${week.focus}`));

      const tasks = el("div", "list");
      (week.tasks || []).slice(0, 4).forEach((task) => {
        const taskCard = el("div", "card");
        taskCard.append(el("div", "card-title", task.title));
        const meta = el("div", "card-meta");
        if (task.owner) meta.append(el("span", "badge", `${t("meta.owner")}: ${task.owner}`));
        if (task.status) meta.append(el("span", "badge", task.status));
        if (task.priority) meta.append(el("span", "badge warm", task.priority));
        taskCard.append(meta);
        tasks.append(taskCard);
      });
      card.append(tasks);
      list.append(card);
    });
  }
  section.append(list);

  return [section];
}

function renderProfiles(data) {
  const section = el("section", "section");
  section.append(el("div", "section-title", t("profiles.title")));

  const profiles = data?.performer_profiles || [];
  if (!profiles.length) {
    section.append(el("div", "empty", t("profiles.empty")));
    return [section];
  }

  if (!state.profileName || !profiles.find((item) => item.name === state.profileName)) {
    state.profileName = profiles[0].name;
    state.profileTab = "tasks";
  }

  const picker = el("div", "pill-row");
  profiles.forEach((profile) => {
    const btn = el(
      "button",
      `pill${profile.name === state.profileName ? " is-active" : ""}`,
      profile.name
    );
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.profileName = profile.name;
      state.profileTab = "tasks";
      renderView();
    });
    picker.append(btn);
  });
  section.append(picker);

  const selected = profiles.find((item) => item.name === state.profileName);
  const baseCard = el("div", "card");
  baseCard.append(el("div", "card-title", t("profiles.base_info")));
  baseCard.append(el("div", "helper", selected.name));
  const baseMeta = el("div", "card-meta");
  if (selected.role) baseMeta.append(el("span", "badge", selected.role));
  if (selected.timezone) baseMeta.append(el("span", "badge", selected.timezone));
  if (selected.email) baseMeta.append(el("span", "badge", selected.email));
  baseCard.append(baseMeta);

  const statsCard = el("div", "card");
  statsCard.append(el("div", "card-title", t("profiles.stats")));
  const statsMeta = el("div", "card-meta");
  if (selected.stats) {
    statsMeta.append(
      el("span", "badge", `${t("profiles.tasks_total")}: ${selected.stats.tasks_total}`)
    );
    statsMeta.append(el("span", "badge", `Done: ${selected.stats.done}`));
    statsMeta.append(el("span", "badge", `In progress: ${selected.stats.in_progress}`));
    statsMeta.append(el("span", "badge", `Backlog: ${selected.stats.backlog}`));
    statsMeta.append(el("span", "badge warm", `${t("profiles.overdue")}: ${selected.stats.overdue}`));
    statsMeta.append(
      el(
        "span",
        "badge",
        `${t("profiles.reliability")}: ${selected.stats.reliability_score}`
      )
    );
  }
  statsCard.append(statsMeta);

  section.append(baseCard);
  section.append(statsCard);

  const tabRow = el("div", "pill-row");
  ["tasks", "notes", "agent", "history"].forEach((tab) => {
    const btn = el(
      "button",
      `pill${state.profileTab === tab ? " is-active" : ""}`,
      t(`profiles.tabs.${tab}`)
    );
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.profileTab = tab;
      renderView();
    });
    tabRow.append(btn);
  });
  section.append(tabRow);
  section.append(el("div", "divider"));

  const content = el("div", "list");

  if (state.profileTab === "tasks") {
    const tasks = getPerformerTasks(data, selected.name);
    if (!tasks.length) {
      content.append(el("div", "empty", t("profiles.empty")));
    } else {
      tasks.forEach((task, index) => {
        const card = el("div", "card fade-in");
        card.style.setProperty("--delay", `${index * 60}ms`);
        card.append(el("div", "card-title", task.title));
        const meta = el("div", "card-meta");
        if (task.project) meta.append(el("span", "badge", task.project));
        if (task.estimated_h !== undefined && task.estimated_h !== null) {
          meta.append(el("span", "badge warm", `${task.estimated_h} ${t("week.hours")}`));
        }
        if (task.status) meta.append(el("span", "badge", task.status));
        card.append(meta);
        content.append(card);
      });
    }
  }

  if (state.profileTab === "notes") {
    const note = data?.memory?.entries?.find(
      (item) => item.type === "person_note" && item.person === selected.name
    );
    const card = el("div", "card");
    card.append(el("div", "card-title", t("profiles.notes_label")));
    card.append(el("div", "helper", note?.note || t("profiles.empty")));
    const meta = el("div", "card-meta");
    meta.append(el("span", "badge", `${t("meta.updated_by")}: ${note?.updated_by || "-"}`));
    card.append(meta);
    content.append(card);
  }

  if (state.profileTab === "agent") {
    const draft = selected.agent_draft || {};
    const draftStatus = state.profileDraftStatus[selected.name] || draft.status || "needs_approve";
    const statusBadge = el(
      "span",
      `badge${draftStatus === "needs_approve" ? " warm" : ""}`,
      t(`profiles.draft_status.${draftStatus}`)
    );
    const card = el("div", "card");
    card.append(el("div", "card-title", t("profiles.agent_label")));
    card.append(el("div", "helper", draft.text || t("profiles.empty")));
    const meta = el("div", "card-meta");
    meta.append(statusBadge);
    card.append(meta);

    const actions = el("div", "action-row");
    const approveBtn = el("button", "button primary", t("profiles.actions.approve"));
    approveBtn.type = "button";
    const rejectBtn = el("button", "button ghost", t("profiles.actions.reject"));
    rejectBtn.type = "button";
    approveBtn.disabled = draftStatus === "accepted";
    rejectBtn.disabled = draftStatus === "rejected";

    approveBtn.addEventListener("click", () => {
      state.profileDraftStatus[selected.name] = "accepted";
      addProfileHistory(selected.name, "draft_accepted");
      pushTimelineEvent({
        type: "profile_draft_accepted",
        title: `${selected.name}: ${t("profiles.history_actions.draft_accepted")}`,
        ref: "performer_profile",
      });
      renderView();
    });

    rejectBtn.addEventListener("click", () => {
      state.profileDraftStatus[selected.name] = "rejected";
      addProfileHistory(selected.name, "draft_rejected");
      pushTimelineEvent({
        type: "profile_draft_rejected",
        title: `${selected.name}: ${t("profiles.history_actions.draft_rejected")}`,
        ref: "performer_profile",
      });
      renderView();
    });

    actions.append(approveBtn, rejectBtn);
    card.append(actions);
    content.append(card);
  }

  if (state.profileTab === "history") {
    const history = state.profileHistory[selected.name] || [];
    if (!history.length) {
      content.append(el("div", "empty", t("profiles.empty")));
    } else {
      history.forEach((item, index) => {
        const entry = el("div", "timeline-item fade-in");
        entry.style.setProperty("--delay", `${index * 60}ms`);
        entry.append(el("div", "timeline-time", formatDateTime(item.time)));
        entry.append(el("div", "timeline-title", t(`profiles.history_actions.${item.actionKey}`)));
        content.append(entry);
      });
    }
  }

  section.append(content);
  return [section];
}

function renderView() {
  if (!state.data) {
    viewEl.innerHTML = "";
    viewEl.append(el("div", "section", t("status.loading")));
    return;
  }

  viewEl.innerHTML = "";
  viewEl.append(renderFilterBar(state.data));

  let sections = [];
  if (state.view === "backlog") sections = renderBacklog(state.data);
  if (state.view === "week") sections = renderWeek(state.data);
  if (state.view === "today") sections = renderToday(state.data);
  if (state.view === "metrics") sections = renderMetrics(state.data);
  if (state.view === "timeline") sections = renderTimeline(state.data);
  if (state.view === "memory") sections = renderMemory(state.data);
  if (state.view === "month_plan") sections = renderMonthPlan(state.data);
  if (state.view === "profiles") sections = renderProfiles(state.data);

  if (!sections.length) sections = renderBacklog(state.data);

  sections.forEach((section) => viewEl.append(section));
}

function updateActiveTab() {
  tabButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === state.view);
  });
}

async function loadData() {
  try {
    setStatus("loading");
    const response = await fetch("../mock-data/ops-hub-sample.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load");
    state.data = await response.json();

    state.timeline = Array.isArray(state.data.timeline) ? [...state.data.timeline] : [];
    state.patchItems = buildPatchItems(state.data);
    state.profileHistory = seedProfileHistory(state.data);
    if (!state.profileName && state.data.performer_profiles?.length) {
      state.profileName = state.data.performer_profiles[0].name;
      state.profileTab = "tasks";
    }

    state.filters.date = state.data.filters?.dates?.[0] || null;
    state.filters.week = state.data.filters?.weeks?.[0] || null;
    state.filters.month = state.data.filters?.months?.[0] || null;
    state.filters.project = state.data.month_plan?.project_default || "all";

    const defaultView = state.data.ui?.default_tab;
    if (defaultView) state.view = defaultView;
    if (!tabButtons.find((btn) => btn.dataset.view === state.view)) {
      state.view = "backlog";
    }

    snapshotEl.textContent = formatDate(state.data.meta?.snapshot_date);
    sourceEl.textContent = state.data.meta?.source || "-";
    renderStats(state.data);
    updateActiveTab();
    renderView();
    setStatus("ready");
  } catch (error) {
    console.error(error);
    viewEl.innerHTML = "";
    viewEl.append(el("div", "section", t("status.error")));
    setStatus("error");
  }
}

function init() {
  setStaticText();
  renderView();
  loadData();

  document.getElementById("langToggle").addEventListener("click", () => {
    state.lang = state.lang === "ru" ? "en" : "ru";
    setStaticText();
    renderStats(state.data);
    renderView();
  });

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      updateActiveTab();
      renderView();
    });
  });

  updateActiveTab();
}

init();
